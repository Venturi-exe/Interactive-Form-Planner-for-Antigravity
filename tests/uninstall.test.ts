import { LEGACY_EXTENSION_IDS } from "../src/core/config";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runUninstall, isOrbitServerEntry } from "../src/uninstall";
import * as hostModule from "../src/core/host";
import { ORBIT_START_MARKER, ORBIT_END_MARKER } from "../src/core/rules";

describe("runUninstall and isOrbitServerEntry (N-01, N-02)", () => {
    let tempDir: string;
    let mockMcpConfig: string;
    let mockGeminiMd: string;
    let mockGlobalStorage: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-uninstall-test-"));
        mockMcpConfig = path.join(tempDir, "mcp_config.json");
        mockGeminiMd = path.join(tempDir, "GEMINI.md");
        mockGlobalStorage = path.join(tempDir, "globalStorage", "orbit");
        fs.mkdirSync(mockGlobalStorage, { recursive: true });

        vi.spyOn(hostModule, "detectHost").mockImplementation((appName?: string, callerDir?: string) => {
            const isAntigravity = appName
                ? /antigravity/i.test(appName)
                : callerDir
                ? hostModule.isAntigravityExtensionDir(callerDir)
                : false;
            return {
                isAntigravity,
                geminiDir: tempDir,
                configDir: tempDir,
                mcpConfigPath: mockMcpConfig,
                geminiMdPath: mockGeminiMd,
            };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("halts and does not write or corrupt mcp_config.json when syntax error exists, preserving GEMINI.md (V-03, M-01)", async () => {
        const malformed = `{\n  "mcpServers": {\n    "orbit": { unclosed syntax\n`;
        fs.writeFileSync(mockMcpConfig, malformed, "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const res = await runUninstall({ appName: "Antigravity IDE" });

        expect(res.success).toBe(false);
        expect(res.reason).toContain("Syntax errors detected");
        expect(fs.readFileSync(mockMcpConfig, "utf-8")).toBe(malformed);
        // GEMINI.md rules must NOT be cleaned when mcp_config.json fails
        expect(res.removedRules).toBe(false);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toContain(ORBIT_START_MARKER);
    });

    it("never deletes other MCP servers like git, fetch, or uvx mcp-server-git (N-01)", async () => {
        const initial = `{
            "mcpServers": {
                "git": { "command": "uvx", "args": ["mcp-server-git"] },
                "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] },
                "orbit": {
                    "command": "node",
                    "args": ["${mockGlobalStorage.replace(/\\/g, "/")}/mcp-server/index.js"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, initial, "utf-8");

        const res = await runUninstall({ globalStoragePath: mockGlobalStorage });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);

        const after = JSON.parse(fs.readFileSync(mockMcpConfig, "utf-8"));
        expect(after.mcpServers.git).toBeDefined();
        expect(after.mcpServers.git.args).toEqual(["mcp-server-git"]);
        expect(after.mcpServers.fetch).toBeDefined();
        expect(after.mcpServers.orbit).toBeUndefined();
    });

    it("creates rolling timestamped backups and retains at most 3 (N-01)", async () => {
        const initial = `{
            "mcpServers": {
                "orbit": {
                    "command": "node",
                    "args": ["${mockGlobalStorage.replace(/\\/g, "/")}/mcp-server/index.js"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, initial, "utf-8");

        // Seed 4 existing backups
        for (let i = 1; i <= 4; i++) {
            fs.writeFileSync(`${mockMcpConfig}.orbit.bak.${1000 + i}`, "backup", "utf-8");
        }

        await runUninstall({ globalStoragePath: mockGlobalStorage });

        const files = fs.readdirSync(tempDir);
        const backups = files.filter((f) => f.includes(".orbit.bak."));
        expect(backups.length).toBeLessThanOrEqual(3);
    });

    it("isOrbitServerEntry returns true only for known Orbit server paths (N-01)", () => {
        // True cases
        expect(isOrbitServerEntry("orbit", { args: [path.join(mockGlobalStorage, "mcp-server", "index.js")] }, mockGlobalStorage)).toBe(true);
        expect(isOrbitServerEntry("antigravity-planner", { args: [path.join(mockGlobalStorage, "index.js")] }, mockGlobalStorage)).toBe(true);

        // False cases: other keys, other paths
        expect(isOrbitServerEntry("git", { args: ["mcp-server-git"] }, mockGlobalStorage)).toBe(false);
        expect(isOrbitServerEntry("orbit", { args: ["C:/other/random/path.js"] }, mockGlobalStorage)).toBe(false);
        expect(isOrbitServerEntry("orbit", { command: "uvx", args: ["mcp-server-git"] }, mockGlobalStorage)).toBe(false);
    });

    it("does not remove GEMINI.md rules when running from stock VS Code (N-02)", async () => {
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const res = await runUninstall({ appName: "Visual Studio Code" });

        expect(res.removedRules).toBe(false);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toContain(ORBIT_START_MARKER);
    });

    it("running uninstall hook from real stock VS Code path with real extension name preserves Antigravity config and rules (M-01)", async () => {
        const realExtensionDir = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;
        const realStorageDir = LEGACY_EXTENSION_IDS[1];

        // Antigravity's storage path (also contains the word 'antigravity' in the extension name!)
        const antigravityStoragePath = `C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/${realStorageDir}/mcp-server/index.js`;
        const configWithAntigravity = `{
            "mcpServers": {
                "orbit": {
                    "command": "node",
                    "args": ["${antigravityStoragePath}"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, configWithAntigravity, "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        // Real stock VS Code extensions directory caller path (contains 'antigravity' in the extension folder name!)
        const vscodeCaller = `C:/Users/test/.vscode/extensions/${realExtensionDir}/out`;
        const res = await runUninstall({ callerDir: vscodeCaller });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(false);
        expect(res.removedRules).toBe(false);

        const configAfter = JSON.parse(fs.readFileSync(mockMcpConfig, "utf-8"));
        expect(configAfter.mcpServers.orbit).toBeDefined();
        expect(configAfter.mcpServers.orbit.args[0]).toBe(antigravityStoragePath);

        const geminiMdAfter = fs.readFileSync(mockGeminiMd, "utf-8");
        expect(geminiMdAfter).toContain(ORBIT_START_MARKER);
    });

    it("mirror test: uninstalling from real Antigravity path removes Antigravity server and GEMINI.md rules (M-01)", async () => {
        const realExtensionDir = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;
        const realStorageDir = LEGACY_EXTENSION_IDS[1];

        const antigravityStoragePath = `C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/${realStorageDir}/mcp-server/index.js`;
        const configWithAntigravity = `{
            "mcpServers": {
                "orbit": {
                    "command": "node",
                    "args": ["${antigravityStoragePath}"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, configWithAntigravity, "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        // Real Antigravity caller path
        const antigravityCaller = `C:/Users/test/.antigravity/extensions/${realExtensionDir}/out`;
        const res = await runUninstall({ callerDir: antigravityCaller });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        expect(res.removedRules).toBe(true);

        const configAfter = JSON.parse(fs.readFileSync(mockMcpConfig, "utf-8"));
        expect(configAfter.mcpServers.orbit).toBeUndefined();

        const geminiMdAfter = fs.readFileSync(mockGeminiMd, "utf-8");
        expect(geminiMdAfter).not.toContain(ORBIT_START_MARKER);
    });

    it("uninstalling from stock VS Code removes VS Code's own entry while leaving Antigravity's intact (M-01)", async () => {
        const realExtensionDir = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;
        const realStorageDir = LEGACY_EXTENSION_IDS[1];

        const vscodeStorage = `C:/Users/test/AppData/Roaming/Code/User/globalStorage/${realStorageDir}/mcp-server/index.js`;
        const antigravityStorage = `C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/${realStorageDir}/mcp-server/index.js`;

        const dualConfig = `{
            "mcpServers": {
                "orbit": { "command": "node", "args": ["${vscodeStorage}"] },
                "antigravity-planner": { "command": "node", "args": ["${antigravityStorage}"] }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, dualConfig, "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const vscodeCaller = `C:/Users/test/.vscode/extensions/${realExtensionDir}/out`;
        const res = await runUninstall({ callerDir: vscodeCaller });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        expect(res.removedRules).toBe(false);

        const configAfter = JSON.parse(fs.readFileSync(mockMcpConfig, "utf-8"));
        expect(configAfter.mcpServers.orbit).toBeUndefined();
        expect(configAfter.mcpServers["antigravity-planner"]).toBeDefined();
        expect(configAfter.mcpServers["antigravity-planner"].args[0]).toBe(antigravityStorage);

        // GEMINI.md was NOT touched because Antigravity's entry remained (P-01 side B)
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toContain(ORBIT_START_MARKER);
    });

    it("uninstalling from stock VS Code removes rules from GEMINI.md if no Orbit keys remain in mcp_config.json (P-01 side A)", async () => {
        const realExtensionDir = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;
        const realStorageDir = LEGACY_EXTENSION_IDS[1];

        const vscodeStorage = `C:/Users/test/AppData/Roaming/Code/User/globalStorage/${realStorageDir}/mcp-server/index.js`;

        // Only VS Code entry in config
        const singleConfig = `{
            "mcpServers": {
                "orbit": { "command": "node", "args": ["${vscodeStorage}"] }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, singleConfig, "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const vscodeCaller = `C:/Users/test/.vscode/extensions/${realExtensionDir}/out`;
        const res = await runUninstall({ callerDir: vscodeCaller });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        expect(res.removedRules).toBe(true);

        const configAfter = JSON.parse(fs.readFileSync(mockMcpConfig, "utf-8"));
        expect(configAfter.mcpServers.orbit).toBeUndefined();

        // GEMINI.md rules were removed because this was the sole Orbit server entry
        const geminiMdAfter = fs.readFileSync(mockGeminiMd, "utf-8");
        expect(geminiMdAfter).not.toContain(ORBIT_START_MARKER);
    });

    it("isOrbitServerEntry fallback requires exact package name in globalStorage (P-02)", () => {
        // Entry pointing to another extension with 'orbit' in name: must NOT match
        const otherExtPath = "C:/Users/test/AppData/Roaming/Code/User/globalStorage/someone.orbit-tools/server/index.js";
        expect(isOrbitServerEntry("orbit", { args: [otherExtPath] }, undefined, false)).toBe(false);

        // Entry pointing to genuine extension storage for VS Code: matches when hostIsAntigravity is false
        const genuineVsCodePath = `C:/Users/test/AppData/Roaming/Code/User/globalStorage/${LEGACY_EXTENSION_IDS[1]}/mcp-server/index.js`;
        expect(isOrbitServerEntry("orbit", { args: [genuineVsCodePath] }, undefined, false)).toBe(true);

        const genuineOrbitVsCodePath = "C:/Users/test/AppData/Roaming/Code/User/globalStorage/vntrcorp.orbit/mcp-server/index.js";
        expect(isOrbitServerEntry("orbit", { args: [genuineOrbitVsCodePath] }, undefined, false)).toBe(true);

        // Entry pointing to genuine extension storage for Antigravity: does NOT match when hostIsAntigravity is false
        const genuineAntigravityPath = `C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/${LEGACY_EXTENSION_IDS[1]}/mcp-server/index.js`;
        expect(isOrbitServerEntry("orbit", { args: [genuineAntigravityPath] }, undefined, false)).toBe(false);
    });

    it("isOrbitServerEntry strictly enforces directory boundaries without prefix collisions (M-01, M-06)", () => {
        const baseStorage = path.join(tempDir, "vntrcorp.orbit");
        const similarStorage = path.join(tempDir, "vntrcorp.orbit-other");

        // Substring prefix collision test
        const falseEntry = { args: [path.join(similarStorage, "mcp-server", "index.js")] };
        expect(isOrbitServerEntry("orbit", falseEntry, baseStorage)).toBe(false);

        // Genuine subpath
        const trueEntry = { args: [path.join(baseStorage, "mcp-server", "index.js")] };
        expect(isOrbitServerEntry("orbit", trueEntry, baseStorage)).toBe(true);
    });

    it("cleans VS Code-owned entries across multiple mcp_config.json files while preserving rules if an Antigravity entry remains (Q-01)", async () => {
        const realExtensionDir = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;
        const realStorageDir = LEGACY_EXTENSION_IDS[1];

        const ideConfigPath = path.join(tempDir, "antigravity-ide-config.json");
        const cliConfigPath = path.join(tempDir, "antigravity-cli-config.json");

        const vscodeStorage = `C:/Users/test/AppData/Roaming/Code/User/globalStorage/${realStorageDir}/mcp-server/index.js`;
        const antigravityStorage = `C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/${realStorageDir}/mcp-server/index.js`;

        // CLI config has leftover VS Code entry (e.g. from v0.2.6)
        fs.writeFileSync(cliConfigPath, JSON.stringify({
            mcpServers: {
                orbit: { command: "node", args: [vscodeStorage] }
            }
        }), "utf-8");

        // IDE config has active Antigravity entry
        fs.writeFileSync(ideConfigPath, JSON.stringify({
            mcpServers: {
                "antigravity-planner": { command: "node", args: [antigravityStorage] }
            }
        }), "utf-8");

        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const vscodeCaller = `C:/Users/test/.vscode/extensions/${realExtensionDir}/out`;
        const res = await runUninstall({
            callerDir: vscodeCaller,
            mcpConfigPaths: [ideConfigPath, cliConfigPath]
        });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        // Rules must NOT be removed because ideConfigPath still contains an Antigravity entry
        expect(res.removedRules).toBe(false);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toContain(ORBIT_START_MARKER);

        // CLI config had its VS Code entry removed
        const cliConfigAfter = JSON.parse(fs.readFileSync(cliConfigPath, "utf-8"));
        expect(cliConfigAfter.mcpServers.orbit).toBeUndefined();

        // IDE config still has its Antigravity entry
        const ideConfigAfter = JSON.parse(fs.readFileSync(ideConfigPath, "utf-8"));
        expect(ideConfigAfter.mcpServers["antigravity-planner"]).toBeDefined();
    });

    it("removes rules from GEMINI.md when all candidate config files have no remaining Orbit entries (Q-01)", async () => {
        const realExtensionDir = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;
        const realStorageDir = LEGACY_EXTENSION_IDS[1];

        const ideConfigPath = path.join(tempDir, "antigravity-ide-config2.json");
        const cliConfigPath = path.join(tempDir, "antigravity-cli-config2.json");

        const vscodeStorage = `C:/Users/test/AppData/Roaming/Code/User/globalStorage/${realStorageDir}/mcp-server/index.js`;

        // CLI config has leftover VS Code entry
        fs.writeFileSync(cliConfigPath, JSON.stringify({
            mcpServers: {
                orbit: { command: "node", args: [vscodeStorage] }
            }
        }), "utf-8");

        // IDE config has no orbit entries
        fs.writeFileSync(ideConfigPath, JSON.stringify({
            mcpServers: {
                git: { command: "uvx", args: ["mcp-server-git"] }
            }
        }), "utf-8");

        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const vscodeCaller = `C:/Users/test/.vscode/extensions/${realExtensionDir}/out`;
        const res = await runUninstall({
            callerDir: vscodeCaller,
            mcpConfigPaths: [ideConfigPath, cliConfigPath]
        });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        // Rules MUST be removed because no Orbit entries remain anywhere
        expect(res.removedRules).toBe(true);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).not.toContain(ORBIT_START_MARKER);
    });

    it("aborts atomically and leaves first config intact when a second candidate config has syntax errors (N-02, Q-01)", async () => {
        const ideConfigPath = path.join(tempDir, "antigravity-ide-atomic1.json");
        const malformedConfigPath = path.join(tempDir, "antigravity-cli-malformed.json");

        const initialIdeContent = JSON.stringify({
            mcpServers: {
                orbit: { command: "node", args: ["C:/Users/test/AppData/Roaming/Code/User/globalStorage/vntrcorp.orbit/mcp-server/index.js"] }
            }
        }, null, 2);

        fs.writeFileSync(ideConfigPath, initialIdeContent, "utf-8");
        // Second config has a syntax error
        fs.writeFileSync(malformedConfigPath, "{ mcpServers: { broken json ...", "utf-8");

        const vscodeCaller = "C:/Users/test/.vscode/extensions/vntrcorp.orbit-0.4.0/out";
        const res = await runUninstall({
            callerDir: vscodeCaller,
            mcpConfigPaths: [ideConfigPath, malformedConfigPath]
        });

        expect(res.success).toBe(false);
        expect(res.reason).toContain("Syntax errors detected in");
        expect(res.removedServer).toBe(false);

        // Crucial N-02 guarantee: first config MUST NOT have been modified on disk
        const ideContentAfter = fs.readFileSync(ideConfigPath, "utf-8");
        expect(ideContentAfter).toBe(initialIdeContent);
    });

    it("handles uninstall from vntrcorp.orbit-0.4.0 caller directory cleanly (N-07)", async () => {
        const ideConfigPath = path.join(tempDir, "antigravity-ide-orbit-caller.json");
        const orbitStorage = "C:/Users/test/AppData/Roaming/Code/User/globalStorage/vntrcorp.orbit/mcp-server/index.js";

        fs.writeFileSync(ideConfigPath, JSON.stringify({
            mcpServers: {
                orbit: { command: "node", args: [orbitStorage] }
            }
        }), "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nrules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const orbitCaller = "C:/Users/test/.vscode/extensions/vntrcorp.orbit-0.4.0/out";
        const res = await runUninstall({
            callerDir: orbitCaller,
            mcpConfigPaths: [ideConfigPath]
        });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        expect(res.removedRules).toBe(true);

        const configAfter = JSON.parse(fs.readFileSync(ideConfigPath, "utf-8"));
        expect(configAfter.mcpServers.orbit).toBeUndefined();
    });

    it("respects preserveRules: true and leaves GEMINI.md completely untouched", async () => {
        const ideConfigPath = path.join(tempDir, "antigravity-ide-preserve.json");
        const orbitStorage = "C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/vntrcorp.orbit/mcp-server/index.js";

        fs.writeFileSync(ideConfigPath, JSON.stringify({
            mcpServers: {
                orbit: { command: "node", args: [orbitStorage] }
            }
        }), "utf-8");
        const customPrompt = "# My Custom Protocol Rules\nDo not touch.";
        fs.writeFileSync(mockGeminiMd, customPrompt, "utf-8");

        const res = await runUninstall({
            appName: "Google Antigravity IDE",
            mcpConfigPath: ideConfigPath,
            geminiMdPath: mockGeminiMd,
            preserveRules: true,
        });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(true);
        expect(res.removedRules).toBe(false);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toBe(customPrompt);
    });

    it("restores backup when restoreBackup: true is passed", async () => {
        const ideConfigPath = path.join(tempDir, "antigravity-ide-restore.json");
        const orbitStorage = "C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/vntrcorp.orbit/mcp-server/index.js";

        fs.writeFileSync(ideConfigPath, JSON.stringify({
            mcpServers: {
                orbit: { command: "node", args: [orbitStorage] }
            }
        }), "utf-8");

        const originalText = "# Pre-Orbit Instructions\nOriginal user prompt.";
        const backupPath = `${mockGeminiMd}.bak-2026-10-26T12-00-00-000Z`;
        fs.writeFileSync(backupPath, originalText, "utf-8");
        fs.writeFileSync(mockGeminiMd, `${ORBIT_START_MARKER}\nOrbit rules\n${ORBIT_END_MARKER}\n`, "utf-8");

        const res = await runUninstall({
            appName: "Google Antigravity IDE",
            mcpConfigPath: ideConfigPath,
            geminiMdPath: mockGeminiMd,
            restoreBackup: true,
        });

        expect(res.success).toBe(true);
        expect(res.restoredBackup).toBe(true);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toBe(originalText);
    });
});

