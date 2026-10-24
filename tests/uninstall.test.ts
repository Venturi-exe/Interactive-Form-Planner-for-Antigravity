import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runUninstall, isOrbitServerEntry } from "../src/uninstall";
import * as hostModule from "../src/core/host";

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

        vi.spyOn(hostModule, "detectHost").mockImplementation((appName?: string) => ({
            isAntigravity: Boolean(appName && /antigravity/i.test(appName)),
            geminiDir: tempDir,
            configDir: tempDir,
            mcpConfigPath: mockMcpConfig,
            geminiMdPath: mockGeminiMd,
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("halts and does not write or corrupt mcp_config.json when syntax error exists (V-03)", async () => {
        const malformed = `{\n  "mcpServers": {\n    "orbit": { unclosed syntax\n`;
        fs.writeFileSync(mockMcpConfig, malformed, "utf-8");

        const res = await runUninstall();

        expect(res.success).toBe(false);
        expect(res.reason).toContain("Syntax errors detected");
        expect(fs.readFileSync(mockMcpConfig, "utf-8")).toBe(malformed);
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
        fs.writeFileSync(mockGeminiMd, "<!-- ORBIT_START_v1 -->\nrules\n<!-- ORBIT_END_v1 -->\n", "utf-8");

        const res = await runUninstall({ appName: "Visual Studio Code" });

        expect(res.removedRules).toBe(false);
        expect(fs.readFileSync(mockGeminiMd, "utf-8")).toContain("ORBIT_START_v1");
    });

    it("running uninstall hook with no options when config has Antigravity entry does not remove anything (M-01)", async () => {
        const antigravityStoragePath = "C:/Users/test/AppData/Roaming/Antigravity/User/globalStorage/vntrcorp.orbit/mcp-server/index.js";
        const configWithAntigravity = `{
            "mcpServers": {
                "orbit": {
                    "command": "node",
                    "args": ["${antigravityStoragePath}"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, configWithAntigravity, "utf-8");
        fs.writeFileSync(mockGeminiMd, "<!-- ORBIT_START_v1 -->\nrules\n<!-- ORBIT_END_v1 -->\n", "utf-8");

        // Simulate stock VS Code extensions directory caller
        const res = await runUninstall({
            callerDir: "C:/Users/test/.vscode/extensions/vntrcorp.orbit-0.4.0/out",
        });

        expect(res.success).toBe(true);
        expect(res.removedServer).toBe(false);
        expect(res.removedRules).toBe(false);

        const configAfter = JSON.parse(fs.readFileSync(mockMcpConfig, "utf-8"));
        expect(configAfter.mcpServers.orbit).toBeDefined();
        expect(configAfter.mcpServers.orbit.args[0]).toBe(antigravityStoragePath);

        const geminiMdAfter = fs.readFileSync(mockGeminiMd, "utf-8");
        expect(geminiMdAfter).toContain("ORBIT_START_v1");
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
});
