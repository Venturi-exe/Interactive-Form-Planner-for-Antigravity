import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as jsonc from "jsonc-parser";
import { updateMcpConfig } from "../src/core/config";

describe("updateMcpConfig", () => {
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
        expect(fs.existsSync(`${configPath}.orbit.bak`)).toBe(false);
    });

    it("parses JSON with comments and trailing commas, preserves comments and existing servers, and creates backup", async () => {
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

        // Verify backup exists and contains exact initial content
        expect(fs.existsSync(`${configPath}.orbit.bak`)).toBe(true);
        expect(fs.readFileSync(`${configPath}.orbit.bak`, "utf-8")).toBe(initialContent);

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

    it("preserves user custom fields in orbit server entry and does not overwrite existing backup", async () => {
        const initialContent = `{
            "mcpServers": {
                "orbit": {
                    "command": "old-node",
                    "args": ["old.js"],
                    "env": {
                        "MY_KEY": "secret"
                    },
                    "disabled": false
                }
            }
        }`;
        fs.writeFileSync(configPath, initialContent, "utf-8");
        fs.writeFileSync(`${configPath}.orbit.bak`, "PRESERVED_ORIGINAL_BACKUP", "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\fresh\\index.js");
        expect(result.success).toBe(true);
        expect(result.backedUp).toBe(false);

        // Verify backup was NOT overwritten
        expect(fs.readFileSync(`${configPath}.orbit.bak`, "utf-8")).toBe("PRESERVED_ORIGINAL_BACKUP");

        // Verify user fields in orbit entry were preserved
        const modified = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(modified.mcpServers.orbit.command).toBe("node");
        expect(modified.mcpServers.orbit.args).toEqual(["C:/fresh/index.js"]);
        expect(modified.mcpServers.orbit.env).toEqual({ MY_KEY: "secret" });
        expect(modified.mcpServers.orbit.disabled).toBe(false);
    });

    it("halts and does not overwrite or backup if JSON has fatal syntax error", async () => {
        const corrupted = `{\n  "mcpServers": {\n    "bad": [unclosed array\n`;
        fs.writeFileSync(configPath, corrupted, "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\mock\\server.js");
        expect(result.success).toBe(false);
        expect(result.error).toContain("syntax errors detected");

        // Verify original file is untouched and no backup was made
        expect(fs.readFileSync(configPath, "utf-8")).toBe(corrupted);
        expect(fs.existsSync(`${configPath}.orbit.bak`)).toBe(false);
    });

    it("handles config with missing mcpServers key gracefully", async () => {
        fs.writeFileSync(configPath, JSON.stringify({ version: "1.0" }), "utf-8");

        const result = await updateMcpConfig(configPath, "C:\\test\\index.js");
        expect(result.success).toBe(true);
        expect(result.backedUp).toBe(true);

        const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(updated.version).toBe("1.0");
        expect(updated.mcpServers.orbit).toEqual({
            command: "node",
            args: ["C:/test/index.js"],
        });
    });
});
