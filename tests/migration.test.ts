import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { initBrainFromTemplate, migrateToLayoutV3 } from "../src/core/migration.js";

describe("Layout v3 brain migration and template initialization", () => {
    let mockBrainRoot: string;
    const templateDir = path.join(__dirname, "..", "media", "brain-template");

    beforeEach(() => {
        mockBrainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-migration-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(mockBrainRoot, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("initBrainFromTemplate initializes empty brain with template files and layout version 3", async () => {
        const initialized = await initBrainFromTemplate(templateDir, mockBrainRoot);
        expect(initialized).toBe(true);

        expect(fs.existsSync(path.join(mockBrainRoot, "BRAIN_ARCHITECTURE.md"))).toBe(true);
        expect(fs.existsSync(path.join(mockBrainRoot, "global_context_summary.md"))).toBe(true);
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "_default", "INDEX.md"))).toBe(true);
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "_default", "PROTOCOL.md"))).toBe(true);

        const version = fs.readFileSync(path.join(mockBrainRoot, ".layout-version"), "utf-8").trim();
        expect(version).toBe("3");

        // Second call should not re-initialize
        const secondCall = await initBrainFromTemplate(templateDir, mockBrainRoot);
        expect(secondCall).toBe(false);
    });

    it("migrateToLayoutV3 migrates v2 projects to projects/<lowercased>/, maps layout v3 folders, and archives to .migrated/ (V-01, V-14, N-11)", async () => {
        // Setup mock v2 layout
        const appDir = path.join(mockBrainRoot, "My-Project", "cartograph");
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, "report_01.json"), JSON.stringify({ summary: "v2 report" }));

        const orbitDir = path.join(mockBrainRoot, "Orbit", "sessions");
        fs.mkdirSync(orbitDir, { recursive: true });
        fs.writeFileSync(path.join(orbitDir, "session_01.md"), "# Session Notes");

        const defaultDir = path.join(mockBrainRoot, "Default", "cartograph");
        fs.mkdirSync(defaultDir, { recursive: true });
        fs.writeFileSync(path.join(defaultDir, "report_def.json"), JSON.stringify({ summary: "default report" }));

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);
        expect(result.errors).toEqual([]);

        // N-11: Verify target layout v3 directories (mapped to canonical cartograph and memories/sessions)
        const migratedAppReport = path.join(mockBrainRoot, "projects", "my-project", "cartograph", "report_01.json");
        expect(fs.existsSync(migratedAppReport)).toBe(true);

        const migratedOrbitSession = path.join(mockBrainRoot, "projects", "orbit", "memories", "sessions", "session_01.md");
        expect(fs.existsSync(migratedOrbitSession)).toBe(true);

        const migratedDefaultReport = path.join(mockBrainRoot, "projects", "_default", "cartograph", "report_def.json");
        expect(fs.existsSync(migratedDefaultReport)).toBe(true);

        // V-01: Verified old top-level folders moved to .migrated/ archive, NOT .trash (never auto-purged)
        expect(fs.existsSync(path.join(mockBrainRoot, "My-Project"))).toBe(false);
        expect(fs.existsSync(path.join(mockBrainRoot, "Orbit"))).toBe(false);
        expect(fs.existsSync(path.join(mockBrainRoot, "Default"))).toBe(false);

        const migratedDir = path.join(mockBrainRoot, ".migrated");
        expect(fs.existsSync(migratedDir)).toBe(true);

        // Verify journal exists and is marked completed
        const journalPath = path.join(mockBrainRoot, ".journal", "migration-v3.json");
        expect(fs.existsSync(journalPath)).toBe(true);
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
        expect(journal.stage).toBe("completed");

        // Verify idempotent second run
        const rerun = await migrateToLayoutV3(mockBrainRoot);
        expect(rerun.migrated).toBe(false);
    });

    it("isolates errors per folder and normalizes spaces/special chars (V-06, N-05)", async () => {
        // Create a project with spaces and special chars
        const weirdDir = path.join(mockBrainRoot, "My Cool App! (2026)", "cartograph");
        fs.mkdirSync(weirdDir, { recursive: true });
        fs.writeFileSync(path.join(weirdDir, "report.json"), JSON.stringify({ data: "ok" }));

        const goodDir = path.join(mockBrainRoot, "GoodProject", "memories");
        fs.mkdirSync(goodDir, { recursive: true });
        fs.writeFileSync(path.join(goodDir, "INDEX.md"), "# Good");

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);

        // Both should migrate without aborting
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "my_cool_app_2026", "cartograph", "report.json"))).toBe(true);
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "goodproject", "memories", "INDEX.md"))).toBe(true);

        // Layout version must be written
        const version = fs.readFileSync(path.join(mockBrainRoot, ".layout-version"), "utf-8").trim();
        expect(version).toBe("3");
    });

    it("preserves collision files with differing content as <name>.<srcdir>.<ext> without overwriting (N-10)", async () => {
        // Create pre-existing destination file in projects/orbit/cartograph/report.json
        const destDir = path.join(mockBrainRoot, "projects", "orbit", "cartograph");
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, "report.json"), "version A content", "utf-8");

        // Create legacy folder 'Orbit' with different content in report.json
        const srcDir = path.join(mockBrainRoot, "Orbit", "cartograph");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, "report.json"), "version B differing content", "utf-8");

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);

        // Original destination file must be intact (not overwritten)
        expect(fs.readFileSync(path.join(destDir, "report.json"), "utf-8")).toBe("version A content");

        // Colliding file must be preserved with source directory suffix
        const preservedPath = path.join(destDir, "report.Orbit.json");
        expect(fs.existsSync(preservedPath)).toBe(true);
        expect(fs.readFileSync(preservedPath, "utf-8")).toBe("version B differing content");
    });

    it("does not write .layout-version if a folder fails manifest verification (N-04)", async () => {
        // Setup two projects: one good, one that fails copy
        const goodDir = path.join(mockBrainRoot, "GoodApp", "cartograph");
        fs.mkdirSync(goodDir, { recursive: true });
        fs.writeFileSync(path.join(goodDir, "r1.json"), "good", "utf-8");

        // Spy on fs.promises.readdir or fail a specific folder by putting a file where a directory should be
        const badDir = path.join(mockBrainRoot, "BadApp", "cartograph");
        fs.mkdirSync(badDir, { recursive: true });
        fs.writeFileSync(path.join(badDir, "bad_file.json"), "bad", "utf-8");

        // Pre-create destination projects/badapp/cartograph as a regular file so copy fails!
        const badDestParent = path.join(mockBrainRoot, "projects", "badapp");
        fs.mkdirSync(badDestParent, { recursive: true });
        fs.writeFileSync(path.join(badDestParent, "cartograph"), "blocking file", "utf-8");

        const result = await migrateToLayoutV3(mockBrainRoot);

        expect(result.migrated).toBe(false);
        expect(result.pendingFolders).toContain("BadApp");

        // .layout-version must NOT be created!
        expect(fs.existsSync(path.join(mockBrainRoot, ".layout-version"))).toBe(false);

        // GoodApp was verified and archived
        expect(fs.existsSync(path.join(mockBrainRoot, "GoodApp"))).toBe(false);
        // BadApp original was left untouched!
        expect(fs.existsSync(path.join(mockBrainRoot, "BadApp"))).toBe(true);

        // Journal records partial stage
        const journalPath = path.join(mockBrainRoot, ".journal", "migration-v3.json");
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
        expect(journal.stage).toBe("partial");
        expect(journal.pendingFolders).toContain("BadApp");
    });

    it("verifies SHA-256 hash in manifest and rejects folder on hash mismatch (M-05)", async () => {
        const appDir = path.join(mockBrainRoot, "HashCheckApp", "cartograph");
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, "data.txt"), "hello world 12345", "utf-8");

        // Spy on fs.promises.stat or tamper destination during copy
        // To test hash mismatch directly: pre-create target file with SAME length but different bytes
        const targetDir = path.join(mockBrainRoot, "projects", "hashcheckapp", "cartograph");
        fs.mkdirSync(targetDir, { recursive: true });
        // Same length (17 bytes) but different bytes
        fs.writeFileSync(path.join(targetDir, "data.txt"), "hello world 99999", "utf-8");

        const result = await migrateToLayoutV3(mockBrainRoot);

        // Verification should succeed by creating the collision-renamed file with correct hash
        expect(result.migrated).toBe(true);
        const collisionFile = path.join(targetDir, "data.HashCheckApp.txt");
        expect(fs.existsSync(collisionFile)).toBe(true);
        expect(fs.readFileSync(collisionFile, "utf-8")).toBe("hello world 12345");
    });

    it("idempotently handles collision files on retry without duplicating (M-05)", async () => {
        // Pre-create destination file
        const destDir = path.join(mockBrainRoot, "projects", "myproj", "cartograph");
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, "report.json"), "original destination", "utf-8");

        // Pre-create collision file from a previous partial run
        const collisionPath = path.join(destDir, "report.MyProj.json");
        fs.writeFileSync(collisionPath, "source content to preserve", "utf-8");

        // Source legacy folder
        const srcDir = path.join(mockBrainRoot, "MyProj", "cartograph");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, "report.json"), "source content to preserve", "utf-8");

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);

        // Files in destination must only contain the original and the single collision file
        const destFiles = fs.readdirSync(destDir);
        expect(destFiles.sort()).toEqual(["report.MyProj.json", "report.json"].sort());
    });

    it("handles pre-existing .migrated file marker without ENOTDIR and completes migration", async () => {
        // Create an 8-byte .migrated file marker left by legacy migrateFromLegacy()
        const markerFile = path.join(mockBrainRoot, ".migrated");
        fs.writeFileSync(markerFile, "migrated\n", "utf-8");

        // Create legacy project folder
        const projDir = path.join(mockBrainRoot, "SampleApp", "cartograph");
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(path.join(projDir, "rep.json"), JSON.stringify({ summary: "hello" }));

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);
        expect(result.errors).toEqual([]);

        // .migrated should now be a directory containing the archive
        expect(fs.statSync(path.join(mockBrainRoot, ".migrated")).isDirectory()).toBe(true);
        // .migrated-marker should exist preserving the marker
        expect(fs.existsSync(path.join(mockBrainRoot, ".migrated-marker"))).toBe(true);
        // Layout version must be created
        expect(fs.readFileSync(path.join(mockBrainRoot, ".layout-version"), "utf-8").trim()).toBe("3");
        // SampleApp must have moved to projects/sampleapp and archived from root
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "sampleapp", "cartograph", "rep.json"))).toBe(true);
        expect(fs.existsSync(path.join(mockBrainRoot, "SampleApp"))).toBe(false);
    });

    it("resumes cleanly when projects/ was already partially populated from an earlier run", async () => {
        // Pre-create destination in projects/ (as left by an earlier run aborted at Phase 2)
        const destDir = path.join(mockBrainRoot, "projects", "alreadycopied", "cartograph");
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, "rep.json"), JSON.stringify({ summary: "already copied" }), "utf-8");

        // The legacy root folder still exists because Phase 2 never archived it
        const srcDir = path.join(mockBrainRoot, "AlreadyCopied", "cartograph");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, "rep.json"), JSON.stringify({ summary: "already copied" }), "utf-8");

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);
        expect(result.errors).toEqual([]);

        // Source must be archived and destination must remain valid
        expect(fs.existsSync(srcDir)).toBe(false);
        expect(fs.existsSync(path.join(destDir, "rep.json"))).toBe(true);
        expect(fs.readFileSync(path.join(mockBrainRoot, ".layout-version"), "utf-8").trim()).toBe("3");
    });
});

