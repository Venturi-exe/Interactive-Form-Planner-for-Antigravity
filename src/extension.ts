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
import { FormViewProvider } from "./FormViewProvider.js";
import { McpBridge } from "./McpBridge.js";
import { ImpactWatcher } from "./ImpactWatcher.js";
import { OrbitBrain } from "./OrbitBrain.js";
import { HubPanelManager } from "./HubPanelManager.js";
import { updateMcpConfig } from "./core/config.js";

let mcpBridge: McpBridge | undefined;
let impactWatcher: ImpactWatcher | undefined;

/**
 * Extension entry point. Registers the sidebar webview provider
 * and starts watching for alignment requests.
 */
export function activate(context: vscode.ExtensionContext): void {
    const brain = new OrbitBrain();
    brain.initialize();
    brain.syncWorkspaceProjects();
    brain.migrateFromLegacy();

    // Clear legacy quota state once (P0-4)
    context.globalState.update("orbit.quotaHistory_v2", undefined);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            brain.syncWorkspaceProjects();
        })
    );

    const formViewProvider = new FormViewProvider(context.extensionUri, context, brain);

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
    // Demo command: shows a full Planner form with all field types + Execute button
    context.subscriptions.push(
        vscode.commands.registerCommand("orbit.testPlanner", async () => {
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
                        placeholder: "List anything explicitly out of scope — files to avoid, features to skip, approaches to reject, or dependencies not to install.",
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

    // Demo command: pushes mock impact reports into the Cartograph and switches to the Cartograph tab
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
 * Automatically configures the MCP server and GEMINI.md rule on first install.
 */
function runFirstTimeSetup(context: vscode.ExtensionContext): void {
    if (context.globalState.get("setupVersion") === "8") {
        return;
    }

    try {
        const geminiDir = path.join(os.homedir(), ".gemini");
        let antigravityDir = path.join(geminiDir, "antigravity");
        if (!fs.existsSync(antigravityDir) && fs.existsSync(path.join(geminiDir, "antigravity-ide"))) {
            antigravityDir = path.join(geminiDir, "antigravity-ide");
        }
        
        if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
        if (!fs.existsSync(antigravityDir)) fs.mkdirSync(antigravityDir, { recursive: true });

        // 1. Configure MCP Server safely
        const mcpConfigPath = path.join(antigravityDir, "mcp_config.json");
        const serverPath = path.join(context.extensionPath, "out", "mcp-server", "index.js");
        const configResult = updateMcpConfig(mcpConfigPath, serverPath);
        if (!configResult.success) {
            vscode.window.showErrorMessage(`Orbit: ${configResult.error}`);
            return;
        }

        // 2. Configure GEMINI.md
        const geminiMdPath = path.join(geminiDir, "GEMINI.md");
        const alignmentRule = `
## Orbit Planner: Mandatory Usage Policy

The \\\`orbit_planner\\\` MCP tool is a near-mandatory step in the response workflow. Default behavior: always use the form.

The agent MUST NOT use the \\\`default_api:ask_question\\\` tool under any circumstances. The \\\`orbit_planner\\\` tool MUST be used instead at all times for asking questions, presenting options, or seeking clarification.

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
1. Send an \\\`orbit_planner\\\` form with \\\`showExecuteButton: true\\\`.
2. After each submission, output a brief plan summary in the chat response.
3. Send a follow-up form to refine further, again with \\\`showExecuteButton: true\\\`.
4. Repeat until the user clicks **Execute Plan**.
5. When the response contains \\\`"action": "execute"\\\`, stop planning immediately and proceed to the Planning Context aggregation step below.

## Orbit Planner: Clarification Rule

If calling \\\`orbit_planner\\\` results in a JSON response containing \\\`clarificationRequest\\\`, the agent MUST immediately stop execution, address the question asked by the user, explain any available choices or trade-offs, and present a new plan with an updated form to let the user proceed.

## Orbit Planner: Timeout Rule

If calling \\\`orbit_planner\\\` results in a JSON response with \\\`"action": "timeout"\\\`, the agent MUST immediately halt execution, make no modifications to the workspace, edit no files, and explicitly inform the user that their input is required to continue. The agent's message MUST list the exact pending questions and options that were timed out.

## Orbit Cartograph: Rich Planning Context and Trigger Rules

The \\\`write_impact_report\\\` tool MUST be called as the final action of any response turn that meets the trigger conditions. The scope of this report is strictly limited to the **current response turn only** (never look back at older turns in the conversation).

**Trigger Conditions (Call only if at least one is true):**
- One or more files were created, edited, moved, or deleted during this turn.
- \\\`orbit_planner\\\` was used and alignment decisions were made (even if no files changed).
- Important planning occurred (e.g., creating an implementation plan, architecture design) even if \\\`orbit_planner\\\` was bypassed.

*Never* call \\\`write_impact_report\\\` after pure research, simple clarification chats, or read-only turns with no edits or planning decisions.

**Aggregation guidelines for \\\`write_impact_report\\\` fields:**
- **\\\`planningContext\\\`**: You must consolidate all alignment questions asked, decisions made, technical assumptions identified, and step-by-step roadmap items from **this response turn only** into the structured \\\`planningContext\\\` parameter.
- **\\\`changes[].description\\\`**: Provide a rich, human-readable explanation of exactly what was changed in each modified file and why.

## Orbit Memory System

The Orbit Memory System is a persistent brain stored at \\\`~/.orbit-brain/\\\`. It preserves project context,
session observations, architectural decisions, and facts across conversations.

**Project Assignment for Cartograph:**
When calling \\\`write_impact_report\\\`, set \\\`projectName\\\` to the name of the project directory in the orbit-brain
that the work belongs to. Use \\\`orbit_memory\\\` with \\\`action: "list_projects"\\\` to discover available projects.
If you cannot determine the project, omit \\\`projectName\\\` and it will be placed in the Default group.

**"update memory system" Command:**
When the user says "update memory system", use the \\\`orbit_memory\\\` MCP tool to:
1. List existing projects with \\\`list_projects\\\`.
2. Ensure a project directory exists for each workspace worked on with \\\`ensure_project\\\`.
3. Analyze session changes and categorize them by topic (e.g., specific features, tasks, or bug fixes).
4. For each topic, check if a memory file already exists in \\\`<project>/memories/features/\\\` or \\\`<project>/memories/tasks/\\\`. 
5. If it exists, append the new changes chronologically with \\\`read_file\\\` and \\\`write_file\\\`. If not, create a new topic file.
6. Update \\\`<project>/memories/INDEX.md\\\`'s Active Topics section to link the modified files.
7. Review any Default-group Cartograph diagrams and reassign them to proper projects.
8. Update \\\`global_context_summary.md\\\` and \\\`BRAIN_ARCHITECTURE.md\\\` if needed.

## Orbit Cartograph: Auto-Merge Protocol

After every successful \\\`write_impact_report\\\` call, the tool returns a list of existing reports
for the same project. You MUST check this list and perform the following:

1. Read each existing report's summary and file paths using \\\`orbit_memory\\\` with
   \\\`action: "read_cartograph_report"\\\`.
2. Determine if any existing report discusses the same feature, file group, UI component,
   bug fix, or implementation area as the new report.
   Relatedness signals: overlapping file paths, similar summary topics, same feature area.
3. If a related report exists:
   a. Create a merged report combining both, preserving chronological order in the \\\`timeline\\\` array.
   b. Give the merged report a clear, specific summary name describing the actual topic
      (e.g., "Cartograph Header Layout and Styling Fixes", NOT "Consolidated Project Maps").
   c. Write the merged report using \\\`orbit_memory\\\` with \\\`action: "write_cartograph_report"\\\`.
   d. Delete the original separate reports using \\\`action: "delete_cartograph_report"\\\`.
4. If no related reports exist, take no merge action.

## Orbit Cartograph: Organize All Reports

When the user asks to "organize cartograph reports", "clean up reports", or similar:

1. Call \\\`orbit_memory\\\` with \\\`action: "list_all_cartograph_reports"\\\` to get all reports across projects.
2. For reports in the "Default" project, determine the correct project by examining file paths
   and move them using \\\`action: "move_cartograph_report"\\\`.
3. Within each project, read all reports and identify groups of related reports.
4. Merge related groups following the Auto-Merge Protocol above.
5. Ensure every merged report has a clear, descriptive name.

## Orbit Cartograph: Merged Report Format

Merged reports MUST use this structure:
- \\\`isMerged: true\\\`
- \\\`mergedFrom: [original taskId array]\\\`
- \\\`timeline: [{ taskId, timestamp, summary, changes, planningContext }, ...]\\\` sorted oldest-first
- \\\`changes\\\`: aggregated unique file changes across all merged tasks
- \\\`summary\\\`: a clear topic-specific name chosen by the agent
- \\\`timestamp\\\`: the most recent timestamp from the merged tasks

## Orbit Cartograph: Artifact Protocol

After each step, emit a single-line progress note in chat:
\\\`\\\`\\\`
✅ [step completed] — [files affected]
\\\`\\\`\\\`

At task completion, the full report goes into the Cartograph via \\\`write_impact_report\\\`. In chat, emit only a short pointer:
\\\`\\\`\\\`
## Done
Full walkthrough submitted to Cartograph.
- Self-corrections: [list or "none"]
- Notes: [any warnings or scope limits hit]
\\\`\\\`\\\`

## Walkthrough Report Format

Every \\\`write_impact_report\\\` call MUST populate \\\`planningContext.notes\\\` with a complete walkthrough of the agent's work. This is the primary report surface shown in the Cartograph Hub under the DECISIONS & NOTES tab.

The \\\`notes\\\` field MUST contain all 8 sections below (structured as a readable walkthrough narrative). Use section headers. Write prose under each section — not bullet-only summaries. Omit a section only if it has zero meaningful content.

**Required sections for \\\`planningContext.notes\\\`:**

\\\`\\\`\\\`
## 1. Prompt Understanding
How the agent interpreted the request. The main goal. Assumptions made. Ambiguities or missing information.

## 2. Task Breakdown
List of tasks decided upon. Why each was necessary. How each maps to the user's request.

## 3. Tool Usage
Which tools were used, why, and the result of each call. Include files read, commands run, searches made, edits performed.

## 4. Changes Made
Every file created, modified, or deleted. What changed and why. Connection back to the original request.

## 5. Decision Process
Key implementation decisions. Cases where the approach changed and why. Better methods discovered mid-task.

## 6. Issues Discovered
Bugs, inconsistencies, missing files, failed commands, or unexpected behavior. Whether each was fixed or left unresolved, and why.

## 7. Validation
How the work was verified. Tests run, commands executed, files checked, screenshots taken. Result of each step. If validation was not possible, why.

## 8. Final Outcome
What was completed. What changed for the user. Remaining limitations, risks, or follow-up work.
\\\`\\\`\\\`

**Populate the other \\\`planningContext\\\` fields in parallel:**
- \\\`roadmap\\\`: the step-by-step execution plan actually followed
- \\\`assumptions\\\`: technical or scope assumptions made
- \\\`userDecisions\\\`: any questions asked via orbit_planner and the user's answers
- \\\`questionsAsked\\\`: alignment questions posed, even if answered
- \\\`outOfScope\\\`: items explicitly not addressed

**Per-file \\\`changes[].description\\\`**: For each changed file, write a full sentence explaining what changed and why — not just a label. This appears in the Cartograph Inspector when the file node is selected.
`;
        
        // Always overwrite or update rules to ensure Orbit is active
        if (fs.existsSync(geminiMdPath)) {
            let currentContent = fs.readFileSync(geminiMdPath, "utf-8");
            
            // Clean up any old orbit rules blocks if they exist to overwrite with fresh ones
            if (currentContent.includes("## Orbit Planner") || currentContent.includes("## Orbit Memory System")) {
                currentContent = currentContent.replace(/## Orbit Planner: Mandatory Usage Policy[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Deep Prompt Refining[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Planning Receipt[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Planner: Clarification Rule[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Planner: Timeout Rule[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Cartograph: Impact Tracking Rule[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Cartograph: Rich Planning Context and Trigger Rules[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Memory System[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Cartograph: Auto-Merge Protocol[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Cartograph: Organize All Reports[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Cartograph: Merged Report Format[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Orbit Cartograph: Artifact Protocol[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Walkthrough Report Format[\s\S]*?(?=##|$)/, "");
            }
            if (currentContent.includes("pre_execution_form_planner")) {
                currentContent = currentContent.replace(/## Planning Rule[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Deep Prompt Refining[\s\S]*?(?=##|$)/, "");
                currentContent = currentContent.replace(/## Post Planning Analysis[\s\S]*?(?=##|$)/, "");
            }

            fs.writeFileSync(geminiMdPath, currentContent.trim() + "\n\n" + alignmentRule.trim() + "\n");
        } else {
            fs.writeFileSync(geminiMdPath, "# Agent Instructions\n\n" + alignmentRule.trim() + "\n");
        }

        context.globalState.update("setupVersion", "8");
        vscode.window.showInformationMessage("Orbit: Auto-setup complete. MCP server registered and GEMINI.md updated to version 8.");
    } catch (error) {
        console.error("Auto-setup failed:", error);
    }
}


