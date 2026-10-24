import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBrainRoot, BRAIN_DIRS, DEFAULT_PROJECT_KEY } from "./constants.js";
import { normalizeProjectKey } from "./paths.js";
import { ensureDirSafe, writeAtomic, writeJsonAtomic, readJsonSafe } from "./fsx.js";

export interface MigrationJournal {
    version: number;
    startedAt: string;
    completedAt?: string;
    stage: "copying" | "migrated-archiving" | "completed" | "failed";
    copiedFiles: Array<{ from: string; to: string }>;
    archivedFolders: string[];
    errors: string[];
}

export interface MigrationResult {
    migrated: boolean;
    projectsMigrated: string[];
    errors: string[];
}

const EXCLUDED_DIRS = new Set([
    BRAIN_DIRS.PROJECTS,
    BRAIN_DIRS.TRASH,
    BRAIN_DIRS.LOCKS,
    BRAIN_DIRS.JOURNAL,
    ".migrated",
    "optic",
    "_trash",
    "_quarantine",
    "_failed",
    "node_modules",
]);

/**
 * Initializes a new brain from bundled template files if empty.
 */
export async function initBrainFromTemplate(
    templateDir: string,
    brainRoot: string = getBrainRoot()
): Promise<boolean> {
    await ensureDirSafe(brainRoot);

    const versionFile = path.join(brainRoot, ".layout-version");
    if (fs.existsSync(versionFile)) {
        return false;
    }

    const entries = await fs.promises.readdir(brainRoot);
    const nonHidden = entries.filter((e) => !e.startsWith("."));
    if (nonHidden.length > 0) {
        // Directory is not empty, do not overwrite
        return false;
    }

    if (fs.existsSync(templateDir)) {
        await copyDirectoryRecursive(templateDir, brainRoot);
    }

    await writeAtomic(versionFile, "3\n");
    return true;
}

/**
 * Recursively copies all files and directories from src to dest using atomic writes.
 */
async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
    await ensureDirSafe(dest);
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectoryRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            const content = await fs.promises.readFile(srcPath);
            await writeAtomic(destPath, content);
        }
    }
}

/**
 * Copies a legacy project folder to Layout v3 structure:
 * - cartograph/ -> reports/ (and cartograph/ for backward compat)
 * - sessions/, features/, tasks/, concepts/, facts/ -> memories/<folder>/
 * - archive/ -> archive/
 */
async function copyProjectToLayoutV3(srcDir: string, destDir: string): Promise<void> {
    await ensureDirSafe(destDir);
    const reportsDir = path.join(destDir, "reports");
    const legacyCartographDir = path.join(destDir, "cartograph");
    const memoriesDir = path.join(destDir, "memories");
    const archiveDir = path.join(destDir, "archive");

    await ensureDirSafe(reportsDir);
    await ensureDirSafe(legacyCartographDir);
    await ensureDirSafe(memoriesDir);
    await ensureDirSafe(archiveDir);

    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        if (entry.isDirectory()) {
            const lower = entry.name.toLowerCase();
            if (lower === "cartograph" || lower === "reports") {
                await copyDirectoryRecursive(srcPath, reportsDir);
                await copyDirectoryRecursive(srcPath, legacyCartographDir);
            } else if (lower === "memories") {
                await copyDirectoryRecursive(srcPath, memoriesDir);
            } else if (["sessions", "features", "tasks", "concepts", "facts"].includes(lower)) {
                const subMemories = path.join(memoriesDir, lower);
                await ensureDirSafe(subMemories);
                await copyDirectoryRecursive(srcPath, subMemories);
            } else if (lower === "archive") {
                await copyDirectoryRecursive(srcPath, archiveDir);
            } else {
                const customDest = path.join(destDir, entry.name);
                await copyDirectoryRecursive(srcPath, customDest);
            }
        } else if (entry.isFile()) {
            const destPath = path.join(destDir, entry.name);
            const content = await fs.promises.readFile(srcPath);
            await writeAtomic(destPath, content);
        }
    }
}

/**
 * Calculates total file count and byte size of a directory for migration verification.
 */
async function getDirectoryMetrics(dirPath: string): Promise<{ fileCount: number; byteSize: number }> {
    let fileCount = 0;
    let byteSize = 0;
    if (!fs.existsSync(dirPath)) return { fileCount: 0, byteSize: 0 };

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const sub = await getDirectoryMetrics(full);
            fileCount += sub.fileCount;
            byteSize += sub.byteSize;
        } else if (entry.isFile()) {
            fileCount++;
            try {
                const st = await fs.promises.stat(full);
                byteSize += st.size;
            } catch { /* skip */ }
        }
    }
    return { fileCount, byteSize };
}

/**
 * Executes a verified, non-destructive migration from Layout v2 to Layout v3.
 * - Migrates ~/.orbit-brain/<proj>/ -> ~/.orbit-brain/projects/<lowercased_proj>/
 * - Normalizes 'Default' into '_default'
 * - Merges case collisions (e.g. 'Orbit' and 'orbit') into single lowercased folder
 * - Verifies file counts and byte sizes before archiving originals (V-01)
 * - Moves verified originals to .migrated/v2-<ts>/ to ensure they are never purged (V-01)
 * - Isolates errors per folder so bad names never halt migration (V-06)
 */
export async function migrateToLayoutV3(
    brainRoot: string = getBrainRoot()
): Promise<MigrationResult> {
    const versionFile = path.join(brainRoot, ".layout-version");
    if (fs.existsSync(versionFile)) {
        try {
            const ver = (await fs.promises.readFile(versionFile, "utf-8")).trim();
            if (ver === "3") {
                return { migrated: false, projectsMigrated: [], errors: [] };
            }
        } catch { /* proceed with migration */ }
    }

    const journalDir = path.join(brainRoot, BRAIN_DIRS.JOURNAL);
    await ensureDirSafe(journalDir);
    const journalPath = path.join(journalDir, "migration-v3.json");

    let journal: MigrationJournal = {
        version: 3,
        startedAt: new Date().toISOString(),
        stage: "copying",
        copiedFiles: [],
        archivedFolders: [],
        errors: [],
    };

    if (fs.existsSync(journalPath)) {
        try {
            journal = await readJsonSafe<MigrationJournal>(journalPath);
        } catch { /* start fresh */ }
    }

    const projectsMigrated: string[] = [];
    const projectsRoot = path.join(brainRoot, BRAIN_DIRS.PROJECTS);
    await ensureDirSafe(projectsRoot);

    try {
        const entries = await fs.promises.readdir(brainRoot);
        const candidateDirs: string[] = [];

        for (const entry of entries) {
            if (entry.startsWith(".") || EXCLUDED_DIRS.has(entry)) {
                continue;
            }
            const fullPath = path.join(brainRoot, entry);
            try {
                const stats = await fs.promises.stat(fullPath);
                if (stats.isDirectory()) {
                    candidateDirs.push(entry);
                }
            } catch { /* skip */ }
        }

        const verifiedCandidates: string[] = [];

        // Phase 1: Copy-first with layout v3 structure mapping and error isolation
        for (const dirName of candidateDirs) {
            try {
                const targetKey = normalizeProjectKey(dirName);
                const srcDir = path.join(brainRoot, dirName);
                const targetDir = path.join(projectsRoot, targetKey);

                await copyProjectToLayoutV3(srcDir, targetDir);

                // V-01: Verify copy metrics before marking folder for archive
                const srcMetrics = await getDirectoryMetrics(srcDir);
                const destMetrics = await getDirectoryMetrics(targetDir);

                if (destMetrics.fileCount >= srcMetrics.fileCount && destMetrics.byteSize >= srcMetrics.byteSize) {
                    verifiedCandidates.push(dirName);
                    projectsMigrated.push(targetKey);
                    journal.copiedFiles.push({ from: srcDir, to: targetDir });
                } else {
                    journal.errors.push(
                        `Copy verification failed for '${dirName}' (expected ${srcMetrics.fileCount} files/${srcMetrics.byteSize} bytes, got ${destMetrics.fileCount}/${destMetrics.byteSize}). Original left untouched.`
                    );
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                journal.errors.push(`Failed to copy project '${dirName}': ${msg}`);
            }
        }

        journal.stage = "migrated-archiving";
        await writeJsonAtomic(journalPath, journal);

        // Phase 2: Move ONLY verified folders to permanent .migrated/v2-<ts>/ archive (never purged)
        const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
        const migratedRoot = path.join(brainRoot, ".migrated", `v2-${ts}`);
        if (verifiedCandidates.length > 0) {
            await ensureDirSafe(migratedRoot);
        }

        for (const dirName of verifiedCandidates) {
            const srcDir = path.join(brainRoot, dirName);
            // Append random suffix to destination name to prevent collisions on case-insensitive filesystems (V-16)
            const archiveName = `${dirName}_${crypto.randomUUID().slice(0, 6)}`;
            const destArchiveDir = path.join(migratedRoot, archiveName);

            try {
                if (fs.existsSync(srcDir)) {
                    try {
                        await fs.promises.rename(srcDir, destArchiveDir);
                    } catch {
                        await copyDirectoryRecursive(srcDir, destArchiveDir);
                        await fs.promises.rm(srcDir, { recursive: true, force: true });
                    }
                    journal.archivedFolders.push(dirName);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                journal.errors.push(`Failed to archive verified folder '${dirName}' to .migrated: ${msg}`);
            }
        }

        journal.stage = "completed";
        journal.completedAt = new Date().toISOString();
        await writeJsonAtomic(journalPath, journal);

        // Write layout version 3
        await writeAtomic(versionFile, "3\n");

        return {
            migrated: true,
            projectsMigrated: Array.from(new Set(projectsMigrated)),
            errors: journal.errors,
        };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        journal.stage = "failed";
        journal.errors.push(`Migration fatal error: ${msg}`);
        await writeJsonAtomic(journalPath, journal);
        return {
            migrated: false,
            projectsMigrated: Array.from(new Set(projectsMigrated)),
            errors: journal.errors,
        };
    }
}
