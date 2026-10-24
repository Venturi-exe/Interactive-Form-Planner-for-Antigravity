import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runUninstall } from "../src/uninstall";
import * as hostModule from "../src/core/host";

describe("runUninstall", () => {
    let tempDir: string;
    let mockMcpConfig: string;
    let mockGeminiMd: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-uninstall-test-"));
        mockMcpConfig = path.join(tempDir, "mcp_config.json");
        mockGeminiMd = path.join(tempDir, "GEMINI.md");

        vi.spyOn(hostModule, "detectHost").mockReturnValue({
            isAntigravity: true,
            geminiDir: tempDir,
            configDir: tempDir,
            mcpConfigPath: mockMcpConfig,
            geminiMdPath: mockGeminiMd,
        });
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

        await runUninstall();

        // Must remain exactly unchanged
        expect(fs.readFileSync(mockMcpConfig, "utf-8")).toBe(malformed);
        expect(fs.existsSync(`${mockMcpConfig}.orbit.bak`)).toBe(false);
    });

    it("preserves comments, removes orbit server, and creates backup upon clean uninstall", async () => {
        const initial = `{
            // Important user comments
            "mcpServers": {
                "other": { "command": "py", "args": ["app.py"] },
                "orbit": {
                    "command": "node",
                    "args": ["C:/path/to/orbit/mcp-server/index.js"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, initial, "utf-8");

        await runUninstall();

        expect(fs.existsSync(`${mockMcpConfig}.orbit.bak`)).toBe(true);
        expect(fs.readFileSync(`${mockMcpConfig}.orbit.bak`, "utf-8")).toBe(initial);

        const contentAfter = fs.readFileSync(mockMcpConfig, "utf-8");
        expect(contentAfter).toContain("// Important user comments");
        expect(contentAfter).toContain('"other"');
        expect(contentAfter).not.toContain('"orbit"');
    });

    it("does not remove mcpServers.orbit if it does not point to Orbit server", async () => {
        const initial = `{
            "mcpServers": {
                "orbit": {
                    "command": "unrelated-tool",
                    "args": ["some-other-app.js"]
                }
            }
        }`;
        fs.writeFileSync(mockMcpConfig, initial, "utf-8");

        await runUninstall();

        const contentAfter = fs.readFileSync(mockMcpConfig, "utf-8");
        expect(contentAfter).toContain("unrelated-tool");
    });
});
