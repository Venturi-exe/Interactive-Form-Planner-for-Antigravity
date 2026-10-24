import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as jsonc from "jsonc-parser";
import { updateMcpConfig } from "../src/core/config";

describe("updateMcpConfig (N-14)", () => {
    let tempDir: string;
    let configPath: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-config-test-"));
        configPath = path.join(tempDir, "mcp_config.json");
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("creates new config when file does not exist", async () => {
        const result = await updateMcpConfig(configPath, "C:\\mock\\out\\mcp-server\\index.js");
        expect(result.success).toBe(true);
        expect(result.backedUp).toBe(false);

        const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(content.mcpServers.orbit).toEqual({
            command: "node",
            args: ["C:/mock/out/mcp-server/index.js"],
        });
    });

    it("treats 0-byte or whitespace-only config as empty object instead of halting (N-14)", async () => {
        fs.writeFileSync(configPath, "   \n\t  ", "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\mock\\out\\mcp-server\\index.js");
        expect(result.success).toBe(true);

        const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(content.mcpServers.orbit).toEqual({
            command: "node",
            args: ["C:/mock/out/mcp-server/index.js"],
        });
    });

    it("parses JSON with comments and trailing commas, preserves comments and existing servers, and creates rolling backup", async () => {
        const initialContent = `{
            // Custom comments here
            "mcpServers": {
                "other-server": {
                    "command": "python",
                    "args": ["server.py"],
                },
                "antigravity-planner": {
                    "command": "node",
                    "args": ["legacy-orbit-mcp-server.js"],
                },
            },
        }`;
        fs.writeFileSync(configPath, initialContent, "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\new\\server\\index.js");
        expect(result.success).toBe(true);
        expect(result.backedUp).toBe(true);

        // Verify rolling backup exists
        const files = fs.readdirSync(tempDir);
        const backups = files.filter((f) => f.includes(".orbit.bak."));
        expect(backups.length).toBeGreaterThan(0);

        // Verify modified content preserves custom comments
        const rawAfter = fs.readFileSync(configPath, "utf-8");
        expect(rawAfter).toContain("// Custom comments here");

        const modified = jsonc.parse(rawAfter);
        expect(modified.mcpServers["other-server"]).toEqual({
            command: "python",
            args: ["server.py"],
        });
        expect(modified.mcpServers["antigravity-planner"]).toBeUndefined();
        expect(modified.mcpServers.orbit).toEqual({
            command: "node",
            args: ["C:/new/server/index.js"],
        });
    });

    it("halts if existing mcpServers.orbit belongs to an unrelated third-party program (N-14)", async () => {
        const foreignOrbit = `{
            "mcpServers": {
                "orbit": {
                    "command": "docker",
                    "args": ["run", "my-personal-orbit-satellite-tracker"]
                }
            }
        }`;
        fs.writeFileSync(configPath, foreignOrbit, "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\new\\server\\index.js");
        expect(result.success).toBe(false);
        expect(result.error).toContain("does not appear to belong to Orbit");

        // Content was not overwritten
        const raw = fs.readFileSync(configPath, "utf-8");
        expect(raw).toContain("my-personal-orbit-satellite-tracker");
    });

    it("halts and does not overwrite or backup if JSON has fatal syntax error", async () => {
        const corrupted = `{\n  "mcpServers": {\n    "bad": [unclosed array\n`;
        fs.writeFileSync(configPath, corrupted, "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\mock\\server.js");
        expect(result.success).toBe(false);
        expect(result.error).toContain("syntax errors detected");

        // Verify original file is untouched and no backup was made
        expect(fs.readFileSync(configPath, "utf-8")).toBe(corrupted);
    });

    it("uses custom nodeCommand when specified", async () => {
        const result = await updateMcpConfig(configPath, "C:\\test\\index.js", "C:\\custom\\node.exe");
        expect(result.success).toBe(true);
        const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(updated.mcpServers.orbit.command).toBe("C:\\custom\\node.exe");
    });
});
