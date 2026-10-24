import * as fs from "fs";
import * as path from "path";
import { getBrainRoot, BRAIN_DIRS, DEFAULT_PROJECT_KEY } from "./constants.js";
import { assertProjectKey } from "./paths.js";
import { ensureDirSafe, writeAtomic, writeJsonAtomic, readJsonSafe } from "./fsx.js";
import { moveToTrash } from "./trash.js";

export interface MigrationJournal {
    version: number;
    startedAt: string;
    completedAt?: string;
    stage: "copying" | "trashing" | "completed" | "failed";
    copiedFiles: Array<{ from: string; to: string }>;
    trashedFolders: string[];
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
 * Recursively copies all files and directories from src to dest.
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
 * Executes a non-destructive migration from Layout v2 to Layout v3.
 * - Migrates ~/.orbit-brain/<proj>/ -> ~/.orbit-brain/projects/<lowercased_proj>/
 * - Normalizes 'Orbit' and 'orbit' into single lowercased 'orbit' folder
 * - Normalizes 'Default' into '_default'
 * - Uses a resumable journal in .journal/migration-v3.json
 * - Moves old top-level folders to .trash/ rather than deleting them
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
        trashedFolders: [],
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

        // Phase 1: Copy-first
        for (const dirName of candidateDirs) {
            let targetKey: string;
            if (dirName.toLowerCase() === "default") {
                targetKey = DEFAULT_PROJECT_KEY;
            } else {
                targetKey = assertProjectKey(dirName.toLowerCase());
            }

            const srcDir = path.join(brainRoot, dirName);
            const targetDir = path.join(projectsRoot, targetKey);
            await ensureDirSafe(targetDir);

            try {
                await copyDirectoryRecursive(srcDir, targetDir);
                projectsMigrated.push(targetKey);
                journal.copiedFiles.push({ from: srcDir, to: targetDir });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                journal.errors.push(`Failed to copy ${dirName}: ${msg}`);
            }
        }

        journal.stage = "trashing";
        await writeJsonAtomic(journalPath, journal);

        // Phase 2: Move old top-level candidate directories to .trash/
        for (const dirName of candidateDirs) {
            const srcDir = path.join(brainRoot, dirName);
            try {
                if (fs.existsSync(srcDir)) {
                    await moveToTrash(srcDir, brainRoot);
                    journal.trashedFolders.push(dirName);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                journal.errors.push(`Failed to trash old folder ${dirName}: ${msg}`);
            }
        }

        journal.stage = "completed";
        journal.completedAt = new Date().toISOString();
        await writeJsonAtomic(journalPath, journal);

        // Mark layout version 3
        await writeAtomic(versionFile, "3\n");

        return {
            migrated: true,
            projectsMigrated,
            errors: journal.errors,
        };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        journal.stage = "failed";
        journal.errors.push(`Migration fatal error: ${msg}`);
        await writeJsonAtomic(journalPath, journal);
        return {
            migrated: false,
            projectsMigrated,
            errors: journal.errors,
        };
    }
}
