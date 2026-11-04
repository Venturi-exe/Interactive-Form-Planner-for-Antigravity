import { LEGACY_EXTENSION_IDS } from "../src/core/config";
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

        expect(manifest.name).toBe(LEGACY_EXTENSION_IDS[0].slice("vntrcorp.".length));
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
        expect(content).toContain("orbit.legacyNoticeActionTaken_027");
        expect(content).toContain("workbench.extensions.installExtension");
        expect(content).toContain("workbench.extensions.uninstallExtension");
    });

    it("has LICENSE.txt and README.md", () => {
        expect(fs.existsSync(path.join(stubDir, "LICENSE.txt"))).toBe(true);
        expect(fs.existsSync(path.join(stubDir, "README.md"))).toBe(true);
    });

    describe("legacy-stub-interactive extension", () => {
        const interactiveStubDir = path.join(__dirname, "..", "legacy-stub-interactive");
        const interactivePkgPath = path.join(interactiveStubDir, "package.json");
        const interactiveExtJsPath = path.join(interactiveStubDir, "extension.js");

        it("has expected manifest properties for the interactive legacy package", () => {
            expect(fs.existsSync(interactivePkgPath)).toBe(true);
            const manifest = JSON.parse(fs.readFileSync(interactivePkgPath, "utf-8"));

            expect(manifest.name).toBe(LEGACY_EXTENSION_IDS[1].slice("vntrcorp.".length));
            expect(manifest.publisher).toBe("VNTRCORP");
            expect(manifest.version).toBe("0.2.7");
            expect(manifest.main).toBe("./extension.js");
            expect(manifest.activationEvents).toEqual(["onStartupFinished"]);
            expect(manifest.contributes).toBeUndefined();
        });

        it("has compiled extension.js bundle pointing to VNTRCORP.orbit", () => {
            expect(fs.existsSync(interactiveExtJsPath)).toBe(true);
            const content = fs.readFileSync(interactiveExtJsPath, "utf-8");
            expect(content).toContain("VNTRCORP.orbit");
            expect(content).toContain("workbench.extensions.installExtension");
        });
    });
});
