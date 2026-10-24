import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { FS_MODES, LIMITS } from "./constants.js";

/**
 * Atomically writes content to a target file.
 * Writes to a unique temp file first, then renames.
 * Includes Windows retry handling for EPERM/EBUSY transient locks.
 */
export async function writeAtomic(
    targetPath: string,
    content: string | Buffer,
    mode: number = FS_MODES.BRAIN_FILE
): Promise<void> {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true, mode: FS_MODES.BRAIN_DIR });
    }

    const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;

    try {
        await fs.promises.writeFile(tempPath, content, { mode });

        // Rename with retry on Windows EPERM/EBUSY
        let renamed = false;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await fs.promises.rename(tempPath, targetPath);
                renamed = true;
                break;
            } catch (err: unknown) {
                lastError = err;
                const code = (err as { code?: string })?.code;
                if (code === "EPERM" || code === "EBUSY" || code === "EEXIST") {
                    await new Promise((resolve) => setTimeout(resolve, 20 * Math.pow(2, attempt)));
                } else {
                    throw err;
                }
            }
        }

        if (!renamed) {
            // Fallback for stubbornly locked destination files: copy over and unlink temp
            try {
                await fs.promises.copyFile(tempPath, targetPath);
                await fs.promises.unlink(tempPath);
                renamed = true;
            } catch {
                throw lastError;
            }
        }
    } catch (err) {
        // Clean up temp file on failure
        if (fs.existsSync(tempPath)) {
            try {
                await fs.promises.unlink(tempPath);
            } catch { /* ignore cleanup error */ }
        }
        throw err;
    }
}

/**
 * Atomically serializes data as JSON and writes to target file.
 */
export async function writeJsonAtomic<T>(
    targetPath: string,
    data: T,
    mode: number = FS_MODES.BRAIN_FILE
): Promise<void> {
    const serialized = JSON.stringify(data, null, 2) + "\n";
    await writeAtomic(targetPath, serialized, mode);
}

/**
 * Reads and parses a JSON file safely with a file size limit check.
 */
export async function readJsonSafe<T>(
    filePath: string,
    maxSizeBytes: number = LIMITS.MAX_REPORT_SIZE_BYTES
): Promise<T> {
    const stats = await fs.promises.stat(filePath);
    if (stats.size > maxSizeBytes) {
        throw new Error(`File size ${stats.size} exceeds maximum permitted limit of ${maxSizeBytes} bytes`);
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
}

/**
 * Ensures a directory exists with private permissions (0o700).
 */
export async function ensureDirSafe(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
        await fs.promises.mkdir(dirPath, { recursive: true, mode: FS_MODES.BRAIN_DIR });
    }
}

/**
 * Creates a timestamped backup of the target file (<targetPath>.orbit.bak.<timestamp>)
 * and prunes older backups, keeping only the most recent `maxBackups` (default 3) (N-01).
 */
export async function createRollingBackup(
    targetPath: string,
    maxBackups: number = 3
): Promise<string> {
    if (!fs.existsSync(targetPath)) {
        throw new Error(`Cannot backup non-existent file: ${targetPath}`);
    }

    const timestamp = Date.now();
    const backupPath = `${targetPath}.orbit.bak.${timestamp}`;
    await fs.promises.copyFile(targetPath, backupPath);

    // Prune older backups
    try {
        const dir = path.dirname(targetPath);
        const baseName = path.basename(targetPath);
        const prefix = `${baseName}.orbit.bak.`;

        const files = await fs.promises.readdir(dir);
        const backups = files
            .filter((f) => f.startsWith(prefix))
            .map((f) => {
                const tsStr = f.slice(prefix.length);
                const ts = Number(tsStr);
                return { fileName: f, fullPath: path.join(dir, f), ts: isNaN(ts) ? 0 : ts };
            })
            .sort((a, b) => b.ts - a.ts); // Newest first

        if (backups.length > maxBackups) {
            const toDelete = backups.slice(maxBackups);
            for (const b of toDelete) {
                try {
                    await fs.promises.unlink(b.fullPath);
                } catch { /* ignore unlink error */ }
            }
        }
    } catch {
        // Ignore pruning directory read errors
    }

    return backupPath;
}
