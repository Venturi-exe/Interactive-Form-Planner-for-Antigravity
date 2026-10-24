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

    it("migrateToLayoutV3 migrates v2 projects to projects/<lowercased>/, maps layout v3 folders, and archives to .migrated/ (V-01, V-14)", async () => {
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

        // V-14: Verify target layout v3 directories (mapped to reports and memories/sessions)
        const migratedAppReport = path.join(mockBrainRoot, "projects", "my-project", "reports", "report_01.json");
        expect(fs.existsSync(migratedAppReport)).toBe(true);

        const migratedOrbitSession = path.join(mockBrainRoot, "projects", "orbit", "memories", "sessions", "session_01.md");
        expect(fs.existsSync(migratedOrbitSession)).toBe(true);

        const migratedDefaultReport = path.join(mockBrainRoot, "projects", "_default", "reports", "report_def.json");
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

    it("isolates errors per folder and normalizes spaces/special chars so bad names do not abort migration (V-06)", async () => {
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
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "my_cool_app_2026", "reports", "report.json"))).toBe(true);
        expect(fs.existsSync(path.join(mockBrainRoot, "projects", "goodproject", "memories", "INDEX.md"))).toBe(true);

        // Layout version must be written
        const version = fs.readFileSync(path.join(mockBrainRoot, ".layout-version"), "utf-8").trim();
        expect(version).toBe("3");
    });
});
