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
                vscode.window.showInformationMessage("Planning skipped by user.");
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
        
        if (!mcpConfig.mcpServers["antigravity-planner"]) {
            mcpConfig.mcpServers["antigravity-planner"] = {
                command: "node",
                args: [serverPath]
            };
            fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
        }

        // 2. Configure GEMINI.md
        const geminiMdPath = path.join(geminiDir, "GEMINI.md");
        const alignmentRule = `
## Planning Rule (Mandatory Usage Policy)

The \\\`pre_execution_form_planner\\\` MCP tool is a near-mandatory step in the response workflow. Default behavior: always use the form.

**Skip conditions (all must apply to skip):**
- The prompt is fully self-contained with zero ambiguity
- OR the request is a simple factual lookup or research query with no deliverable to produce
- OR the task is a trivial single-operation action (e.g., "rename this variable", "fix this typo")

The burden of proof is on the skip condition, not on the trigger condition. If there is even slight ambiguity, the form must be used.

**Standard triggers (use the form when any are true):**
- A new feature or page is being built
- An existing file is being changed
- The task is ambiguous or missing detail
- You have a better approach to suggest
- The change has side effects on other parts of the project
- Multiple valid approaches exist

## Deep Prompt Refining

When a user prompt contains \\\`@trigger deep prompt refining\\\`, enter an iterative planning loop:
1. Send an \\\`pre_execution_form_planner\\\` form with \\\`showExecuteButton: true\\\`.
2. After each submission, output a brief plan summary in the chat response.
3. Send a follow-up form to refine further, again with \\\`showExecuteButton: true\\\`.
4. Repeat until the user clicks **Execute Plan**.
5. When the response contains \\\`"action": "execute"\\\`, stop planning immediately and proceed to the Post Planning Analysis step below.

## Post Planning Analysis

After every \\\`pre_execution_form_planner\\\` form submission (both standard submit and Execute Plan), generate a structured Markdown artifact **before writing any code or modifying files**:
- File name: \\\`post_planning_analysis_[task-name].md\\\`
- Storage: \\\`[workspace-root]/post_planning_analysis/\\\`
- Required sections:
    - **Questions Asked**: History of the alignment questions.
    - **User Decisions**: The answers provided in the forms.
    - **Assumptions Made**: Technical or scope assumptions identified.
    - **Permissions**: List of files and actions explicitly allowed.
    - **Out of Scope**: Items explicitly excluded.
    - **Execution Roadmap**: High-level summary of the immediate next steps.
    - **Approval Timestamp**: The date and time the plan was finalized.
`;
        
        if (fs.existsSync(geminiMdPath)) {
            const currentContent = fs.readFileSync(geminiMdPath, "utf-8");
            if (!currentContent.includes("pre_execution_form_planner")) {
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


