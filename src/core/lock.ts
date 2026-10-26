import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBrainRoot, BRAIN_DIRS, LIMITS } from "./constants.js";
import { ensureDirSafe, writeAtomic } from "./fsx.js";

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
 * Cleans up leftover *.steal.* and *.tmp.* files older than staleMs in locksDir (P-05, Q-03).
 * Evaluates steal artifact age using embedded creation timestamp to prevent deleting files mid-check.
 */
async function cleanStaleLockArtifacts(locksDir: string, staleMs: number): Promise<void> {
    try {
        const entries = await fs.promises.readdir(locksDir);
        const now = Date.now();
        for (const entry of entries) {
            if (entry.includes(".steal.")) {
                // Q-03: Judge age by timestamp embedded in filename, not by file mtime
                const match = entry.match(/\.steal\.(\d+)\./);
                if (match) {
                    const fileTs = parseInt(match[1], 10);
                    if (now - fileTs > staleMs) {
                        const fullPath = path.join(locksDir, entry);
                        await fs.promises.unlink(fullPath).catch(() => {});
                    }
                } else {
                    // Legacy steal file without embedded timestamp: fall back to mtime
                    const fullPath = path.join(locksDir, entry);
                    try {
                        const stat = await fs.promises.stat(fullPath);
                        if (now - stat.mtimeMs > staleMs) {
                            await fs.promises.unlink(fullPath).catch(() => {});
                        }
                    } catch { /* ignore */ }
                }
            } else if (entry.includes(".tmp.")) {
                const fullPath = path.join(locksDir, entry);
                try {
                    const stat = await fs.promises.stat(fullPath);
                    if (now - stat.mtimeMs > staleMs) {
                        await fs.promises.unlink(fullPath).catch(() => {});
                    }
                } catch { /* ignore */ }
            }
        }
    } catch { /* ignore */ }
}

/**
 * Acquires a cross-process file-based lock with token ownership and heartbeat protection.
 * Hardened against corrupt/empty file deadlocks (M-02), stale-steal races (M-03, P-05),
 * post-acquire read races (P-03), and heartbeat staleness races (P-04).
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
    await cleanStaleLockArtifacts(locksDir, staleMs);

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

            // Post-acquire verification with retry and safe cleanup (M-03, P-03)
            let readVerified = false;
            let checkToken: string | undefined;

            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const checkContent = await fs.promises.readFile(lockPath, "utf-8");
                    const checkMeta = JSON.parse(checkContent) as LockMetadata;
                    checkToken = checkMeta.token;
                    if (checkToken === token) {
                        readVerified = true;
                        break;
                    } else {
                        // Confirmed different token - another process won or replaced it
                        break;
                    }
                } catch {
                    if (attempt === 0) {
                        await new Promise((r) => setTimeout(r, 25));
                    }
                }
            }

            if (!readVerified) {
                if (checkToken && checkToken !== token) {
                    // Confirmed different token: do not unlink another process's lock
                    continue;
                }
                // Read failed or unparseable: unlink only if file is empty or contains our own token
                try {
                    let shouldUnlink = false;
                    try {
                        const raw = await fs.promises.readFile(lockPath, "utf-8");
                        if (!raw || raw.length === 0 || raw.includes(token)) {
                            shouldUnlink = true;
                        }
                    } catch {
                        const stat = await fs.promises.stat(lockPath).catch(() => null);
                        if (stat && stat.size === 0) {
                            shouldUnlink = true;
                        }
                    }
                    if (shouldUnlink) {
                        await fs.promises.unlink(lockPath).catch(() => {});
                    }
                } catch { /* ignore */ }
                continue;
            }

            // Heartbeat timer: touch mtime via fs.promises.utimes every heartbeatIntervalMs (P-04)
            // Measuring staleness by mtime ensures un-renamed atomic activity without rewriting file contents
            const heartbeatTimer = setInterval(async () => {
                try {
                    const now = new Date();
                    await fs.promises.utimes(lockPath, now, now);
                } catch {
                    // Ignored: ENOENT if stolen/released, EPERM/EBUSY on Windows if held open by another process
                }
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
                // Check if existing lock is stale, measured by mtime (M-02, M-03, P-04)
                try {
                    let isStale = false;
                    let staleToken: string | undefined;
                    let staleMtime: number | undefined;

                    try {
                        const stat = await fs.promises.stat(lockPath);
                        let contentMeta: LockMetadata | undefined;
                        try {
                            const content = await fs.promises.readFile(lockPath, "utf-8");
                            contentMeta = JSON.parse(content) as LockMetadata;
                            staleToken = contentMeta.token;
                        } catch {
                            // 0-byte or corrupt file
                        }

                        // A lock is stale if mtime is older than staleMs, or if content ts is older than staleMs
                        const lastActive = stat.mtimeMs;
                        if (Date.now() - lastActive > staleMs) {
                            isStale = true;
                            staleMtime = stat.mtimeMs;
                        } else if (contentMeta && contentMeta.ts && Date.now() - contentMeta.ts > staleMs) {
                            // For test fixtures or legacy clients that write ts in JSON without backdating mtime
                            isStale = true;
                            staleMtime = stat.mtimeMs;
                        }
                    } catch {
                        // File disappeared in the interim
                    }

                    if (isStale) {
                        // Safe Stale Steal via atomic rename to a unique path (M-03, P-05, Q-03)
                        const stealTs = Date.now();
                        const stealId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
                        const stealPath = `${lockPath}.steal.${stealTs}.${stealId}`;
                        try {
                            await fs.promises.rename(lockPath, stealPath);

                            // Confirm that renamed file still holds the stale token or mtime (M-03, P-05)
                            let stealVerified = false;
                            try {
                                const renamedStat = await fs.promises.stat(stealPath);
                                if (staleToken) {
                                    const renamedContent = await fs.promises.readFile(stealPath, "utf-8");
                                    const renamedMeta = JSON.parse(renamedContent) as LockMetadata;
                                    if (renamedMeta.token === staleToken) {
                                        stealVerified = true;
                                    }
                                } else if (staleMtime) {
                                    if (renamedStat.mtimeMs === staleMtime || Date.now() - renamedStat.mtimeMs > staleMs) {
                                        stealVerified = true;
                                    }
                                } else if (Date.now() - renamedStat.mtimeMs > staleMs) {
                                    stealVerified = true;
                                }
                            } catch {
                                // Corrupt or unreadable file: treat as stale (M-02)
                                stealVerified = true;
                            }

                            if (stealVerified) {
                                // Confirmed stale: delete stealPath to complete takeover
                                await fs.promises.unlink(stealPath).catch(() => {});
                            } else {
                                // Steal check failed: file was not stale after all.
                                // Do NOT blindly rename back over lockPath. Use fs.link which fails with EEXIST if a new lock exists (P-05, Q-04).
                                let restored = false;
                                let alreadyReplaced = false;

                                for (let attempt = 0; attempt < 2; attempt++) {
                                    try {
                                        await fs.promises.link(stealPath, lockPath);
                                        restored = true;
                                        break;
                                    } catch (linkErr: unknown) {
                                        const linkCode = (linkErr as { code?: string })?.code;
                                        if (linkCode === "EEXIST") {
                                            // A new lock already exists; skip restore safely (P-05)
                                            alreadyReplaced = true;
                                            break;
                                        }
                                        if (attempt === 0) {
                                            await new Promise((r) => setTimeout(r, 25));
                                        }
                                    }
                                }

                                if (!restored && !alreadyReplaced) {
                                    // Hardlink failed for a non-EEXIST reason (e.g. filesystem without hardlink support).
                                    // Fallback: restore via rename if lockPath does not exist (N-08)
                                    try {
                                        if (!fs.existsSync(lockPath)) {
                                            await fs.promises.rename(stealPath, lockPath);
                                            restored = true;
                                        } else {
                                            alreadyReplaced = true;
                                        }
                                    } catch {
                                        // Another process took over lockPath
                                    }
                                }

                                // Only unlink stealPath if restore succeeded or another lock replaced it (N-08)
                                if (restored || alreadyReplaced) {
                                    await fs.promises.unlink(stealPath).catch(() => {});
                                }
                            }
                            continue;
                        } catch {
                            // Another process won the rename or lock was unlinked
                        }
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
