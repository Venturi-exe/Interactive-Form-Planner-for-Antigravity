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

    it("breaks 0-byte or corrupted lock file after staleMs without deadlock (M-02)", async () => {
        const locksDir = path.join(mockBrainRoot, ".locks");
        fs.mkdirSync(locksDir, { recursive: true });
        const corruptLockPath = path.join(locksDir, "corrupt_op.lock");

        // Create an empty (0-byte) lock file from 10 seconds ago
        fs.writeFileSync(corruptLockPath, "", "utf-8");
        const tenSecondsAgo = (Date.now() - 10000) / 1000;
        fs.utimesSync(corruptLockPath, tenSecondsAgo, tenSecondsAgo);

        const startTime = Date.now();
        const handle = await acquireLock("corrupt_op", {
            brainRoot: mockBrainRoot,
            staleMs: 2000,
            maxWaitMs: 5000,
        });

        expect(handle).toBeDefined();
        // Must acquire promptly without waiting for maxWaitMs timeout
        expect(Date.now() - startTime).toBeLessThan(2000);

        // Verify fresh metadata written
        const freshContent = JSON.parse(fs.readFileSync(corruptLockPath, "utf-8"));
        expect(freshContent.token).toBe(handle.token);

        await releaseLock(handle);
    });

    it("handles race-free concurrent stale steals safely (M-03)", async () => {
        const locksDir = path.join(mockBrainRoot, ".locks");
        fs.mkdirSync(locksDir, { recursive: true });
        const staleLockPath = path.join(locksDir, "race_op.lock");

        // Seed stale lock
        const staleMeta = { pid: 999999, token: "stale-race-token", ts: Date.now() - 30000, acquiredAt: Date.now() - 30000 };
        fs.writeFileSync(staleLockPath, JSON.stringify(staleMeta), "utf-8");

        // Run 2 concurrent lock operations
        const results = await Promise.all([
            withLock("race_op", async () => {
                await new Promise((r) => setTimeout(r, 20));
                return "winner_A";
            }, { brainRoot: mockBrainRoot, staleMs: 2000 }),
            withLock("race_op", async () => {
                await new Promise((r) => setTimeout(r, 20));
                return "winner_B";
            }, { brainRoot: mockBrainRoot, staleMs: 2000 }),
        ]);

        expect(results).toContain("winner_A");
        expect(results).toContain("winner_B");
    });
});
