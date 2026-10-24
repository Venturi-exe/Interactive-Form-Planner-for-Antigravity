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

    it("migrateToLayoutV3 migrates v2 projects to projects/<lowercased>/ and moves old folders to trash", async () => {
        // Setup mock v2 layout
        const appDir = path.join(mockBrainRoot, "My-Project", "cartograph");
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, "report_01.json"), JSON.stringify({ summary: "v2 report" }));

        const orbitDir = path.join(mockBrainRoot, "Orbit", "memories");
        fs.mkdirSync(orbitDir, { recursive: true });
        fs.writeFileSync(path.join(orbitDir, "INDEX.md"), "# Orbit Memory");

        const defaultDir = path.join(mockBrainRoot, "Default", "cartograph");
        fs.mkdirSync(defaultDir, { recursive: true });
        fs.writeFileSync(path.join(defaultDir, "report_def.json"), JSON.stringify({ summary: "default report" }));

        const result = await migrateToLayoutV3(mockBrainRoot);
        expect(result.migrated).toBe(true);
        expect(result.errors).toEqual([]);

        // Verify target layout v3 directories
        const migratedAppReport = path.join(mockBrainRoot, "projects", "my-project", "cartograph", "report_01.json");
        expect(fs.existsSync(migratedAppReport)).toBe(true);

        const migratedOrbitIndex = path.join(mockBrainRoot, "projects", "orbit", "memories", "INDEX.md");
        expect(fs.existsSync(migratedOrbitIndex)).toBe(true);

        const migratedDefaultReport = path.join(mockBrainRoot, "projects", "_default", "cartograph", "report_def.json");
        expect(fs.existsSync(migratedDefaultReport)).toBe(true);

        // Verify old top-level folders moved to trash
        expect(fs.existsSync(path.join(mockBrainRoot, "My-Project"))).toBe(false);
        expect(fs.existsSync(path.join(mockBrainRoot, "Orbit"))).toBe(false);
        expect(fs.existsSync(path.join(mockBrainRoot, "Default"))).toBe(false);

        const trashDir = path.join(mockBrainRoot, ".trash");
        expect(fs.existsSync(trashDir)).toBe(true);
        const trashed = fs.readdirSync(trashDir);
        expect(trashed.some((f) => f.includes("My-Project"))).toBe(true);
        expect(trashed.some((f) => f.includes("Orbit"))).toBe(true);
        expect(trashed.some((f) => f.includes("Default"))).toBe(true);

        // Verify journal exists and is marked completed
        const journalPath = path.join(mockBrainRoot, ".journal", "migration-v3.json");
        expect(fs.existsSync(journalPath)).toBe(true);
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
        expect(journal.stage).toBe("completed");

        // Verify idempotent second run
        const rerun = await migrateToLayoutV3(mockBrainRoot);
        expect(rerun.migrated).toBe(false);
    });
});
