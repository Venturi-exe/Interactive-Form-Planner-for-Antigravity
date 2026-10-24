import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { IPC_DIRS } from "../src/core/constants.js";
import { writeJsonAtomic, readJsonSafe } from "../src/core/fsx.js";

describe("IPC v2 protocol communication", () => {
    let mockIpcDir: string;
    let requestsDir: string;
    let claimedDir: string;
    let responsesDir: string;
    let cancelledDir: string;
    let failedDir: string;

    beforeEach(() => {
        mockIpcDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-ipc-test-"));
        requestsDir = path.join(mockIpcDir, IPC_DIRS.REQUESTS);
        claimedDir = path.join(mockIpcDir, IPC_DIRS.CLAIMED);
        responsesDir = path.join(mockIpcDir, IPC_DIRS.RESPONSES);
        cancelledDir = path.join(mockIpcDir, IPC_DIRS.CANCELLED);
        failedDir = path.join(mockIpcDir, IPC_DIRS.FAILED);

        fs.mkdirSync(requestsDir, { recursive: true });
        fs.mkdirSync(claimedDir, { recursive: true });
        fs.mkdirSync(responsesDir, { recursive: true });
        fs.mkdirSync(cancelledDir, { recursive: true });
        fs.mkdirSync(failedDir, { recursive: true });
    });

    afterEach(() => {
        try {
            fs.rmSync(mockIpcDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("verifies atomic claim workflow from requests to claimed", async () => {
        const requestId = "test_req_001";
        const requestFile = path.join(requestsDir, `${requestId}.json`);
        const claimedFile = path.join(claimedDir, `${requestId}.json`);

        await writeJsonAtomic(requestFile, {
            requestId,
            title: "Test Plan",
            fields: [],
        });

        expect(fs.existsSync(requestFile)).toBe(true);
        expect(fs.existsSync(claimedFile)).toBe(false);

        // Simulate extension claiming the request
        await fs.promises.rename(requestFile, claimedFile);

        expect(fs.existsSync(requestFile)).toBe(false);
        expect(fs.existsSync(claimedFile)).toBe(true);

        const claimedData = await readJsonSafe<{ requestId: string }>(claimedFile);
        expect(claimedData?.requestId).toBe(requestId);
    });

    it("verifies response delivery and claimed file cleanup", async () => {
        const requestId = "test_req_002";
        const claimedFile = path.join(claimedDir, `${requestId}.json`);
        const responseFile = path.join(responsesDir, `${requestId}.json`);

        await writeJsonAtomic(claimedFile, { requestId });

        // Simulate response delivery
        await writeJsonAtomic(responseFile, {
            requestId,
            action: "submit",
            dismissed: false,
            data: { field_1: "option_a" },
        });

        // Clean claimed file
        await fs.promises.unlink(claimedFile);

        expect(fs.existsSync(claimedFile)).toBe(false);
        expect(fs.existsSync(responseFile)).toBe(true);

        const responseData = await readJsonSafe<{ action: string; dismissed: boolean }>(responseFile);
        expect(responseData?.action).toBe("submit");
        expect(responseData?.dismissed).toBe(false);
    });

    it("verifies failure marker handling", async () => {
        const requestId = "test_req_003";
        const claimedFile = path.join(claimedDir, `${requestId}.json`);
        const failedFile = path.join(failedDir, `${requestId}.json`);

        await writeJsonAtomic(claimedFile, { requestId });

        // Simulate extension failure
        await writeJsonAtomic(failedFile, {
            requestId,
            error: "Webview crashed",
        });
        await fs.promises.unlink(claimedFile);

        expect(fs.existsSync(claimedFile)).toBe(false);
        expect(fs.existsSync(failedFile)).toBe(true);

        const failData = await readJsonSafe<{ error: string }>(failedFile);
        expect(failData?.error).toBe("Webview crashed");
    });

    it("verifies cancellation marker handling", async () => {
        const requestId = "test_req_004";
        const cancelledFile = path.join(cancelledDir, `${requestId}.json`);

        await writeJsonAtomic(cancelledFile, {
            requestId,
            reason: "User cancelled planning session",
        });

        expect(fs.existsSync(cancelledFile)).toBe(true);
        const cancelData = await readJsonSafe<{ reason: string }>(cancelledFile);
        expect(cancelData?.reason).toBe("User cancelled planning session");
    });
});
