import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { acquireLock, releaseLock, withLock, LockHandle } from "../src/core/lock.js";

describe("lock operations (N-03)", () => {
    let mockBrainRoot: string;

    beforeEach(() => {
        mockBrainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-lock-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(mockBrainRoot, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("acquireLock creates lock file and releaseLock removes it", async () => {
        const handle = await acquireLock("test_task", { brainRoot: mockBrainRoot });
        expect(fs.existsSync(handle.lockPath)).toBe(true);

        const content = JSON.parse(fs.readFileSync(handle.lockPath, "utf-8"));
        expect(content.pid).toBe(process.pid);
        expect(content.token).toBe(handle.token);

        await releaseLock(handle);
        expect(fs.existsSync(handle.lockPath)).toBe(false);
    });

    it("releaseLock only unlinks if lock token matches (N-03)", async () => {
        const handle = await acquireLock("token_test", { brainRoot: mockBrainRoot });
        expect(fs.existsSync(handle.lockPath)).toBe(true);

        // Simulate another process stealing or replacing lock with a different token
        const fakeHandle: LockHandle = {
            lockName: handle.lockName,
            lockPath: handle.lockPath,
            token: "different-token-uuid",
            acquiredAt: Date.now(),
        };

        // Releasing with fakeHandle must NOT delete the real lock file!
        await releaseLock(fakeHandle);
        expect(fs.existsSync(handle.lockPath)).toBe(true);

        // Releasing with the genuine handle must delete it
        await releaseLock(handle);
        expect(fs.existsSync(handle.lockPath)).toBe(false);
    });

    it("withLock safely acquires and releases lock around execution", async () => {
        let insideLockRan = false;
        const result = await withLock(
            "critical_op",
            async () => {
                insideLockRan = true;
                return 42;
            },
            { brainRoot: mockBrainRoot }
        );

        expect(insideLockRan).toBe(true);
        expect(result).toBe(42);

        const lockPath = path.join(mockBrainRoot, ".locks", "critical_op.lock");
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("withLock releases lock even when error occurs inside block", async () => {
        await expect(
            withLock(
                "failing_op",
                async () => {
                    throw new Error("intentional failure");
                },
                { brainRoot: mockBrainRoot }
            )
        ).rejects.toThrow("intentional failure");

        const lockPath = path.join(mockBrainRoot, ".locks", "failing_op.lock");
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("breaks stale locks after staleMs", async () => {
        const locksDir = path.join(mockBrainRoot, ".locks");
        fs.mkdirSync(locksDir, { recursive: true });
        const staleLockPath = path.join(locksDir, "stale_op.lock");

        // Create a stale lock from 1 minute ago
        const staleMeta = { pid: 999999, token: "stale-token", ts: Date.now() - 60000, acquiredAt: Date.now() - 60000 };
        fs.writeFileSync(staleLockPath, JSON.stringify(staleMeta), "utf-8");

        const handle = await acquireLock("stale_op", {
            brainRoot: mockBrainRoot,
            staleMs: 5000,
        });

        expect(handle).toBeDefined();
        await releaseLock(handle);
    });
});
