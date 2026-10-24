import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getOrbitRulesTemplate } from "../src/core/rules";
import { OrbitBrain } from "../src/OrbitBrain";

describe("Stage 3 Safety & Hardening (V-02, V-04, V-10, V-12, V-13, V-15, V-17)", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-stage3-test-"));
        process.env.ORBIT_BRAIN_DIR = tempDir;
    });

    afterEach(() => {
        delete process.env.ORBIT_BRAIN_DIR;
        delete process.env.ORBIT_RECORD_ENVIRONMENT;
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("V-12: getOrbitRulesTemplate generates clean markdown with no literal escaped backticks and no U+2014", () => {
        const rules = getOrbitRulesTemplate();

        // Must not contain escaped literal backslashes before backticks
        expect(rules).not.toContain("\\`");
        // Must not contain Unicode em-dash U+2014
        expect(rules).not.toContain("\u2014");
        // Must use _default project name instead of Default
        expect(rules).toContain("_default");
        expect(rules).not.toMatch(/\bDefault group\b/);
        // Scoped planner usage
        expect(rules).toContain("Usage Policy");
        expect(rules).not.toContain("MUST NOT use the `default_api:ask_question` tool under any circumstances");
        // Auto-merge archiving instead of deletion
        expect(rules).toContain("Archive the original separate reports");
        expect(rules).not.toContain("Delete the original separate reports");
    });

    it("V-13: OrbitBrain respects privacy setting and redacts OS and Shell environment by default", async () => {
        delete process.env.ORBIT_RECORD_ENVIRONMENT;

        const brain = new OrbitBrain();
        await brain.initialize();

        const globalContextPath = path.join(tempDir, "global_context_summary.md");
        expect(fs.existsSync(globalContextPath)).toBe(true);

        const content = fs.readFileSync(globalContextPath, "utf-8");
        expect(content).toContain("[Redacted / privacy disabled]");
        expect(content).not.toContain(os.release());
    });

    it("V-13: OrbitBrain records OS and Shell environment when explicitly enabled", async () => {
        process.env.ORBIT_RECORD_ENVIRONMENT = "true";

        const brain = new OrbitBrain();
        await brain.initialize();

        const globalContextPath = path.join(tempDir, "global_context_summary.md");
        expect(fs.existsSync(globalContextPath)).toBe(true);

        const content = fs.readFileSync(globalContextPath, "utf-8");
        expect(content).toContain(os.platform());
        expect(content).toContain(os.release());
        expect(content).not.toContain("[Redacted / privacy disabled]");
    });
});
