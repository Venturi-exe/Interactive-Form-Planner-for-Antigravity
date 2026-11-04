/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 Venturi-exe / VNTRCORP
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
import { detectHost, getStorageOwner } from "./core/host.js";
import { injectOrbitRules, getOrbitRulesTemplate, getOrbitSpecification, removeOrbitRules, ORBIT_START_MARKER } from "./core/rules.js";
import { isSubpath } from "./core/paths.js";
import { writeAtomic } from "./core/fsx.js";
import { runUninstall } from "./uninstall.js";
import { runSetupWizard, displaySpecificationDocument } from "./core/setupWizard.js";
import { runRemovalWizard } from "./core/removalWizard.js";
import * as jsonc from "jsonc-parser";

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

    // Sync bundled MCP server to stable storage and run setup sequentially (N-08)
    syncMcpServer(context)
        .then(() => runFirstTimeSetup(context))
        .catch((err) => {
            console.error("Orbit MCP server sync / auto-setup failed:", err);
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
    // Demo commands: gated strictly to development mode (V-15, N-10)
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        context.subscriptions.push(
            vscode.commands.registerCommand("orbit.testPlanner", async () => {
            await vscode.commands.executeCommand("orbit.formView.focus");
            await new Promise((resolve) => setTimeout(resolve, 500));

            const demoRequest = {
                requestId: `demo_${Date.now()}`,
                title: "Orbit Planner: Full Feature Demo",
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

    // Demo command: pushes mock impact reports into the Cartograph and switches to the Cartograph tab (V-15, N-10)
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.testCartograph", async () => {
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
    }

    // Register setup, repair, and cleanup commands (P6-5 / P6-7 / N-02)
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.setup", async () => {
            await context.globalState.update("orbit.integrationRemoved", undefined);
            const stableServerPath = await syncMcpServer(context);
            await runSetupWizard(context, stableServerPath, { force: true });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.repair", async () => {
            await context.globalState.update("orbit.integrationRemoved", undefined);
            const stableServerPath = await syncMcpServer(context);
            const host = detectHost(vscode.env.appName);
            const customNodePath = vscode.workspace.getConfiguration("orbit").get<string>("nodePath", "").trim();
            const nodeCommand = customNodePath || "node";
            await updateMcpConfig(host.mcpConfigPath, stableServerPath, nodeCommand);
            const mode = context.globalState.get<string>("orbit.geminiIntegrationMode");
            if (mode !== "manual") {
                await injectOrbitRules(host.geminiMdPath, getOrbitRulesTemplate());
            }
            vscode.window.showInformationMessage("Orbit: Configuration repaired and MCP server refreshed.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.removeIntegration", async () => {
            await runRemovalWizard(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.showSpecification", async () => {
            await displaySpecificationDocument();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.copySpecification", async () => {
            const spec = getOrbitSpecification();
            await vscode.env.clipboard.writeText(spec);
            vscode.window.showInformationMessage("Orbit: Integration specification copied to clipboard.");
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

    // N-02: If user explicitly removed integration, respect choice unless forced (orbit.setup)
    if (!force && context.globalState.get<boolean>("orbit.integrationRemoved", false)) {
        console.log("[Orbit Setup] Integration was previously removed by user. Skipping auto-setup.");
        return;
    }

    // V-02 Remote Session Gate: Skip host setup in remote sessions
    if (vscode.env.remoteName) {
        console.log(`[Orbit Setup] Remote session detected (${vscode.env.remoteName}). Host ~/.gemini setup is skipped.`);
        return;
    }

    const host = detectHost(vscode.env.appName);

    // V-02 Host Gate: Do not configure host GEMINI.md or mcp_config.json in non-Antigravity editors
    if (!host.isAntigravity) {
        console.log(`[Orbit Setup] Non-Antigravity editor detected (${vscode.env.appName || "unknown"}). Skipping auto-setup.`);

        // Q7 Cleanup: Check for legacy 0.2.6 registration pointing to this host's globalStorage
        if (!context.globalState.get<boolean>("orbit.q7LegacyChecked", false)) {
            await context.globalState.update("orbit.q7LegacyChecked", true);
            if (fs.existsSync(host.mcpConfigPath)) {
                try {
                    const raw = await fs.promises.readFile(host.mcpConfigPath, "utf-8");
                    const parsed = jsonc.parse(raw);
                    const orbitEntry = parsed?.mcpServers?.orbit || parsed?.mcpServers?.["antigravity-planner"];
                    if (orbitEntry && Array.isArray(orbitEntry.args) && typeof orbitEntry.args[0] === "string") {
                        const arg0 = path.resolve(orbitEntry.args[0]);
                        const storageOwner = getStorageOwner(arg0);
                        const belongsToThisHost = isSubpath(arg0, context.globalStorageUri.fsPath) || storageOwner === "vscode";
                        if (belongsToThisHost) {
                            const cleanupChoice = await vscode.window.showInformationMessage(
                                "Orbit: Detected obsolete Orbit MCP server and assistant guidelines registered in ~/.gemini from a previous installation in this editor. Clean them up?",
                                "Clean Up",
                                "Keep"
                            );
                            if (cleanupChoice === "Clean Up") {
                                await runUninstall({
                                    appName: vscode.env.appName,
                                    globalStoragePath: context.globalStorageUri.fsPath,
                                });

                                // M-04 & M-01: If no Antigravity Orbit server remains in mcp_config.json, clean up GEMINI.md rules
                                let hasAntigravityOrbitServer = false;
                                if (fs.existsSync(host.mcpConfigPath)) {
                                    try {
                                        const checkRaw = await fs.promises.readFile(host.mcpConfigPath, "utf-8");
                                        const checkParsed = jsonc.parse(checkRaw);
                                        for (const k of ["orbit", "antigravity-planner"]) {
                                            const ent = checkParsed?.mcpServers?.[k];
                                            if (ent && Array.isArray(ent.args) && typeof ent.args[0] === "string") {
                                                if (getStorageOwner(ent.args[0]) === "antigravity") {
                                                    hasAntigravityOrbitServer = true;
                                                }
                                            }
                                        }
                                    } catch { /* skip */ }
                                }
                                if (!hasAntigravityOrbitServer && fs.existsSync(host.geminiMdPath)) {
                                    await removeOrbitRules(host.geminiMdPath);
                                }

                                vscode.window.showInformationMessage("Orbit: Legacy server registration and assistant guidelines cleaned up.");
                            }
                        }
                    }
                } catch { /* skip */ }
            }
        }
        return;
    }

    const currentSetupVersion = context.globalState.get<string>("setupVersion");

    // If setupVersion is 10, extension is already configured. Check for broken MCP config with consent.
    if (!force && currentSetupVersion === "10") {
        let serverNeedsRepair = false;
        if (!fs.existsSync(host.mcpConfigPath)) {
            serverNeedsRepair = true;
        } else {
            try {
                const raw = await fs.promises.readFile(host.mcpConfigPath, "utf-8");
                const parsed = jsonc.parse(raw);
                const serverEntry = parsed?.mcpServers?.orbit || parsed?.mcpServers?.["antigravity-planner"];
                if (!serverEntry) {
                    serverNeedsRepair = true;
                } else {
                    const serverScript = serverEntry.args?.[0];
                    if (!serverScript || !fs.existsSync(serverScript)) {
                        serverNeedsRepair = true;
                    }
                }
            } catch {
                serverNeedsRepair = true;
            }
        }

        if (serverNeedsRepair) {
            const repairChoice = await vscode.window.showWarningMessage(
                "Orbit: The Orbit MCP server registration appears to be missing or damaged. Would you like to repair it?",
                "Repair",
                "Ignore"
            );
            if (repairChoice === "Repair") {
                const customNodePath = vscode.workspace.getConfiguration("orbit").get<string>("nodePath", "").trim();
                const nodeCommand = customNodePath || "node";
                await updateMcpConfig(host.mcpConfigPath, stableServerPath, nodeCommand);
                const mode = context.globalState.get<string>("orbit.geminiIntegrationMode");
                if (mode !== "manual") {
                    await injectOrbitRules(host.geminiMdPath, getOrbitRulesTemplate());
                }
                vscode.window.showInformationMessage("Orbit: Restored MCP server registration.");
            }
        }
        return;
    }

    // Setup Mode Gate
    const setupConfig = vscode.workspace.getConfiguration("orbit.setup");
    const setupMode = setupConfig.get<string>("mode", "interactive");

    if (!force && setupMode === "off") {
        console.log("[Orbit Setup] Setup mode is configured to 'off'. Skipping auto-setup.");
        return;
    }

    if (force) {
        await runSetupWizard(context, stableServerPath, { force: true });
        return;
    }

    if (setupMode === "interactive" || setupMode === "ask") {
        const choice = await vscode.window.showInformationMessage(
            "Welcome to Orbit! Would you like to configure Orbit for Antigravity now?",
            "Start Setup Wizard",
            "Manual Setup (Custom Prompt)",
            "Later"
        );
        if (choice === "Start Setup Wizard") {
            await runSetupWizard(context, stableServerPath);
        } else if (choice === "Manual Setup (Custom Prompt)") {
            if (!fs.existsSync(host.configDir)) {
                await fs.promises.mkdir(host.configDir, { recursive: true });
            }
            const customNodePath = vscode.workspace.getConfiguration("orbit").get<string>("nodePath", "").trim();
            const nodeCommand = customNodePath || "node";
            await updateMcpConfig(host.mcpConfigPath, stableServerPath, nodeCommand);
            await context.globalState.update("orbit.geminiIntegrationMode", "manual");
            await context.globalState.update("setupVersion", "10");
            await displaySpecificationDocument();
            vscode.window.showInformationMessage("Orbit: MCP server registered. Opened technical specification for custom integration.");
        } else {
            console.log("[Orbit Setup] User deferred setup.");
        }
        return;
    }

    // setupMode === "auto": Automated headless fallback
    try {
        if (!fs.existsSync(host.configDir)) {
            await fs.promises.mkdir(host.configDir, { recursive: true });
        }
        const customNodePath = vscode.workspace.getConfiguration("orbit").get<string>("nodePath", "").trim();
        const nodeCommand = customNodePath || "node";
        await updateMcpConfig(host.mcpConfigPath, stableServerPath, nodeCommand);

        const mode = context.globalState.get<string>("orbit.geminiIntegrationMode");
        if (mode !== "manual") {
            const alignmentRule = getOrbitRulesTemplate();
            await injectOrbitRules(host.geminiMdPath, alignmentRule);
            await context.globalState.update("orbit.geminiIntegrationMode", "appended");
        }

        context.globalState.update("setupVersion", "10");
        vscode.window.showInformationMessage("Orbit: Setup complete. MCP server registered.");
    } catch (error) {
        console.error("Auto-setup failed:", error);
    }
}



