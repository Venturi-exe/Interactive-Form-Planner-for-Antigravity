import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const IPC_DIR = path.join(os.homedir(), ".antigravity-forms");
const REQUESTS_DIR = path.join(IPC_DIR, "requests");
const RESPONSES_DIR = path.join(IPC_DIR, "responses");

// Ensure IPC directories exist
fs.mkdirSync(REQUESTS_DIR, { recursive: true });
fs.mkdirSync(RESPONSES_DIR, { recursive: true });

const fieldSchema = z.object({
    id: z.string().describe("Unique identifier for this field"),
    label: z.string().describe("Label displayed to the user"),
    type: z
        .enum(["single-choice", "multi-choice", "free-text"])
        .describe("single-choice: radio group. multi-choice: checkbox group. free-text: text input."),
    options: z
        .array(z.string())
        .optional()
        .describe("Options for single-choice and multi-choice fields. The webview auto-appends an 'Other' option."),
    required: z.boolean().optional().default(false).describe("Whether the field must be answered"),
    placeholder: z.string().optional().describe("Placeholder text for free-text fields"),
});

const server = new McpServer({
    name: "antigravity-alignment",
    version: "0.2.0",
});

function generateRequestId(): string {
    return `align_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Polls the responses directory until a response file appears for the given request.
 * Returns the parsed response data. Cleans up both request and response files.
 */
function pollForResponse(requestId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const responseFile = path.join(RESPONSES_DIR, `${requestId}.json`);
    const requestFile = path.join(REQUESTS_DIR, `${requestId}.json`);
    const pollInterval = 500;

    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = (): void => {
            if (Date.now() - startTime > timeoutMs) {
                // Clean up stale request file on timeout
                try { fs.unlinkSync(requestFile); } catch { /* already gone */ }
                reject(new Error("Form timed out after 5 minutes without a response."));
                return;
            }

            if (fs.existsSync(responseFile)) {
                try {
                    const raw = fs.readFileSync(responseFile, "utf-8");
                    const data = JSON.parse(raw) as Record<string, unknown>;
                    // Clean up IPC files
                    try { fs.unlinkSync(responseFile); } catch { /* ok */ }
                    try { fs.unlinkSync(requestFile); } catch { /* ok */ }
                    resolve(data);
                } catch (err) {
                    reject(err);
                }
                return;
            }

            setTimeout(check, pollInterval);
        };

        check();
    });
}

server.tool(
    "align_before_edit",
    "Submit this form before writing or modifying any file OR generating complex text-only output (e.g., blog posts, documentation, structured plans) when: a new feature or page is being built, an existing file is being changed, the task is ambiguous or missing detail, you have a better approach to suggest, the change has side effects on other parts of the project, or multiple valid approaches exist. Do not call this tool if the task is fully specified, unambiguous, has no better alternative, and has no side effects on other files.",
    {
        title: z.string().describe("What decision needs alignment"),
        description: z.string().optional().describe("Why the agent is asking"),
        fields: z.array(fieldSchema).max(5).describe("Form fields, 5 maximum"),
        showExecuteButton: z.boolean().optional().default(false).describe("Show an 'Execute Plan' button. Use only during deep prompt refining loops."),
    },
    async ({ title, description, fields, showExecuteButton }) => {
        const requestId = generateRequestId();

        const request = {
            requestId,
            title,
            description: description ?? "",
            fields,
            showExecuteButton: showExecuteButton ?? false,
        };

        // Write request file for the extension to pick up
        const requestFile = path.join(REQUESTS_DIR, `${requestId}.json`);
        fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));

        // Poll for response (5 minute timeout)
        const response = await pollForResponse(requestId, 5 * 60 * 1000);

        const action = (response as any).action ?? "submit";

        if (action === "execute") {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                action: "execute",
                                message:
                                    "User clicked Execute Plan. Stop planning. Generate a planning receipt, then begin implementation.",
                                data: response.data ?? response,
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }

        if (response.dismissed) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                action: "dismiss",
                                dismissed: true,
                                message:
                                    "User chose to skip. Proceed with the original prompt and existing context only. Do not apply assumptions from unanswered fields.",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            action: "submit",
                            data: response.data ?? response,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    process.stderr.write(`Alignment MCP server error: ${error}\n`);
    process.exit(1);
});
