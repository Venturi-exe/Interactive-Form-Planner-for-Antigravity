import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBrainRoot, BRAIN_DIRS, LIMITS } from "./constants.js";
import { ensureDirSafe } from "./fsx.js";

export interface LockOptions {
    staleMs?: number;
    maxWaitMs?: number;
    pollIntervalMs?: number;
    brainRoot?: string;
    heartbeatIntervalMs?: number;
}

export interface LockHandle {
    lockName: string;
    lockPath: string;
    token: string;
    acquiredAt: number;
    heartbeatTimer?: NodeJS.Timeout;
}

interface LockMetadata {
    pid: number;
    token: string;
    ts: number;
    acquiredAt: number;
}

/**
 * Acquires a cross-process file-based lock with token ownership and heartbeat protection.
 */
export async function acquireLock(
    lockName: string,
    options: LockOptions = {}
): Promise<LockHandle> {
    const brainRoot = options.brainRoot || getBrainRoot();
    const staleMs = options.staleMs || LIMITS.LOCK_STALE_MS;
    const maxWaitMs = options.maxWaitMs || LIMITS.MAX_LOCK_WAIT_MS;
    const pollIntervalMs = options.pollIntervalMs || 50;
    const heartbeatIntervalMs = options.heartbeatIntervalMs || 5000;

    const sanitizedName = lockName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const locksDir = path.join(brainRoot, BRAIN_DIRS.LOCKS);
    await ensureDirSafe(locksDir);

    const lockPath = path.join(locksDir, `${sanitizedName}.lock`);
    const startTime = Date.now();
    const token = crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}_${Date.now()}`;

    while (Date.now() - startTime < maxWaitMs) {
        try {
            // Atomic file creation with 'wx' flag
            const fileHandle = await fs.promises.open(lockPath, "wx");
            const acquiredAt = Date.now();
            const meta: LockMetadata = { pid: process.pid, token, ts: acquiredAt, acquiredAt };
            await fileHandle.writeFile(JSON.stringify(meta), "utf-8");
            await fileHandle.close();

            // Heartbeat timer: refresh ts every heartbeatIntervalMs while lock is held (N-03)
            const heartbeatTimer = setInterval(async () => {
                try {
                    if (fs.existsSync(lockPath)) {
                        const content = await fs.promises.readFile(lockPath, "utf-8");
                        const currentMeta = JSON.parse(content) as LockMetadata;
                        if (currentMeta.token === token) {
                            currentMeta.ts = Date.now();
                            await fs.promises.writeFile(lockPath, JSON.stringify(currentMeta), "utf-8");
                        }
                    }
                } catch { /* ignore heartbeat race errors */ }
            }, heartbeatIntervalMs);

            if (heartbeatTimer.unref) {
                heartbeatTimer.unref();
            }

            return {
                lockName,
                lockPath,
                token,
                acquiredAt,
                heartbeatTimer,
            };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === "EEXIST") {
                // Check if existing lock is stale
                try {
                    const content = await fs.promises.readFile(lockPath, "utf-8");
                    const meta = JSON.parse(content) as LockMetadata;
                    const lastActive = meta.ts || meta.acquiredAt || 0;
                    if (Date.now() - lastActive > staleMs) {
                        // Stale lock detected, remove and immediately retry
                        try {
                            await fs.promises.unlink(lockPath);
                        } catch { /* already unlinked */ }
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
 * Releases an acquired lock only if the token matches.
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
    if (handle.heartbeatTimer) {
        clearInterval(handle.heartbeatTimer);
        handle.heartbeatTimer = undefined;
    }

    try {
        if (fs.existsSync(handle.lockPath)) {
            const content = await fs.promises.readFile(handle.lockPath, "utf-8");
            try {
                const meta = JSON.parse(content) as LockMetadata;
                // N-03: Release only if the token matches
                if (meta.token === handle.token) {
                    await fs.promises.unlink(handle.lockPath);
                }
            } catch {
                // If corrupted or legacy unparsed lock, remove it
                await fs.promises.unlink(handle.lockPath);
            }
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
