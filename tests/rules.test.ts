import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { injectOrbitRules, removeOrbitRules, ORBIT_START_MARKER, ORBIT_END_MARKER } from "../src/core/rules.js";
import { detectHost } from "../src/core/host.js";

describe("rules and host management", () => {
    let tempDir: string;
    let geminiMdPath: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-rules-test-"));
        geminiMdPath = path.join(tempDir, "GEMINI.md");
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("injectOrbitRules creates file with markers when file does not exist", async () => {
        const injected = await injectOrbitRules(geminiMdPath, "## Orbit Rule 1\nDo things safely.");
        expect(injected).toBe(true);

        const content = fs.readFileSync(geminiMdPath, "utf-8");
        expect(content).toContain(ORBIT_START_MARKER);
        expect(content).toContain(ORBIT_END_MARKER);
        expect(content).toContain("## Orbit Rule 1");
    });

    it("injectOrbitRules preserves user rules outside markers when updating", async () => {
        const initial = `# My Custom Rules\nAlways speak nicely.\n\n${ORBIT_START_MARKER}\nOld orbit rule\n${ORBIT_END_MARKER}\n\n# Bottom Rule\nStay positive.`;
        fs.writeFileSync(geminiMdPath, initial, "utf-8");

        await injectOrbitRules(geminiMdPath, "Updated orbit rule v2");

        const updated = fs.readFileSync(geminiMdPath, "utf-8");
        expect(updated).toContain("# My Custom Rules");
        expect(updated).toContain("Always speak nicely.");
        expect(updated).toContain("# Bottom Rule");
        expect(updated).toContain("Stay positive.");
        expect(updated).toContain("Updated orbit rule v2");
        expect(updated).not.toContain("Old orbit rule");
    });

    it("removeOrbitRules removes only the marker block and preserves user content", async () => {
        const initial = `# My Custom Rules\nAlways speak nicely.\n\n${ORBIT_START_MARKER}\nOrbit rule\n${ORBIT_END_MARKER}\n\n# Bottom Rule\nStay positive.`;
        fs.writeFileSync(geminiMdPath, initial, "utf-8");

        const removed = await removeOrbitRules(geminiMdPath);
        expect(removed).toBe(true);

        const content = fs.readFileSync(geminiMdPath, "utf-8");
        expect(content).not.toContain(ORBIT_START_MARKER);
        expect(content).not.toContain(ORBIT_END_MARKER);
        expect(content).not.toContain("Orbit rule");
        expect(content).toContain("# My Custom Rules");
        expect(content).toContain("Always speak nicely.");
        expect(content).toContain("# Bottom Rule");
        expect(content).toContain("Stay positive.");
    });

    it("refuses to edit and halts if orphaned marker is detected (V-10)", async () => {
        const orphaned = `# My User Rules\n${ORBIT_START_MARKER}\nUnclosed content without end marker`;
        fs.writeFileSync(geminiMdPath, orphaned, "utf-8");

        await expect(injectOrbitRules(geminiMdPath, "new rules")).rejects.toThrow(/Orphaned Orbit start marker/i);

        // Content remains untouched
        expect(fs.readFileSync(geminiMdPath, "utf-8")).toBe(orphaned);
    });

    it("preserves Windows CRLF line endings and creates backup (V-10)", async () => {
        const crlfInitial = `# User Header\r\n\r\nSome instructions\r\n`;
        fs.writeFileSync(geminiMdPath, crlfInitial, "utf-8");

        await injectOrbitRules(geminiMdPath, "Rule line 1\r\nRule line 2");

        expect(fs.existsSync(`${geminiMdPath}.orbit.bak`)).toBe(true);
        expect(fs.readFileSync(`${geminiMdPath}.orbit.bak`, "utf-8")).toBe(crlfInitial);

        const updated = fs.readFileSync(geminiMdPath, "utf-8");
        expect(updated).toContain("\r\n");
        expect(updated.includes("\r\n")).toBe(true);
    });

    it("detectHost identifies environment correctly", () => {
        const host = detectHost("Google Antigravity IDE");
        expect(host.isAntigravity).toBe(true);
        expect(host.mcpConfigPath).toContain("mcp_config.json");
        expect(host.geminiMdPath).toContain("GEMINI.md");
    });
});
