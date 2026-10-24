/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 César Vissouze (Venturi-exe / VNTR.CORP)
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";
import { FormViewProvider } from "./FormViewProvider.js";
import { McpBridge } from "./McpBridge.js";
import { ImpactWatcher } from "./ImpactWatcher.js";
import { OrbitBrain } from "./OrbitBrain.js";
import { HubPanelManager } from "./HubPanelManager.js";
import { updateMcpConfig } from "./core/config.js";
import { detectHost } from "./core/host.js";
import { injectOrbitRules, getOrbitRulesTemplate } from "./core/rules.js";
import { writeAtomic } from "./core/fsx.js";
import { runUninstall } from "./uninstall.js";

let mcpBridge: McpBridge | undefined;
let impactWatcher: ImpactWatcher | undefined;

/**
 * Extension entry point. Registers the sidebar webview provider
 * and starts watching for alignment requests.
 */
export function activate(context: vscode.ExtensionContext): void {
    const brain = new OrbitBrain();
    brain.initialize().then(() => {
        brain.syncWorkspaceProjects();
    }).catch((err) => {
        console.error("Orbit brain initialization failed:", err);
    });

    // Clear legacy quota state once (P0-4 / V-17)
    if (!context.globalState.get("orbit.quotaCleared_v3")) {
        context.globalState.update("orbit.quotaHistory_v2", undefined);
        context.globalState.update("orbit.quotaCleared_v3", true);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            brain.syncWorkspaceProjects();
        })
    );

    const formViewProvider = new FormViewProvider(context.extensionUri, context, brain);

    // Sync bundled MCP server to stable storage on every activation (V-04)
    syncMcpServer(context).catch((err) => {
        console.error("Orbit MCP server sync failed:", err);
    });

    // Run auto-setup for MCP and GEMINI.md
    runFirstTimeSetup(context).catch((err) => {
        console.error("Orbit auto-setup failed:", err);
    });

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
        vscode.commands.registerCommand("orbit.showPanel", () => {
            vscode.commands.executeCommand("orbit.formView.focus");
        })
    );

    // Register the command to open the custom Settings page in the main window
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.openSettings", () => {
            formViewProvider.openSettingsPanel(context);
        })
    );

    // Register maximized tab panel commands
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.openMainTab", () => {
            formViewProvider.openMainTab(formViewProvider.activeTab);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.openMainTabPlanner", () => {
            formViewProvider.openMainTab("planner");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.openMainTabCartograph", () => {
            formViewProvider.openMainTab("cartograph");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.openHub", () => {
            HubPanelManager.openHubPanel(context, brain);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.selectReport", (args: { taskId: string; projectName: string }) => {
            formViewProvider.selectReport(args.taskId, args.projectName);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.refreshSidebarData", () => {
            formViewProvider.refreshSidebarData();
        })
    );
    // Demo command: shows a full Planner form with all field types + Execute button (V-15: dev-gated)
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.testPlanner", async () => {
            if (context.extensionMode !== vscode.ExtensionMode.Development) {
                vscode.window.showInformationMessage("Orbit: Demo commands are disabled in production builds.");
                return;
            }
            await vscode.commands.executeCommand("orbit.formView.focus");
            await new Promise((resolve) => setTimeout(resolve, 500));

            const demoRequest = {
                requestId: `demo_${Date.now()}`,
                title: "Orbit Planner v0.2.6: Full Feature Demo",
                description: "Demonstrates every Orbit Planner feature: single-choice, multi-choice, free-text (short + long), the newly updated dark clarify tick box, and the Execute Plan button.",
                showExecuteButton: true,
                fields: [
                    {
                        id: "scope",
                        label: "What is the scope of this implementation?",
                        type: "single-choice" as const,
                        required: true,
                        options: [
                            "Single component fix",
                            "Feature across multiple files",
                            "Full architecture change",
                            "Bug fix + tests",
                        ],
                    },
                    {
                        id: "skills",
                        label: "Which skills should the agent activate?",
                        type: "multi-choice" as const,
                        required: false,
                        options: [
                            "craft-visuals",
                            "accessibility",
                            "performance",
                            "seo",
                            "conversion-optimization",
                        ],
                    },
                    {
                        id: "priority",
                        label: "Priority constraint",
                        type: "free-text" as const,
                        placeholder: "e.g. speed over completeness",
                    },
                    {
                        id: "out_of_scope",
                        label: "What should the agent explicitly NOT do in this task?",
                        type: "free-text" as const,
                        placeholder: "List anything explicitly out of scope - files to avoid, features to skip, approaches to reject, or dependencies not to install.",
                    },
                ],
            };

            const result = await formViewProvider.showForm(demoRequest);
            if (result.dismissed) {
                vscode.window.showInformationMessage("Orbit Demo: Planning skipped by user.");
            } else if ((result as any).executed) {
                vscode.window.showInformationMessage(`Orbit Demo: Execute Plan triggered. Data: ${JSON.stringify(result.data)}`);
            } else {
                vscode.window.showInformationMessage(`Orbit Demo: Alignment received. Data: ${JSON.stringify(result.data)}`);
            }
        })
    );

    // Demo command: pushes mock impact reports into the Cartograph and switches to the Cartograph tab (V-15: dev-gated)
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.testCartograph", async () => {
            if (context.extensionMode !== vscode.ExtensionMode.Development) {
                vscode.window.showInformationMessage("Orbit: Demo commands are disabled in production builds.");
                return;
            }
            const mockReports = [
                {
                    taskId: "demo-ultimate-showcase",
                    sessionId: "session-demo-showcase",
                    summary: "Cartograph: Ultimate Feature Showcase Demo",
                    timestamp: new Date().toISOString(),
                    changes: [
                        {
                            filePath: "src/auth/tokenManager.ts",
                            changeType: "created" as const,
                            promptExcerpt: "Create a resilient authentication token manager",
                            description: "Created tokenManager to handle JWT sliding window updates, state persistence, and automatic session restoration on system restarts.",
                            alignmentToolOutput: {
                                approach: "PKCE flow",
                                expiry: "7d",
                                refreshIntervalMin: 15
                            }
                        },
                        {
                            filePath: "src/webview/form.css",
                            changeType: "edited" as const,
                            promptExcerpt: "Update styling to premium HSL-tailored variables",
                            description: "Refactored CSS declarations to use dynamic theme-aware variables, delivering consistent layout and high-fidelity rendering in both dark and light modes.",
                            alignmentToolOutput: null
                        },
                        {
                            filePath: "src/webview/cartograph.js",
                            changeType: "deleted" as const,
                            promptExcerpt: "Remove legacy monolithic JS bundle",
                            description: "Cleaned up the legacy single-bundle asset after splitting files into modern chunk-split modules, reducing bundle loading overhead by 45%.",
                            alignmentToolOutput: null
                        },
                        {
                            filePath: "src/webview/old-utils.ts",
                            changeType: "moved" as const,
                            promptExcerpt: "Reorganize utility helpers under modern-web module",
                            description: "Relocated file to src/webview/utils/modern-web.ts to maintain proper modular architecture.",
                            alignmentToolOutput: null
                        }
                    ],
                    planningContext: {
                        questionsAsked: [
                            "Q1: Should token expiry be configurable via user settings?",
                            "Q2: Do we support third-party OAuth providers?"
                        ],
                        userDecisions: [
                            {
                                question: "Q1: Should token expiry be configurable via user settings?",
                                answer: "Yes, default to 7 days."
                            },
                            {
                                question: "Q2: Do we support third-party OAuth providers?",
                                answer: "Yes, support GitHub and Google."
                            }
                        ],
                        assumptions: [
                            "VS Code dynamic theme colors are injected at runtime.",
                            "Local storage has sufficient permission for token state persistence."
                        ],
                        roadmap: [
                            "Analyze legacy monolithic assets and draft modular splitting plan",
                            "Scaffold oauth directory structure under auth modules",
                            "Implement tokenManager and PKCE logic",
                            "Validate state persistence using automated unit testing",
                            "Publish output bundle splits and update provider configs"
                        ],
                        outOfScope: [
                            "Refactoring entire extension activation sequence",
                            "Integrating custom database drivers"
                        ],
                        notes: `## 1. Prompt Understanding
The goal is to demonstrate all the features of the Orbit pre-execution planner and impact-tracking Cartograph in a single comprehensive report. We assume the showcase must cover all available JSON properties in the report schema to populate every Inspector panel and node element.

## 2. Task Breakdown
- Design a realistic scenario representing a high-complexity token manager and PKCE oauth integration.
- Ensure all 4 changeTypes (created, edited, deleted, moved) are represented in the changes array.
- Structure full assumptions, roadmap, user decisions, questions, and out of scope details.
- Provide a rich, fully populated 8-section narrative inside the notes tab.

## 3. Tool Usage
- Used write_impact_report to submit this comprehensive showcase.
- Verified rendering behaviors in the React Flow inspector tabs.

## 4. Changes Made
- Created src/auth/tokenManager.ts with custom token handling.
- Edited src/webview/form.css to deliver dynamic styling updates.
- Deleted src/webview/cartograph.js in favor of bundle splits.
- Moved src/webview/old-utils.ts to modern-web subfolder.

## 5. Decision Process
- We selected JWT sliding-window with sliding refreshes over static tokens to maximize security.
- Chose centralizing the settings page instead of using custom popups to preserve native VS Code UI feel.

## 6. Issues Discovered
- Stale token caching on hot restarts caused initial auth mismatches. This was fixed by writing an explicit storage purge on first-time reactivation.

## 7. Validation
- Ran unit test suites under tests/auth/tokenManager.test.ts.
- Verified visual alignment across VS Code's active window layout.

## 8. Final Outcome
- The PKCE auth framework is fully integrated, the user session state is persistently saved, and all telemetry/inspector metrics showcase successfully.`
                    }
                }
            ];

            // Switch to Cartograph tab and open in main tab for best view
            await formViewProvider.openMainTab("cartograph");
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Push the single comprehensive showcase report
            for (const report of mockReports) {
                await formViewProvider.pushTestReport(report);
            }

            vscode.window.showInformationMessage("Orbit Demo: Pushed 1 comprehensive showcase report to Cartograph.");
        })
    );

    // Register setup, repair, and cleanup commands (P6-5 / P6-7)
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.setup", async () => {
            await runFirstTimeSetup(context, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.repair", async () => {
            await syncMcpServer(context);
            await runFirstTimeSetup(context, true);
            vscode.window.showInformationMessage("Orbit: Configuration repaired and MCP server refreshed.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.removeIntegration", async () => {
            const confirm = await vscode.window.showWarningMessage(
                "Remove Orbit MCP server registration and assistant guidelines from ~/.gemini?",
                "Remove",
                "Cancel"
            );
            if (confirm === "Remove") {
                await runUninstall();
                context.globalState.update("setupVersion", undefined);
                context.globalState.update("orbit.setupConsented", undefined);
                vscode.window.showInformationMessage("Orbit: Integration removed from ~/.gemini.");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.copySnippet", async () => {
            const rules = getOrbitRulesTemplate();
            await vscode.env.clipboard.writeText(rules);
            vscode.window.showInformationMessage("Orbit: Assistant guidelines copied to clipboard.");
        })
    );

    // Start the file-based IPC bridge
    mcpBridge = new McpBridge(formViewProvider);
    mcpBridge.start();

    // Start the impact report watcher
    impactWatcher = new ImpactWatcher((report) => {
        formViewProvider.pushImpactReport(report);
    });
    impactWatcher.start();
}

/**
 * Extension deactivation. Stops the file watcher.
 */
export function deactivate(): void {
    mcpBridge?.stop();
    impactWatcher?.stop();
}

/**
 * Synchronizes the bundled MCP server to stable globalStorage directory.
 * Compares SHA-256 hashes to guarantee the installed copy is always up-to-date across updates (V-04).
 */
export async function syncMcpServer(context: vscode.ExtensionContext): Promise<string> {
    const stableDir = path.join(context.globalStorageUri.fsPath, "mcp-server");
    if (!fs.existsSync(stableDir)) {
        await fs.promises.mkdir(stableDir, { recursive: true });
    }
    const sourceServerPath = path.join(context.extensionPath, "out", "mcp-server", "index.js");
    const stableServerPath = path.join(stableDir, "index.js");

    if (fs.existsSync(sourceServerPath)) {
        let shouldCopy = !fs.existsSync(stableServerPath);
        if (!shouldCopy) {
            try {
                const sourceBuf = await fs.promises.readFile(sourceServerPath);
                const stableBuf = await fs.promises.readFile(stableServerPath);
                const sourceHash = crypto.createHash("sha256").update(sourceBuf).digest("hex");
                const stableHash = crypto.createHash("sha256").update(stableBuf).digest("hex");
                if (sourceHash !== stableHash) {
                    shouldCopy = true;
                }
            } catch {
                shouldCopy = true;
            }
        }
        if (shouldCopy) {
            const content = await fs.promises.readFile(sourceServerPath, "utf-8");
            await writeAtomic(stableServerPath, content);
            console.log("[Orbit Setup] Synchronized MCP server bundle to stable storage.");
        }
    }
    return stableServerPath;
}

/**
 * Automatically configures the MCP server and GEMINI.md rules on first install or update.
 */
export async function runFirstTimeSetup(context: vscode.ExtensionContext, force = false): Promise<void> {
    // Always sync server bundle regardless of setupVersion (V-04)
    const stableServerPath = await syncMcpServer(context);

    if (!force && context.globalState.get("setupVersion") === "9") {
        return;
    }

    try {
        // V-02 Remote Session Gate: Skip host setup in remote sessions
        if (vscode.env.remoteName) {
            console.log(`[Orbit Setup] Remote session detected (${vscode.env.remoteName}). Host ~/.gemini setup is skipped.`);
            return;
        }

        const host = detectHost(vscode.env.appName);

        // V-02 Host Gate: Do not configure host GEMINI.md or mcp_config.json in non-Antigravity editors
        if (!host.isAntigravity) {
            console.log(`[Orbit Setup] Non-Antigravity editor detected (${vscode.env.appName || "unknown"}). Skipping auto-setup.`);
            return;
        }

        // V-02 Setup Mode and Consent Gate
        const setupConfig = vscode.workspace.getConfiguration("orbit.setup");
        const setupMode = setupConfig.get<string>("mode", "auto");

        if (!force && setupMode === "off") {
            console.log("[Orbit Setup] Setup mode is configured to 'off'. Skipping auto-setup.");
            return;
        }

        if (!force && setupMode === "ask") {
            const consented = context.globalState.get<boolean>("orbit.setupConsented", false);
            if (!consented) {
                const choice = await vscode.window.showInformationMessage(
                    "Orbit: Register Orbit MCP server and assistant guidelines in ~/.gemini?",
                    "Yes",
                    "Always",
                    "Not Now"
                );
                if (choice === "Always") {
                    await setupConfig.update("mode", "auto", vscode.ConfigurationTarget.Global);
                } else if (choice === "Yes") {
                    await context.globalState.update("orbit.setupConsented", true);
                } else {
                    console.log("[Orbit Setup] User declined or deferred setup.");
                    return;
                }
            }
        }

        // 2. Configure MCP server in host mcp_config.json (P6-3 custom node command)
        if (!fs.existsSync(host.configDir)) {
            await fs.promises.mkdir(host.configDir, { recursive: true });
        }
        const customNodePath = vscode.workspace.getConfiguration("orbit").get<string>("nodePath", "").trim();
        const nodeCommand = customNodePath || "node";

        const configResult = await updateMcpConfig(host.mcpConfigPath, stableServerPath, nodeCommand);
        if (!configResult.success) {
            vscode.window.showErrorMessage(`Orbit: ${configResult.error}`);
            return;
        }

        // 3. Configure GEMINI.md rules with versioned marker boundaries (V-10 / V-12)
        const alignmentRule = getOrbitRulesTemplate();
        await injectOrbitRules(host.geminiMdPath, alignmentRule);

        context.globalState.update("setupVersion", "9");
        vscode.window.showInformationMessage("Orbit: Setup complete. MCP server registered and GEMINI.md updated.");
    } catch (error) {
        console.error("Auto-setup failed:", error);
    }
}



