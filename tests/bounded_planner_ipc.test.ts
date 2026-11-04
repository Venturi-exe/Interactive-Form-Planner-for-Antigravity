import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("vscode", () => ({
    window: {
        createOutputChannel: () => ({
            appendLine: () => {},
            dispose: () => {},
        }),
        showInformationMessage: () => Promise.resolve(),
    },
}));

import {
    getIpcDirs,
    ensureAllIpcDirs,
    writeUiHeartbeat,
    readUiHeartbeat,
    writeAgentHeartbeat,
    readAgentHeartbeat,
    isAgentDisconnected,
    pollForResponseSlice,
    pruneExpiredIpcFiles,
} from "../src/core/plannerIpc.js";
import { LIMITS } from "../src/core/constants.js";
import { McpBridge } from "../src/McpBridge.js";
import type { FormViewProvider } from "../src/FormViewProvider.js";
import type { AlignmentFormRequest, AlignmentFormResponse } from "../src/types.js";

describe("Bounded Planner IPC Coordination", () => {
    let tempIpcRoot: string;

    beforeEach(async () => {
        tempIpcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-ipc-test-"));
        process.env.ANTIGRAVITY_FORMS_DIR = tempIpcRoot;
        await ensureAllIpcDirs(tempIpcRoot);
    });

    afterEach(async () => {
        delete process.env.ANTIGRAVITY_FORMS_DIR;
        try {
            fs.rmSync(tempIpcRoot, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("ensures all IPC v2 directories exist including events and impacts", () => {
        const dirs = getIpcDirs(tempIpcRoot);
        expect(fs.existsSync(dirs.requests)).toBe(true);
        expect(fs.existsSync(dirs.claimed)).toBe(true);
        expect(fs.existsSync(dirs.cancelled)).toBe(true);
        expect(fs.existsSync(dirs.responses)).toBe(true);
        expect(fs.existsSync(dirs.failed)).toBe(true);
        expect(fs.existsSync(dirs.events)).toBe(true);
        expect(fs.existsSync(dirs.impacts)).toBe(true);
    });

    it("writes and reads UI interaction heartbeats atomically", async () => {
        const requestId = "align_test_12345678";
        const now = Date.now();
        await writeUiHeartbeat(tempIpcRoot, {
            requestId,
            lastUserActivityAt: now,
            inactivityTimeoutMs: 300_000,
        });

        const readBack = await readUiHeartbeat(tempIpcRoot, requestId);
        expect(readBack).not.toBeNull();
        expect(readBack?.requestId).toBe(requestId);
        expect(readBack?.lastUserActivityAt).toBe(now);
        expect(readBack?.inactivityTimeoutMs).toBe(300_000);
    });

    it("writes and reads Agent polling heartbeats and tracks state transitions", async () => {
        const requestId = "align_test_87654321";
        const now = Date.now();
        await writeAgentHeartbeat(tempIpcRoot, {
            requestId,
            origin: "antigravity",
            lastPollAt: now,
            state: "polling",
        });

        let readBack = await readAgentHeartbeat(tempIpcRoot, requestId);
        expect(readBack?.origin).toBe("antigravity");
        expect(readBack?.state).toBe("polling");
        expect(isAgentDisconnected(readBack, now)).toBe(false);

        // Transition to between_slices
        await writeAgentHeartbeat(tempIpcRoot, {
            requestId,
            origin: "antigravity",
            lastPollAt: now,
            state: "between_slices",
        });
        readBack = await readAgentHeartbeat(tempIpcRoot, requestId);
        expect(readBack?.state).toBe("between_slices");
        expect(isAgentDisconnected(readBack, now)).toBe(false);

        // Stale between_slices (>20s) evaluates as disconnected
        expect(isAgentDisconnected(readBack, now + LIMITS.PLANNER_AGENT_SLICE_GAP_MS + 1000)).toBe(true);

        // Aborted evaluates as disconnected immediately
        await writeAgentHeartbeat(tempIpcRoot, {
            requestId,
            origin: "antigravity",
            lastPollAt: now,
            state: "aborted",
        });
        readBack = await readAgentHeartbeat(tempIpcRoot, requestId);
        expect(isAgentDisconnected(readBack, now)).toBe(true);

        // Missing heartbeat (null) evaluates to false (unknown)
        expect(isAgentDisconnected(null)).toBe(false);
    });

    it("returns pending with userActive when bounded slice expires without response", async () => {
        const requestId = "align_test_pending_slice";
        const dirs = getIpcDirs(tempIpcRoot);

        // Place claimed marker so it does not time out as unclaimed
        fs.writeFileSync(path.join(dirs.claimed, `${requestId}.json`), JSON.stringify({ requestId }));

        // UI heartbeat indicating recent interaction
        await writeUiHeartbeat(tempIpcRoot, {
            requestId,
            lastUserActivityAt: Date.now(),
            inactivityTimeoutMs: 300_000,
        });

        // Run short slice of 100ms
        const outcome = await pollForResponseSlice({
            ipcRoot: tempIpcRoot,
            requestId,
            sliceDurationMs: 100,
            origin: "antigravity",
        });

        expect(outcome.outcome).toBe("pending");
        if (outcome.outcome === "pending") {
            expect(outcome.requestId).toBe(requestId);
            expect(outcome.userActive).toBe(true);
            expect(outcome.remainingInactivitySec).toBeGreaterThan(0);
        }

        // Verify agent heartbeat transitioned to between_slices
        const agentHb = await readAgentHeartbeat(tempIpcRoot, requestId);
        expect(agentHb?.state).toBe("between_slices");
    });

    it("handles host cancellation via AbortSignal immediately and writes aborted state", async () => {
        const requestId = "align_test_abort_signal";
        const dirs = getIpcDirs(tempIpcRoot);
        fs.writeFileSync(path.join(dirs.claimed, `${requestId}.json`), JSON.stringify({ requestId }));

        const controller = new AbortController();
        const startTime = Date.now();

        // Abort after 40ms
        setTimeout(() => {
            controller.abort();
        }, 40);

        const outcome = await pollForResponseSlice({
            ipcRoot: tempIpcRoot,
            requestId,
            sliceDurationMs: 10_000, // 10 seconds slice
            origin: "antigravity",
            signal: controller.signal,
        });

        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeLessThan(1000); // Exited promptly upon abort
        expect(outcome.outcome).toBe("pending");
        if (outcome.outcome === "pending") {
            expect(outcome.userActive).toBe(false);
        }

        const agentHb = await readAgentHeartbeat(tempIpcRoot, requestId);
        expect(agentHb?.state).toBe("aborted");
        expect(isAgentDisconnected(agentHb)).toBe(true);
    });

    it("detects unclaimed timeout when extension is offline and unlinks request file", async () => {
        const requestId = "align_test_unclaimed_full";
        const dirs = getIpcDirs(tempIpcRoot);
        const reqPath = path.join(dirs.requests, `${requestId}.json`);
        fs.writeFileSync(reqPath, JSON.stringify({ requestId, title: "Unclaimed Test" }));

        // Advance simulated time past LIMITS.PLANNER_UNCLAIMED_TIMEOUT_MS (15s)
        let simTime = Date.now();
        const spyNow = vi.spyOn(Date, "now").mockImplementation(() => {
            simTime += 2000;
            return simTime;
        });

        try {
            const outcome = await pollForResponseSlice({
                ipcRoot: tempIpcRoot,
                requestId,
                sliceDurationMs: 30_000,
            });

            expect(outcome.outcome).toBe("unclaimed_timeout");
            // Request file should be unlinked upon unclaimed timeout
            expect(fs.existsSync(reqPath)).toBe(false);
        } finally {
            spyNow.mockRestore();
        }
    });

    it("preserves responses durably and allows idempotent repeat retrieval", async () => {
        const requestId = "align_test_durable_response";
        const dirs = getIpcDirs(tempIpcRoot);
        const respPath = path.join(dirs.responses, `${requestId}.json`);

        const durableData = {
            action: "submit" as const,
            requestId,
            completedAt: Date.now(),
            data: { field_1: "Answer Value" },
        };
        fs.writeFileSync(respPath, JSON.stringify(durableData));

        // First poll
        const outcome1 = await pollForResponseSlice({
            ipcRoot: tempIpcRoot,
            requestId,
            sliceDurationMs: 100,
        });
        expect(outcome1.outcome).toBe("response");
        if (outcome1.outcome === "response") {
            expect(outcome1.response.requestId).toBe(requestId);
            expect(outcome1.response.data?.field_1).toBe("Answer Value");
        }

        // Response file MUST NOT be deleted
        expect(fs.existsSync(respPath)).toBe(true);

        // Second poll retrieves identical response idempotently
        const outcome2 = await pollForResponseSlice({
            ipcRoot: tempIpcRoot,
            requestId,
            sliceDurationMs: 100,
        });
        expect(outcome2.outcome).toBe("response");
        if (outcome2.outcome === "response") {
            expect(outcome2.response.data?.field_1).toBe("Answer Value");
        }
    });

    it("prunes expired IPC files exceeding retention TTL while preserving live files", async () => {
        const dirs = getIpcDirs(tempIpcRoot);
        const now = Date.now();
        const oldTime = now - LIMITS.PLANNER_ANSWER_RETENTION_TTL_MS - 60_000;

        // Old response file
        const oldRespPath = path.join(dirs.responses, "old_resp.json");
        fs.writeFileSync(oldRespPath, JSON.stringify({ requestId: "old_resp", completedAt: oldTime }));
        fs.utimesSync(oldRespPath, oldTime / 1000, oldTime / 1000);

        // Fresh response file
        const freshRespPath = path.join(dirs.responses, "fresh_resp.json");
        fs.writeFileSync(freshRespPath, JSON.stringify({ requestId: "fresh_resp", completedAt: now }));

        // Old events file
        const oldEventPath = path.join(dirs.events, "old_event.ui.json");
        fs.writeFileSync(oldEventPath, JSON.stringify({ requestId: "old_event" }));
        fs.utimesSync(oldEventPath, oldTime / 1000, oldTime / 1000);

        // Live request and claimed files (MUST NEVER BE PRUNED)
        const liveReqPath = path.join(dirs.requests, "live_req.json");
        fs.writeFileSync(liveReqPath, JSON.stringify({ requestId: "live_req" }));
        fs.utimesSync(liveReqPath, oldTime / 1000, oldTime / 1000);

        const liveClaimedPath = path.join(dirs.claimed, "live_claimed.json");
        fs.writeFileSync(liveClaimedPath, JSON.stringify({ requestId: "live_claimed" }));
        fs.utimesSync(liveClaimedPath, oldTime / 1000, oldTime / 1000);

        const prunedCount = await pruneExpiredIpcFiles(tempIpcRoot, now);
        expect(prunedCount).toBeGreaterThanOrEqual(2);

        expect(fs.existsSync(oldRespPath)).toBe(false);
        expect(fs.existsSync(oldEventPath)).toBe(false);
        expect(fs.existsSync(freshRespPath)).toBe(true);
        expect(fs.existsSync(liveReqPath)).toBe(true);
        expect(fs.existsSync(liveClaimedPath)).toBe(true);
    });

    it("verifies McpBridge non-blocking scan, active agent monitoring, and immediate busy rejection of competing requests", async () => {
        const dirs = getIpcDirs(tempIpcRoot);

        let resolveForm: (value: AlignmentFormResponse) => void = () => {};
        const formPromise = new Promise<AlignmentFormResponse>((resolve) => {
            resolveForm = resolve;
        });

        let agentStatusCalls: Array<{ requestId: string; isConnected: boolean }> = [];

        // Mock FormViewProvider
        const mockProvider = {
            onUserActivity: vi.fn(),
            getInactivityTimeoutMs: () => 300_000,
            showForm: vi.fn().mockImplementation((req: AlignmentFormRequest) => {
                return formPromise;
            }),
            setAgentConnectionStatus: vi.fn().mockImplementation((requestId: string, isConnected: boolean) => {
                agentStatusCalls.push({ requestId, isConnected });
            }),
        } as unknown as FormViewProvider;

        const bridge = new McpBridge(mockProvider);

        // 1. Drop primary request
        const req1Id = "align_req_primary_1111";
        const req1Path = path.join(dirs.requests, `${req1Id}.json`);
        fs.writeFileSync(req1Path, JSON.stringify({
            requestId: req1Id,
            title: "Primary Form",
            fields: [],
        }));

        // Execute first scan pass
        // @ts-expect-error accessing private method for targeted test
        await bridge._checkForRequests();

        // Verify request was claimed and showForm was invoked
        expect(mockProvider.showForm).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(req1Path)).toBe(false);
        expect(fs.existsSync(path.join(dirs.claimed, `${req1Id}.json`))).toBe(true);

        // Crucial test for Issue 1: scanner must NOT be locked while form is open!
        // @ts-expect-error accessing private property for test verification
        expect(bridge._isScanning).toBe(false);

        // 2. Drop competing request while primary form is still displayed
        const req2Id = "align_req_competing_2222";
        const req2Path = path.join(dirs.requests, `${req2Id}.json`);
        fs.writeFileSync(req2Path, JSON.stringify({
            requestId: req2Id,
            title: "Competing Form",
            fields: [],
        }));

        // Run second scan pass while primary form is open
        // @ts-expect-error accessing private method for targeted test
        await bridge._checkForRequests();

        // Competing request MUST be immediately rejected with orbit.planner_busy in failed/
        expect(fs.existsSync(req2Path)).toBe(false);
        const failed2Path = path.join(dirs.failed, `${req2Id}.json`);
        expect(fs.existsSync(failed2Path)).toBe(true);
        const failed2Data = JSON.parse(fs.readFileSync(failed2Path, "utf-8"));
        expect(failed2Data.error).toContain("orbit.planner_busy");

        // 3. Test agent disconnect monitoring while form is open
        // Write agent heartbeat with state: "aborted"
        await writeAgentHeartbeat(tempIpcRoot, {
            requestId: req1Id,
            origin: "antigravity",
            lastPollAt: Date.now(),
            state: "aborted",
        });

        // Run third scan pass while primary form is open
        // @ts-expect-error accessing private method for targeted test
        await bridge._checkForRequests();

        // Status banner must be toggled to disconnected (false)
        expect(mockProvider.setAgentConnectionStatus).toHaveBeenCalledWith(req1Id, false);

        // 4. Resolve the form submission
        resolveForm({
            requestId: req1Id,
            action: "submit",
            dismissed: false,
            data: { test_field: "completed_val" },
        });

        // Give async _processActiveForm a tick to complete
        await new Promise((r) => setTimeout(r, 50));

        // Response file must be written durably
        const resp1Path = path.join(dirs.responses, `${req1Id}.json`);
        expect(fs.existsSync(resp1Path)).toBe(true);
        const resp1Data = JSON.parse(fs.readFileSync(resp1Path, "utf-8"));
        expect(resp1Data.data.test_field).toBe("completed_val");

        // Claimed file must be cleaned up
        expect(fs.existsSync(path.join(dirs.claimed, `${req1Id}.json`))).toBe(false);
    });
});
