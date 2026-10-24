import * as fs from "fs";
import * as path from "path";
import { getBrainRoot, BRAIN_DIRS, LIMITS } from "./constants.js";
import { ensureDirSafe } from "./fsx.js";

export interface LockOptions {
    staleMs?: number;
    maxWaitMs?: number;
    pollIntervalMs?: number;
    brainRoot?: string;
}

export interface LockHandle {
    lockName: string;
    lockPath: string;
    acquiredAt: number;
}

interface LockMetadata {
    pid: number;
    acquiredAt: number;
}

/**
 * Acquires a cross-process file-based lock with stale lock detection.
 */
export async function acquireLock(
    lockName: string,
    options: LockOptions = {}
): Promise<LockHandle> {
    const brainRoot = options.brainRoot || getBrainRoot();
    const staleMs = options.staleMs || LIMITS.LOCK_STALE_MS;
    const maxWaitMs = options.maxWaitMs || LIMITS.MAX_LOCK_WAIT_MS;
    const pollIntervalMs = options.pollIntervalMs || 50;

    const sanitizedName = lockName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const locksDir = path.join(brainRoot, BRAIN_DIRS.LOCKS);
    await ensureDirSafe(locksDir);

    const lockPath = path.join(locksDir, `${sanitizedName}.lock`);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        try {
            // Atomic file creation with 'wx' flag
            const fileHandle = await fs.promises.open(lockPath, "wx");
            const acquiredAt = Date.now();
            const meta: LockMetadata = { pid: process.pid, acquiredAt };
            await fileHandle.writeFile(JSON.stringify(meta), "utf-8");
            await fileHandle.close();

            return {
                lockName,
                lockPath,
                acquiredAt,
            };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === "EEXIST") {
                // Check if existing lock is stale
                try {
                    const content = await fs.promises.readFile(lockPath, "utf-8");
                    const meta = JSON.parse(content) as LockMetadata;
                    if (Date.now() - meta.acquiredAt > staleMs) {
                        // Stale lock detected, remove and immediately retry
                        await fs.promises.unlink(lockPath);
                        continue;
                    }
                } catch {
                    // Lock file might have been released in the interim, continue to retry
                }

                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            } else {
                throw err;
            }
        }
    }

    throw new Error(`Timeout acquiring lock '${lockName}' after ${maxWaitMs}ms`);
}

/**
 * Releases an acquired lock.
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
    try {
        if (fs.existsSync(handle.lockPath)) {
            await fs.promises.unlink(handle.lockPath);
        }
    } catch { /* ignore if already unlocked */ }
}

/**
 * Executes an async function inside a critical section protected by an advisory lock.
 */
export async function withLock<T>(
    lockName: string,
    fn: () => Promise<T>,
    options?: LockOptions
): Promise<T> {
    const handle = await acquireLock(lockName, options);
    try {
        return await fn();
    } finally {
        await releaseLock(handle);
    }
}
