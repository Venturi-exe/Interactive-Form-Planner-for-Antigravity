import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBrainRoot, BRAIN_DIRS, LIMITS } from "./constants.js";
import { ensureDirSafe } from "./fsx.js";

export interface TrashedFileInfo {
    fileName: string;
    filePath: string;
    originalName: string;
    trashedAt: Date;
    size: number;
    isDirectory?: boolean;
}

/**
 * Formats a Date object into a filesystem-safe timestamp: YYYYMMDDTHHmmssZ
 */
function formatTimestamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
}

/**
 * Extracts and parses the ISO timestamp prefix from a trashed filename.
 * Supports both full ISO YYYYMMDDTHHmmssZ and legacy date-only YYYYMMDD prefixes.
 */
export function parseTimestampPrefix(name: string): Date | null {
    const matchFull = name.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
    if (matchFull) {
        const [, y, m, d, h, min, s] = matchFull;
        return new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s));
    }
    const matchDateOnly = name.match(/^(\d{4})(\d{2})(\d{2})/);
    if (matchDateOnly) {
        const [, y, m, d] = matchDateOnly;
        return new Date(Date.UTC(+y, +m - 1, +d));
    }
    return null;
}

/**
 * Moves a file or directory safely into the brain's .trash/ directory instead of deleting it permanently.
 * Prefixes the file with a timestamp and unique collision suffix to prevent collisions (V-05).
 */
export async function moveToTrash(
    filePath: string,
    brainRoot: string = getBrainRoot()
): Promise<string> {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Cannot move non-existent path to trash: ${filePath}`);
    }

    const trashDir = path.join(brainRoot, BRAIN_DIRS.TRASH);
    await ensureDirSafe(trashDir);

    const baseName = path.basename(filePath);
    const timePrefix = formatTimestamp(new Date());
    const collisionSuffix = crypto.randomUUID().slice(0, 8);
    const trashedFileName = `${timePrefix}_${collisionSuffix}_${baseName}`;
    const destinationPath = path.join(trashDir, trashedFileName);

    let stat: fs.Stats | undefined;
    try {
        stat = await fs.promises.stat(filePath);
    } catch { /* proceed */ }

    try {
        await fs.promises.rename(filePath, destinationPath);
    } catch {
        // Fallback for cross-device or permission boundary
        if (stat?.isDirectory()) {
            await fs.promises.cp(filePath, destinationPath, { recursive: true });
            await fs.promises.rm(filePath, { recursive: true, force: true });
        } else {
            await fs.promises.copyFile(filePath, destinationPath);
            await fs.promises.unlink(filePath);
        }
    }

    return destinationPath;
}

/**
 * Restores a file or directory from the trash directory to a destination path.
 * N-07: Validates that trashedFileName is a plain basename inside the trash directory
 * and refuses to overwrite an existing destination path.
 */
export async function restoreFromTrash(
    trashedFileName: string,
    destinationPath: string,
    brainRoot: string = getBrainRoot()
): Promise<void> {
    if (typeof trashedFileName !== "string" || !trashedFileName.trim()) {
        throw new Error("trashedFileName must be a non-empty string");
    }

    const cleanBase = path.basename(trashedFileName);
    if (cleanBase !== trashedFileName || trashedFileName.includes("..") || trashedFileName.includes("/") || trashedFileName.includes("\\")) {
        throw new Error(`Invalid trashed file name: ${trashedFileName}`);
    }

    const trashDir = path.join(brainRoot, BRAIN_DIRS.TRASH);
    const sourcePath = path.join(trashDir, cleanBase);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Item not found in trash: ${trashedFileName}`);
    }

    if (fs.existsSync(destinationPath)) {
        throw new Error(`Restore failed: destination path already exists: ${destinationPath}`);
    }

    const destDir = path.dirname(destinationPath);
    await ensureDirSafe(destDir);

    let stat: fs.Stats | undefined;
    try {
        stat = await fs.promises.stat(sourcePath);
    } catch { /* proceed */ }

    try {
        await fs.promises.rename(sourcePath, destinationPath);
    } catch {
        if (stat?.isDirectory()) {
            await fs.promises.cp(sourcePath, destinationPath, { recursive: true });
            await fs.promises.rm(sourcePath, { recursive: true, force: true });
        } else {
            await fs.promises.copyFile(sourcePath, destinationPath);
            await fs.promises.unlink(sourcePath);
        }
    }
}

/**
 * Lists all files and directories currently stored in the .trash directory.
 * Trashed timestamp is parsed directly from filename prefix (V-05).
 */
export async function listTrash(
    brainRoot: string = getBrainRoot()
): Promise<TrashedFileInfo[]> {
    const trashDir = path.join(brainRoot, BRAIN_DIRS.TRASH);
    if (!fs.existsSync(trashDir)) {
        return [];
    }

    const entries = await fs.promises.readdir(trashDir);
    const results: TrashedFileInfo[] = [];

    for (const entry of entries) {
        const fullPath = path.join(trashDir, entry);
        try {
            const stats = await fs.promises.stat(fullPath);
            const trashedAt = parseTimestampPrefix(entry) || stats.mtime;

            // N-13: Accurately parse original name from <ts>_<uuid8>_<name> or legacy <ts>_<name>
            let originalName = entry;
            const uuidMatch = entry.match(/^\d{8}(?:T\d{6}Z?)?_[a-f0-9]{8}_(.+)$/i);
            if (uuidMatch) {
                originalName = uuidMatch[1];
            } else {
                const legacyMatch = entry.match(/^\d{8}(?:T\d{6}Z?)?_(.+)$/i);
                if (legacyMatch) {
                    originalName = legacyMatch[1];
                }
            }

            results.push({
                fileName: entry,
                filePath: fullPath,
                originalName,
                trashedAt,
                size: stats.size,
                isDirectory: stats.isDirectory(),
            });
        } catch { /* ignore vanished files */ }
    }

    return results;
}

/**
 * Purges files and directories from the trash that have exceeded the TTL (default 14 days).
 * Derives age from filename timestamp rather than mtime to avoid premature deletion of renamed files (V-05).
 * Returns the count of purged items.
 */
export async function purgeExpiredTrash(
    ttlMs: number = LIMITS.TRASH_TTL_MS,
    brainRoot: string = getBrainRoot()
): Promise<number> {
    const trashDir = path.join(brainRoot, BRAIN_DIRS.TRASH);
    if (!fs.existsSync(trashDir)) {
        return 0;
    }

    const now = Date.now();
    const entries = await fs.promises.readdir(trashDir);
    let purgedCount = 0;

    for (const entry of entries) {
        const fullPath = path.join(trashDir, entry);
        try {
            const stats = await fs.promises.stat(fullPath);
            // V-05 / N-13: Age derived from prefix timestamp; fallback to mtime
            const trashedAt = parseTimestampPrefix(entry) || stats.mtime;
            const ageMs = now - trashedAt.getTime();
            if (ageMs > ttlMs) {
                if (stats.isDirectory()) {
                    await fs.promises.rm(fullPath, { recursive: true, force: true });
                } else {
                    await fs.promises.unlink(fullPath);
                }
                purgedCount++;
            }
        } catch { /* ignore */ }
    }

    return purgedCount;
}
