import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("legacy-stub extension", () => {
    const stubDir = path.join(__dirname, "..", "legacy-stub");
    const packageJsonPath = path.join(stubDir, "package.json");
    const extensionJsPath = path.join(stubDir, "extension.js");

    it("has expected manifest properties and zero contributes", () => {
        expect(fs.existsSync(packageJsonPath)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

        expect(manifest.name).toBe("antigravity-pre-execution-form-planner");
        expect(manifest.publisher).toBe("VNTRCORP");
        expect(manifest.version).toBe("0.2.7");
        expect(manifest.main).toBe("./extension.js");
        expect(manifest.activationEvents).toEqual(["onStartupFinished"]);

        // Zero views, commands, or menus
        expect(manifest.contributes).toBeUndefined();
    });

    it("has compiled extension.js bundle", () => {
        expect(fs.existsSync(extensionJsPath)).toBe(true);
        const content = fs.readFileSync(extensionJsPath, "utf-8");
        expect(content.length).toBeGreaterThan(100);
        expect(content).toContain("orbit.legacyNoticeShown_027");
        expect(content).toContain("workbench.extensions.installExtension");
        expect(content).toContain("workbench.extensions.uninstallExtension");
    });

    it("has LICENSE.txt and README.md", () => {
        expect(fs.existsSync(path.join(stubDir, "LICENSE.txt"))).toBe(true);
        expect(fs.existsSync(path.join(stubDir, "README.md"))).toBe(true);
    });
});
