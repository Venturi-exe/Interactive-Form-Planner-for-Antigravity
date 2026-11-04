import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("Hardened MCP server tools", () => {
    let mockBrainDir: string;
    let mockIpcDir: string;
    let client: Client;
    let transport: StdioClientTransport;

    beforeEach(async () => {
        mockBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-mcp-brain-"));
        mockIpcDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-mcp-ipc-"));

        const serverScript = path.join(__dirname, "..", "out", "mcp-server", "index.js");

        transport = new StdioClientTransport({
            command: "node",
            args: [serverScript],
            env: {
                ...process.env,
                ORBIT_BRAIN_DIR: mockBrainDir,
                ANTIGRAVITY_FORMS_DIR: mockIpcDir,
            },
        });

        client = new Client(
            { name: "orbit-test-client", version: "1.0.0" },
            { capabilities: {} }
        );

        await client.connect(transport);
    });

    afterEach(async () => {
        try {
            await client.close();
        } catch { /* ignore */ }

        try {
            fs.rmSync(mockBrainDir, { recursive: true, force: true });
            fs.rmSync(mockIpcDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("lists all registered tools", async () => {
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name);
        expect(names).toContain("orbit_planner");
        expect(names).toContain("write_impact_report");
        expect(names).toContain("orbit_memory");
    });

    it("write_impact_report writes report atomically to impacts directory and redacts path", async () => {
        const result = (await client.callTool({
            name: "write_impact_report",
            arguments: {
                taskId: "test-task-1",
                timestamp: new Date().toISOString(),
                summary: "Hardening test task",
                changes: [
                    {
                        filePath: "src/server.ts",
                        changeType: "edited",
                        promptExcerpt: "Fix bug",
                        description: "Fixed bug",
                    },
                ],
                projectName: "test_project",
            },
        })) as { content: Array<{ type: string; text: string }> };

        expect(result.content[0].type).toBe("text");
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);

        // Verify report file was created in mockIpcDir/impacts
        const impactsDir = path.join(mockIpcDir, "impacts");
        const files = fs.readdirSync(impactsDir);
        expect(files.length).toBe(1);
        expect(files[0]).toMatch(/^report_.*\.json$/);

        // Verify output path does not contain raw Windows user path
        expect(parsed.message).not.toContain("C:\\Users\\fixture-user");
    });

    it("orbit_memory ensure_project creates project scaffold with PROTOCOL.md (Layout v3)", async () => {
        const result = (await client.callTool({
            name: "orbit_memory",
            arguments: {
                action: "ensure_project",
                projectName: "alpha_proj",
            },
        })) as { content: Array<{ type: string; text: string }> };

        expect(result.content[0].text).toContain("ensured and memory scaffold created");

        const projDir = path.join(mockBrainDir, "projects", "alpha_proj");
        expect(fs.existsSync(projDir)).toBe(true);
        expect(fs.existsSync(path.join(projDir, "cartograph"))).toBe(true);
        expect(fs.existsSync(path.join(projDir, "archive"))).toBe(true);
        expect(fs.existsSync(path.join(projDir, "memories", "sessions"))).toBe(true);
        expect(fs.existsSync(path.join(projDir, "memories", "features"))).toBe(true);
        expect(fs.existsSync(path.join(projDir, "memories", "tasks"))).toBe(true);

        const protocolPath = path.join(projDir, "memories", "PROTOCOL.md");
        expect(fs.existsSync(protocolPath)).toBe(true);
        const protocol = fs.readFileSync(protocolPath, "utf-8");
        expect(protocol).toContain("Topic-Based Memory Protocol (v3.0)");

        const indexPath = path.join(projDir, "memories", "INDEX.md");
        expect(fs.existsSync(indexPath)).toBe(true);
        const index = fs.readFileSync(indexPath, "utf-8");
        expect(index).toContain("Active Topics");
    });

    it("orbit_memory list_projects inspects projects/ in Layout v3 and legacy root", async () => {
        // Setup v3 project under projects/
        const v3Dir = path.join(mockBrainDir, "projects", "v3_app");
        fs.mkdirSync(v3Dir, { recursive: true });

        // Setup legacy flat project under brain root
        const legacyDir = path.join(mockBrainDir, "legacy_app", "memories");
        fs.mkdirSync(legacyDir, { recursive: true });

        const result = (await client.callTool({
            name: "orbit_memory",
            arguments: { action: "list_projects" },
        })) as { content: Array<{ type: string; text: string }> };

        const list = JSON.parse(result.content[0].text) as string[];
        expect(list).toContain("v3_app");
        expect(list).toContain("legacy_app");
    });

    it("orbit_memory cartograph operations route through projects/<key>/cartograph/", async () => {
        const reportData = { taskId: "task_v3", summary: "Layout v3 test" };

        // 1. Write report
        const writeRes = (await client.callTool({
            name: "orbit_memory",
            arguments: {
                action: "write_cartograph_report",
                projectName: "gamma_proj",
                filename: "report_v3.json",
                content: JSON.stringify(reportData),
            },
        })) as { content: Array<{ type: string; text: string }> };
        expect(writeRes.content[0].text).toContain("Successfully wrote cartograph report");

        // Verify written to projects/gamma_proj/cartograph/report_v3.json
        const expectedPath = path.join(mockBrainDir, "projects", "gamma_proj", "cartograph", "report_v3.json");
        expect(fs.existsSync(expectedPath)).toBe(true);

        // 2. Read report
        const readRes = (await client.callTool({
            name: "orbit_memory",
            arguments: {
                action: "read_cartograph_report",
                projectName: "gamma_proj",
                filename: "report_v3.json",
            },
        })) as { content: Array<{ type: string; text: string }> };
        const readParsed = JSON.parse(readRes.content[0].text);
        expect(readParsed.taskId).toBe("task_v3");

        // 3. List reports
        const listRes = (await client.callTool({
            name: "orbit_memory",
            arguments: {
                action: "list_cartograph_reports",
                projectName: "gamma_proj",
            },
        })) as { content: Array<{ type: string; text: string }> };
        const reports = JSON.parse(listRes.content[0].text);
        expect(reports.some((r: { filename: string }) => r.filename === "report_v3.json")).toBe(true);
    });

    it("orbit_memory write_file rejects denied paths", async () => {
        const result = (await client.callTool({
            name: "orbit_memory",
            arguments: {
                action: "write_file",
                filePath: "optic/config.json",
                content: '{"secret": true}',
            },
        })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Write access denied");
    });

    it("orbit_memory delete_cartograph_report moves file to .trash instead of permanent deletion", async () => {
        // Setup report in project cartograph dir
        const cartDir = path.join(mockBrainDir, "projects", "beta_proj", "cartograph");
        fs.mkdirSync(cartDir, { recursive: true });
        const reportPath = path.join(cartDir, "report_001.json");
        fs.writeFileSync(reportPath, JSON.stringify({ taskId: "001" }), "utf-8");

        const deleteResult = (await client.callTool({
            name: "orbit_memory",
            arguments: {
                action: "delete_cartograph_report",
                projectName: "beta_proj",
                filename: "report_001.json",
            },
        })) as { content: Array<{ type: string; text: string }> };

        expect(deleteResult.content[0].text).toContain("moved cartograph report report_001.json to trash");

        // Verify file no longer in cartograph dir
        expect(fs.existsSync(reportPath)).toBe(false);

        // Verify file exists in .trash
        const trashDir = path.join(mockBrainDir, ".trash");
        expect(fs.existsSync(trashDir)).toBe(true);
        const trashFiles = fs.readdirSync(trashDir);
        expect(trashFiles.length).toBe(1);
        expect(trashFiles[0]).toContain("report_001.json");
    });
});
