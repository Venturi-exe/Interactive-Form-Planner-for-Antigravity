import * as fs from "fs";
import * as path from "path";
import { getBrainRoot, BRAIN_DIRS, LIMITS } from "./constants.js";
import { ensureDirSafe } from "./fsx.js";

export interface TrashedFileInfo {
    fileName: string;
    filePath: string;
    originalName: string;
    trashedAt: Date;
    size: number;
}

/**
 * Formats a Date object into a filesystem-safe timestamp: YYYYMMDDTHHmmssZ
 */
function formatTimestamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
}

/**
 * Moves a file safely into the brain's .trash/ directory instead of deleting it permanently.
 * Prefixes the file with a timestamp to prevent collisions.
 */
export async function moveToTrash(
    filePath: string,
    brainRoot: string = getBrainRoot()
): Promise<string> {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Cannot move non-existent file to trash: ${filePath}`);
    }

    const trashDir = path.join(brainRoot, BRAIN_DIRS.TRASH);
    await ensureDirSafe(trashDir);

    const baseName = path.basename(filePath);
    const timePrefix = formatTimestamp(new Date());
    const trashedFileName = `${timePrefix}_${baseName}`;
    const destinationPath = path.join(trashDir, trashedFileName);

    try {
        await fs.promises.rename(filePath, destinationPath);
    } catch {
        // Fallback for cross-device or permission boundary: copy and unlink
        await fs.promises.copyFile(filePath, destinationPath);
        await fs.promises.unlink(filePath);
    }

    return destinationPath;
}

/**
 * Restores a file from the trash directory to a destination path.
 */
export async function restoreFromTrash(
    trashedFileName: string,
    destinationPath: string,
    brainRoot: string = getBrainRoot()
): Promise<void> {
    const trashDir = path.join(brainRoot, BRAIN_DIRS.TRASH);
    const sourcePath = path.join(trashDir, trashedFileName);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`File not found in trash: ${trashedFileName}`);
    }

    const destDir = path.dirname(destinationPath);
    await ensureDirSafe(destDir);

    try {
        await fs.promises.rename(sourcePath, destinationPath);
    } catch {
        await fs.promises.copyFile(sourcePath, destinationPath);
        await fs.promises.unlink(sourcePath);
    }
}

/**
 * Lists all files currently stored in the .trash directory.
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
            if (stats.isFile()) {
                const parts = entry.split("_");
                const originalName = parts.length > 1 ? parts.slice(1).join("_") : entry;
                results.push({
                    fileName: entry,
                    filePath: fullPath,
                    originalName,
                    trashedAt: stats.mtime,
                    size: stats.size,
                });
            }
        } catch { /* ignore vanished files */ }
    }

    return results;
}

/**
 * Purges files from the trash that have exceeded the TTL (default 14 days).
 * Returns the count of purged files.
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
            const ageMs = now - stats.mtimeMs;
            if (ageMs > ttlMs) {
                await fs.promises.unlink(fullPath);
                purgedCount++;
            }
        } catch { /* ignore */ }
    }

    return purgedCount;
}
