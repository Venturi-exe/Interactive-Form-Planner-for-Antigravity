import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBrainRoot, BRAIN_DIRS } from "./constants.js";
import { normalizeProjectKey } from "./paths.js";
import { ensureDirSafe, writeAtomic, writeJsonAtomic, readJsonSafe } from "./fsx.js";

export interface MigrationJournal {
    version: number;
    startedAt: string;
    completedAt?: string;
    stage: "copying" | "migrated-archiving" | "completed" | "partial" | "failed";
    copiedFiles: Array<{ from: string; to: string }>;
    archivedFolders: string[];
    pendingFolders?: string[];
    errors: string[];
}

export interface MigrationResult {
    migrated: boolean;
    projectsMigrated: string[];
    pendingFolders?: string[];
    errors: string[];
}

interface CopiedFileMapping {
    srcPath: string;
    destPath: string;
    size: number;
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
 * Safely copies a single file, preserving content on collision without overwriting (N-10).
 */
async function copyFileSafe(
    srcPath: string,
    destPath: string,
    sourceDirName: string,
    mappings: CopiedFileMapping[],
    collisions: string[]
): Promise<void> {
    const srcStat = await fs.promises.stat(srcPath);
    let targetDest = destPath;

    if (fs.existsSync(destPath)) {
        const srcBuf = await fs.promises.readFile(srcPath);
        const destBuf = await fs.promises.readFile(destPath);

        if (srcBuf.equals(destBuf)) {
            // Identical contents, skip re-writing
            mappings.push({ srcPath, destPath, size: srcStat.size });
            return;
        }

        // N-10: On collision with different content, write <name>.<srcdir>.<ext>
        const parsed = path.parse(destPath);
        const collisionName = `${parsed.name}.${sourceDirName}${parsed.ext}`;
        targetDest = path.join(parsed.dir, collisionName);
        collisions.push(`Collision: '${srcPath}' differed from '${destPath}'. Preserved as '${collisionName}'.`);
    }

    const content = await fs.promises.readFile(srcPath);
    await writeAtomic(targetDest, content);
    mappings.push({ srcPath, destPath: targetDest, size: srcStat.size });
}

/**
 * Recursively copies files and tracks them in the per-file manifest (N-04).
 */
async function copyDirWithManifest(
    src: string,
    dest: string,
    sourceDirName: string,
    mappings: CopiedFileMapping[],
    collisions: string[]
): Promise<void> {
    await ensureDirSafe(dest);
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirWithManifest(srcPath, destPath, sourceDirName, mappings, collisions);
        } else if (entry.isFile()) {
            await copyFileSafe(srcPath, destPath, sourceDirName, mappings, collisions);
        }
    }
}

/**
 * Copies a legacy project folder to Layout v3 structure with manifest tracking (N-04, N-10, N-11):
 * - cartograph/ or reports/ -> cartograph/ (single canonical source of truth, N-11)
 * - sessions/, features/, tasks/, concepts/, facts/ -> memories/<folder>/
 * - archive/ -> archive/
 */
async function copyProjectToLayoutV3WithManifest(
    srcDir: string,
    destDir: string,
    sourceDirName: string,
    collisions: string[]
): Promise<CopiedFileMapping[]> {
    await ensureDirSafe(destDir);
    const cartographDir = path.join(destDir, "cartograph");
    const memoriesDir = path.join(destDir, "memories");
    const archiveDir = path.join(destDir, "archive");

    await ensureDirSafe(cartographDir);
    await ensureDirSafe(memoriesDir);
    await ensureDirSafe(archiveDir);

    const mappings: CopiedFileMapping[] = [];
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        if (entry.isDirectory()) {
            const lower = entry.name.toLowerCase();
            if (lower === "cartograph" || lower === "reports") {
                // N-11: Canonical single destination cartograph/
                await copyDirWithManifest(srcPath, cartographDir, sourceDirName, mappings, collisions);
            } else if (lower === "memories") {
                await copyDirWithManifest(srcPath, memoriesDir, sourceDirName, mappings, collisions);
            } else if (["sessions", "features", "tasks", "concepts", "facts"].includes(lower)) {
                const subMemories = path.join(memoriesDir, lower);
                await ensureDirSafe(subMemories);
                await copyDirWithManifest(srcPath, subMemories, sourceDirName, mappings, collisions);
            } else if (lower === "archive") {
                await copyDirWithManifest(srcPath, archiveDir, sourceDirName, mappings, collisions);
            } else {
                const customDest = path.join(destDir, entry.name);
                await copyDirWithManifest(srcPath, customDest, sourceDirName, mappings, collisions);
            }
        } else if (entry.isFile()) {
            const destPath = path.join(destDir, entry.name);
            await copyFileSafe(srcPath, destPath, sourceDirName, mappings, collisions);
        }
    }

    return mappings;
}

/**
 * Executes a verified, non-destructive migration from Layout v2 to Layout v3.
 * - Migrates ~/.orbit-brain/<proj>/ -> ~/.orbit-brain/projects/<lowercased_proj>/
 * - Normalizes project keys with sanitized paths (N-05)
 * - Preserves case collisions without overwriting (N-10)
 * - Verifies per-file manifest (path and size) before archiving originals (N-04)
 * - Writes .layout-version ONLY when all folders pass manifest verification (N-04)
 * - Saves partial pending list to migration-v3.json for retry on next start (N-04)
 * - Moves verified originals to .migrated/v2-<ts>/ to ensure they are never purged (V-01)
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
        const collisions: string[] = [];

        // Phase 1: Copy-first with per-file manifest tracking and verification (N-04)
        for (const dirName of candidateDirs) {
            try {
                const targetKey = normalizeProjectKey(dirName);
                const srcDir = path.join(brainRoot, dirName);
                const targetDir = path.join(projectsRoot, targetKey);

                const mappings = await copyProjectToLayoutV3WithManifest(srcDir, targetDir, dirName, collisions);

                // Per-file manifest verification: each copied file must exist and match expected size
                let folderVerified = true;
                for (const item of mappings) {
                    if (!fs.existsSync(item.destPath)) {
                        folderVerified = false;
                        journal.errors.push(`Manifest verification failed: missing destination file '${item.destPath}'`);
                        break;
                    }
                    const st = await fs.promises.stat(item.destPath);
                    if (st.size !== item.size) {
                        folderVerified = false;
                        journal.errors.push(`Manifest verification failed: size mismatch for '${item.destPath}' (expected ${item.size}, got ${st.size})`);
                        break;
                    }
                }

                if (folderVerified) {
                    verifiedCandidates.push(dirName);
                    projectsMigrated.push(targetKey);
                    journal.copiedFiles.push({ from: srcDir, to: targetDir });
                } else {
                    journal.errors.push(`Project '${dirName}' failed manifest verification. Original left untouched.`);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                journal.errors.push(`Failed to copy project '${dirName}': ${msg}`);
            }
        }

        if (collisions.length > 0) {
            journal.errors.push(...collisions);
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

        // N-04: Only mark complete and write .layout-version if ALL candidates passed
        const allCandidatesPassed = candidateDirs.every((d) => verifiedCandidates.includes(d));
        if (allCandidatesPassed) {
            journal.stage = "completed";
            journal.completedAt = new Date().toISOString();
            delete journal.pendingFolders;
            await writeJsonAtomic(journalPath, journal);

            // Write layout version 3
            await writeAtomic(versionFile, "3\n");

            return {
                migrated: true,
                projectsMigrated: Array.from(new Set(projectsMigrated)),
                errors: journal.errors,
            };
        } else {
            // N-04: Partial migration. Do NOT write .layout-version, record pending folders
            const pending = candidateDirs.filter((d) => !verifiedCandidates.includes(d));
            journal.stage = "partial";
            journal.pendingFolders = pending;
            await writeJsonAtomic(journalPath, journal);

            return {
                migrated: false,
                projectsMigrated: Array.from(new Set(projectsMigrated)),
                pendingFolders: pending,
                errors: journal.errors,
            };
        }
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
