/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 Venturi-exe / VNTRCORP
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

import * as fs from "fs";
import * as path from "path";
import { IPC_DIRS, LIMITS } from "./constants.js";
import { assertSafeFileName } from "./paths.js";
import { writeJsonAtomic, readJsonSafe, ensureDirSafe } from "./fsx.js";
import type {
    PlannerUiHeartbeat,
    PlannerAgentHeartbeat,
    PlannerProducerOrigin,
    DurablePlannerResponse,
} from "../types.js";

/**
 * Returns paths for all IPC v2 directories.
 */
export function getIpcDirs(ipcRoot: string) {
    return {
        ipcRoot,
        requests: path.join(ipcRoot, IPC_DIRS.REQUESTS),
        claimed: path.join(ipcRoot, IPC_DIRS.CLAIMED),
        cancelled: path.join(ipcRoot, IPC_DIRS.CANCELLED),
        responses: path.join(ipcRoot, IPC_DIRS.RESPONSES),
        failed: path.join(ipcRoot, IPC_DIRS.FAILED),
        events: path.join(ipcRoot, IPC_DIRS.EVENTS),
        impacts: path.join(ipcRoot, IPC_DIRS.IMPACTS),
    };
}

/**
 * Ensures all IPC v2 directories exist with safe permissions.
 */
export async function ensureAllIpcDirs(ipcRoot: string): Promise<void> {
    const dirs = getIpcDirs(ipcRoot);
    await ensureDirSafe(dirs.requests);
    await ensureDirSafe(dirs.claimed);
    await ensureDirSafe(dirs.cancelled);
    await ensureDirSafe(dirs.responses);
    await ensureDirSafe(dirs.failed);
    await ensureDirSafe(dirs.events);
    await ensureDirSafe(dirs.impacts);
}

/**
 * Returns safe path for UI interaction heartbeat: events/{requestId}.ui.json
 */
export function getUiHeartbeatPath(ipcRoot: string, requestId: string): string {
    assertSafeFileName(requestId);
    return path.join(ipcRoot, IPC_DIRS.EVENTS, `${requestId}.ui.json`);
}

/**
 * Returns safe path for Agent polling heartbeat: events/{requestId}.agent.json
 */
export function getAgentHeartbeatPath(ipcRoot: string, requestId: string): string {
    assertSafeFileName(requestId);
    return path.join(ipcRoot, IPC_DIRS.EVENTS, `${requestId}.agent.json`);
}

/**
 * Writes or updates the UI interaction heartbeat atomically.
 */
export async function writeUiHeartbeat(ipcRoot: string, heartbeat: PlannerUiHeartbeat): Promise<void> {
    const filePath = getUiHeartbeatPath(ipcRoot, heartbeat.requestId);
    await writeJsonAtomic(filePath, heartbeat);
}

/**
 * Reads UI interaction heartbeat safely. Returns null if missing or unreadable.
 */
export async function readUiHeartbeat(ipcRoot: string, requestId: string): Promise<PlannerUiHeartbeat | null> {
    const filePath = getUiHeartbeatPath(ipcRoot, requestId);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return await readJsonSafe<PlannerUiHeartbeat>(filePath);
    } catch {
        return null;
    }
}

/**
 * Writes or updates the Agent polling heartbeat atomically.
 */
export async function writeAgentHeartbeat(ipcRoot: string, heartbeat: PlannerAgentHeartbeat): Promise<void> {
    const filePath = getAgentHeartbeatPath(ipcRoot, heartbeat.requestId);
    await writeJsonAtomic(filePath, heartbeat);
}

/**
 * Reads Agent polling heartbeat safely. Returns null if missing or unreadable.
 */
export async function readAgentHeartbeat(ipcRoot: string, requestId: string): Promise<PlannerAgentHeartbeat | null> {
    const filePath = getAgentHeartbeatPath(ipcRoot, requestId);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return await readJsonSafe<PlannerAgentHeartbeat>(filePath);
    } catch {
        return null;
    }
}

/**
 * Evaluates whether an agent has disconnected from an active form.
 * Returns false if heartbeat is missing (older or foreign producers remain "unknown").
 */
export function isAgentDisconnected(heartbeat: PlannerAgentHeartbeat | null, now: number = Date.now()): boolean {
    if (!heartbeat) {
        return false;
    }
    if (heartbeat.state === "aborted") {
        return true;
    }
    const elapsed = now - heartbeat.lastPollAt;
    if (heartbeat.state === "polling") {
        return elapsed > LIMITS.PLANNER_AGENT_POLL_STALE_MS;
    }
    if (heartbeat.state === "between_slices") {
        return elapsed > LIMITS.PLANNER_AGENT_SLICE_GAP_MS;
    }
    return false;
}

export type PollSliceOutcome =
    | { outcome: "response"; response: DurablePlannerResponse }
    | { outcome: "failed"; error: string }
    | { outcome: "cancelled"; message?: string }
    | { outcome: "unclaimed_timeout"; message: string }
    | { outcome: "inactivity_timeout"; message: string }
    | { outcome: "pending"; requestId: string; userActive: boolean; remainingInactivitySec: number };

export interface PollSliceOptions {
    ipcRoot: string;
    requestId: string;
    sliceDurationMs?: number;
    origin?: PlannerProducerOrigin;
    signal?: AbortSignal;
    onProgress?: (info: { elapsedMs: number }) => void;
}

/**
 * Executes a single bounded poll slice (default 40s) against IPC directories.
 * Idempotently checks for cached responses first before polling.
 */
export async function pollForResponseSlice(options: PollSliceOptions): Promise<PollSliceOutcome> {
    const {
        ipcRoot,
        requestId,
        sliceDurationMs = LIMITS.PLANNER_POLL_SLICE_MS,
        origin = "antigravity",
        signal,
        onProgress,
    } = options;

    assertSafeFileName(requestId);
    const dirs = getIpcDirs(ipcRoot);
    const responseFile = path.join(dirs.responses, `${requestId}.json`);
    const requestFile = path.join(dirs.requests, `${requestId}.json`);
    const claimedFile = path.join(dirs.claimed, `${requestId}.json`);
    const failedFile = path.join(dirs.failed, `${requestId}.json`);
    const cancelledFile = path.join(dirs.cancelled, `${requestId}.json`);

    // 1. Instant check: If response is already delivered or cached, return immediately
    if (fs.existsSync(responseFile)) {
        try {
            const data = await readJsonSafe<DurablePlannerResponse>(responseFile);
            return { outcome: "response", response: data };
        } catch (err) {
            // Transient read retry
            await new Promise((r) => setTimeout(r, 50));
            if (fs.existsSync(responseFile)) {
                const retryData = await readJsonSafe<DurablePlannerResponse>(responseFile);
                return { outcome: "response", response: retryData };
            }
        }
    }

    if (fs.existsSync(failedFile)) {
        try {
            const failData = await readJsonSafe<{ error?: string }>(failedFile);
            return { outcome: "failed", error: failData.error || "IPC processing failed in extension" };
        } catch {
            return { outcome: "failed", error: "IPC processing failed in extension" };
        }
    }

    if (fs.existsSync(cancelledFile)) {
        try {
            const cancelData = await readJsonSafe<{ reason?: string; message?: string }>(cancelledFile);
            return { outcome: "cancelled", message: cancelData.message || cancelData.reason || "Planning was cancelled." };
        } catch {
            return { outcome: "cancelled", message: "Planning was cancelled." };
        }
    }

    // 2. Write initial agent heartbeat (state: "polling")
    await writeAgentHeartbeat(ipcRoot, {
        requestId,
        origin,
        lastPollAt: Date.now(),
        state: "polling",
    });

    const startTime = Date.now();
    let lastHeartbeatWrite = startTime;
    const pollInterval = 500;

    while (Date.now() - startTime < sliceDurationMs) {
        const now = Date.now();

        // Check if aborted by host
        if (signal?.aborted) {
            try {
                await writeAgentHeartbeat(ipcRoot, {
                    requestId,
                    origin,
                    lastPollAt: now,
                    state: "aborted",
                });
            } catch { /* ok */ }
            return {
                outcome: "pending",
                requestId,
                userActive: false,
                remainingInactivitySec: 0,
            };
        }

        // Periodic agent heartbeat every 2s
        if (now - lastHeartbeatWrite >= LIMITS.PLANNER_AGENT_HEARTBEAT_MS) {
            lastHeartbeatWrite = now;
            try {
                await writeAgentHeartbeat(ipcRoot, {
                    requestId,
                    origin,
                    lastPollAt: now,
                    state: "polling",
                });
            } catch { /* ok */ }
            onProgress?.({ elapsedMs: now - startTime });
        }

        // Check for normal response
        if (fs.existsSync(responseFile)) {
            try {
                const data = await readJsonSafe<DurablePlannerResponse>(responseFile);
                return { outcome: "response", response: data };
            } catch { /* retry on next iteration */ }
        }

        // Check for failure marker
        if (fs.existsSync(failedFile)) {
            try {
                const failData = await readJsonSafe<{ error?: string }>(failedFile);
                return { outcome: "failed", error: failData.error || "IPC processing failed in extension" };
            } catch {
                return { outcome: "failed", error: "IPC processing failed in extension" };
            }
        }

        // Check for cancellation marker
        if (fs.existsSync(cancelledFile)) {
            try {
                const cancelData = await readJsonSafe<{ reason?: string; message?: string }>(cancelledFile);
                return { outcome: "cancelled", message: cancelData.message || cancelData.reason || "Planning was cancelled." };
            } catch {
                return { outcome: "cancelled", message: "Planning was cancelled." };
            }
        }

        // Check claim timeout (extension offline / not running)
        if (now - startTime > LIMITS.PLANNER_UNCLAIMED_TIMEOUT_MS) {
            const hasClaimed = fs.existsSync(claimedFile);
            const hasRequest = fs.existsSync(requestFile);
            if (!hasClaimed && hasRequest) {
                try { await fs.promises.unlink(requestFile); } catch { /* ok */ }
                return {
                    outcome: "unclaimed_timeout",
                    message: "Orbit extension is not active in the editor. Form was not claimed.",
                };
            }
        }

        // Check user inactivity from UI heartbeat
        const uiHeartbeat = await readUiHeartbeat(ipcRoot, requestId);
        if (uiHeartbeat) {
            const inactiveElapsed = now - uiHeartbeat.lastUserActivityAt;
            // 15-second grace period past webview countdown before MCP declares inactivity
            if (inactiveElapsed > uiHeartbeat.inactivityTimeoutMs + 15_000) {
                return {
                    outcome: "inactivity_timeout",
                    message: "Planning form timed out due to user inactivity.",
                };
            }
        }

        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, pollInterval);
            const onAbort = () => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
                resolve();
            };
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    // 3. Slice duration elapsed: transition to between_slices
    const endNow = Date.now();
    try {
        await writeAgentHeartbeat(ipcRoot, {
            requestId,
            origin,
            lastPollAt: endNow,
            state: "between_slices",
        });
    } catch { /* ok */ }

    const finalUi = await readUiHeartbeat(ipcRoot, requestId);
    const userActive = finalUi ? (endNow - finalUi.lastUserActivityAt < 30_000) : true;
    const remainingInactivitySec = finalUi
        ? Math.max(0, Math.round((finalUi.inactivityTimeoutMs - (endNow - finalUi.lastUserActivityAt)) / 1000))
        : 300;

    return {
        outcome: "pending",
        requestId,
        userActive,
        remainingInactivitySec,
    };
}

/**
 * Periodically cleans up old terminal IPC files exceeding retention TTL (30 minutes).
 * Never deletes live claimed or active request files.
 */
export async function pruneExpiredIpcFiles(ipcRoot: string, now: number = Date.now()): Promise<number> {
    const dirs = getIpcDirs(ipcRoot);
    const ttlMs = LIMITS.PLANNER_ANSWER_RETENTION_TTL_MS;
    let prunedCount = 0;

    const terminalDirs = [dirs.responses, dirs.failed, dirs.cancelled, dirs.events];

    for (const dir of terminalDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = await fs.promises.readdir(dir);
            for (const file of files) {
                if (!file.endsWith(".json")) continue;
                const fullPath = path.join(dir, file);
                try {
                    const stats = await fs.promises.stat(fullPath);
                    let fileCompletedAt = stats.mtimeMs;

                    if (dir === dirs.responses) {
                        try {
                            const data = await readJsonSafe<{ completedAt?: number }>(fullPath);
                            if (typeof data.completedAt === "number") {
                                fileCompletedAt = data.completedAt;
                            }
                        } catch { /* fallback to mtimeMs */ }
                    }

                    if (now - fileCompletedAt > ttlMs) {
                        await fs.promises.unlink(fullPath);
                        prunedCount++;
                    }
                } catch { /* ignore individual unlink errors */ }
            }
        } catch { /* ignore directory read errors */ }
    }

    return prunedCount;
}
