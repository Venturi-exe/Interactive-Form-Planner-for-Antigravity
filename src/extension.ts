import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { FormViewProvider } from "./FormViewProvider.js";
import { McpBridge } from "./McpBridge.js";

let mcpBridge: McpBridge | undefined;

/**
 * Extension entry point. Registers the sidebar webview provider
 * and starts watching for alignment requests.
 */
export function activate(context: vscode.ExtensionContext): void {
    const formViewProvider = new FormViewProvider(context.extensionUri);

    // Run auto-setup for MCP and GEMINI.md
    runFirstTimeSetup(context);

    // Register the webview view provider for the sidebar
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            FormViewProvider.viewType,
            formViewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    // Register the command to manually show the panel
    context.subscriptions.push(
        vscode.commands.registerCommand("interactiveForms.showPanel", () => {
            vscode.commands.executeCommand("interactiveForms.formView.focus");
        })
    );

    // Register a test command for manual verification
    context.subscriptions.push(
        vscode.commands.registerCommand("interactiveForms.testAlignment", async () => {
            await vscode.commands.executeCommand("interactiveForms.formView.focus");
            await new Promise((resolve) => setTimeout(resolve, 500));

            const testRequest = {
                requestId: `test_${Date.now()}`,
                title: "Implementation approach",
                description: "Clarifying how to proceed with the requested change.",
                fields: [
                    {
                        id: "approach",
                        label: "How should the contact form be implemented?",
                        type: "single-choice" as const,
                        options: [
                            "PHP handler with server-side validation",
                            "Client-side only with email API (e.g. EmailJS)",
                        ],
                        required: true,
                    },
                    {
                        id: "extras",
                        label: "Which extras should be included?",
                        type: "multi-choice" as const,
                        options: [
                            "CSRF protection",
                            "Rate limiting",
                            "Input sanitization",
                        ],
                    },
                    {
                        id: "notes",
                        label: "Anything else to consider?",
                        type: "free-text" as const,
                        placeholder: "Optional details or constraints",
                    },
                ],
            };

            const result = await formViewProvider.showForm(testRequest);
            if (result.dismissed) {
                vscode.window.showInformationMessage("Alignment skipped by user.");
            } else {
                vscode.window.showInformationMessage(
                    `Alignment received: ${JSON.stringify(result.data)}`
                );
            }
        })
    );

    // Start the file-based IPC bridge
    mcpBridge = new McpBridge(formViewProvider);
    mcpBridge.start();
}

/**
 * Extension deactivation. Stops the file watcher.
 */
export function deactivate(): void {
    mcpBridge?.stop();
}

/**
 * Automatically configures the MCP server and GEMINI.md rule on first install.
 */
function runFirstTimeSetup(context: vscode.ExtensionContext): void {
    if (context.globalState.get("setupComplete")) {
        return;
    }

    try {
        const geminiDir = path.join(os.homedir(), ".gemini");
        const antigravityDir = path.join(geminiDir, "antigravity");
        
        if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
        if (!fs.existsSync(antigravityDir)) fs.mkdirSync(antigravityDir, { recursive: true });

        // 1. Configure MCP Server
        const mcpConfigPath = path.join(antigravityDir, "mcp_config.json");
        let mcpConfig: any = { mcpServers: {} };
        
        if (fs.existsSync(mcpConfigPath)) {
            try {
                const raw = fs.readFileSync(mcpConfigPath, "utf-8");
                mcpConfig = JSON.parse(raw);
                if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
            } catch (e) {
                // If it exists but is empty or invalid, overwrite
            }
        }

        const serverPath = path.join(context.extensionPath, "out", "mcp-server", "index.js").replace(/\\/g, "/");
        
        if (!mcpConfig.mcpServers["antigravity-alignment"]) {
            mcpConfig.mcpServers["antigravity-alignment"] = {
                command: "node",
                args: [serverPath]
            };
            fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
        }

        // 2. Configure GEMINI.md
        const geminiMdPath = path.join(geminiDir, "GEMINI.md");
        const alignmentRule = `
## Alignment Rule

Before writing or modifying any file, OR generating complex text-only output (e.g., blog posts, documentation, structured plans), use the \`align_before_edit\` MCP tool when any of the following are true:
- A new feature or page is being built
- An existing file is being changed
- The task is ambiguous or missing detail
- You have a better approach to suggest
- The change has side effects on other parts of the project
- Multiple valid approaches exist

Do not use the tool if the task is fully specified, unambiguous, has no better alternative, and has no side effects.
`;
        
        if (fs.existsSync(geminiMdPath)) {
            const currentContent = fs.readFileSync(geminiMdPath, "utf-8");
            if (!currentContent.includes("align_before_edit")) {
                fs.appendFileSync(geminiMdPath, "\n" + alignmentRule);
            }
        } else {
            fs.writeFileSync(geminiMdPath, "# Agent Instructions\n" + alignmentRule);
        }

        context.globalState.update("setupComplete", true);
        vscode.window.showInformationMessage("Interactive Form Planner for Antigravity: Auto-setup complete. MCP server registered and GEMINI.md updated.");
    } catch (error) {
        console.error("Auto-setup failed:", error);
    }
}
