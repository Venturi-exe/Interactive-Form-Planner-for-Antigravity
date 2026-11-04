/**
 * Orbit Interactive Setup Wizard
 *
 * Provides a guided, user-centric configuration process for Orbit.
 * Allows the user to decide how GEMINI.md guidelines and MCP server
 * configurations are handled, with specialized support for manual/custom prompts.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { detectHost } from "./host.js";
import { updateMcpConfig } from "./config.js";
import {
    injectOrbitRules,
    replaceOrbitRules,
    getOrbitRulesTemplate,
    getOrbitSpecification,
} from "./rules.js";

export type GeminiIntegrationMode = "appended" | "replaced" | "manual" | "skipped";

export interface SetupWizardOptions {
    force?: boolean;
}

/**
 * Runs the interactive setup wizard, prompting the user for decisions.
 */
export async function runSetupWizard(
    context: vscode.ExtensionContext,
    stableServerPath: string,
    options?: SetupWizardOptions
): Promise<boolean> {
    const host = detectHost(vscode.env.appName);

    // Host Gate: Remote or Non-Antigravity check
    if (vscode.env.remoteName) {
        vscode.window.showInformationMessage(
            `Orbit: Remote session detected (${vscode.env.remoteName}). Host setup is skipped.`
        );
        return false;
    }

    if (!host.isAntigravity && !options?.force) {
        vscode.window.showInformationMessage(
            `Orbit: Non-Antigravity editor detected (${vscode.env.appName || "unknown"}). Setup is skipped.`
        );
        return false;
    }

    // --- Step 1: GEMINI.md Guidelines Choice ---
    interface GeminiQuickPickItem extends vscode.QuickPickItem {
        mode: GeminiIntegrationMode;
    }

    const geminiItems: GeminiQuickPickItem[] = [
        {
            label: "$(diff-added) Append Orbit Guidelines to GEMINI.md",
            description: "Recommended for most users",
            detail: "Injects Orbit guidelines between boundary markers, preserving all your existing instructions. Creates a backup file first.",
            mode: "appended",
        },
        {
            label: "$(file-code) Clean Replace GEMINI.md with Orbit Guidelines",
            description: "Fresh start",
            detail: "Creates a timestamped backup of your current GEMINI.md and replaces it with standard Orbit instructions.",
            mode: "replaced",
        },
        {
            label: "$(shield) Manual Integration (Do NOT modify GEMINI.md)",
            description: "Recommended for customized / modular rule sets",
            detail: "Leaves GEMINI.md completely untouched. Provides the technical tool specification so you can integrate requirements yourself.",
            mode: "manual",
        },
        {
            label: "$(circle-slash) Skip Guidelines Configuration",
            description: "Decide later",
            detail: "Do not modify GEMINI.md at this time.",
            mode: "skipped",
        },
    ];

    const chosenGemini = await vscode.window.showQuickPick(geminiItems, {
        title: "Orbit Setup (1/2): Assistant Guidelines (GEMINI.md)",
        placeHolder: "Choose how Orbit should configure assistant guidelines in ~/.gemini/GEMINI.md",
        ignoreFocusOut: true,
    });

    if (!chosenGemini) {
        console.log("[Orbit Setup Wizard] User cancelled at GEMINI.md selection.");
        return false;
    }

    // --- Step 2: MCP Server Registration Choice ---
    interface McpQuickPickItem extends vscode.QuickPickItem {
        action: "auto" | "custom" | "skip";
    }

    const mcpItems: McpQuickPickItem[] = [
        {
            label: "$(server-process) Register Orbit MCP Server in Antigravity",
            description: "Recommended",
            detail: "Registers the Orbit MCP server in mcp_config.json using the default 'node' binary.",
            action: "auto",
        },
        {
            label: "$(gear) Specify Custom Node.js Path",
            description: "Advanced",
            detail: "Provide a specific path to your Node.js executable for running the MCP server.",
            action: "custom",
        },
        {
            label: "$(circle-slash) Skip MCP Server Registration",
            description: "External / Manual proxy",
            detail: "Do not register or update mcp_config.json.",
            action: "skip",
        },
    ];

    const chosenMcp = await vscode.window.showQuickPick(mcpItems, {
        title: "Orbit Setup (2/2): MCP Server Registration",
        placeHolder: "Choose how Orbit should register its Model Context Protocol server",
        ignoreFocusOut: true,
    });

    if (!chosenMcp) {
        console.log("[Orbit Setup Wizard] User cancelled at MCP server selection.");
        return false;
    }

    let nodeCommand = "node";
    if (chosenMcp.action === "custom") {
        const inputPath = await vscode.window.showInputBox({
            title: "Custom Node.js Executable Path",
            prompt: "Enter the absolute path to the Node.js binary (e.g. C:\\Program Files\\nodejs\\node.exe)",
            ignoreFocusOut: true,
            validateInput: (val) => {
                if (!val || val.trim().length === 0) {
                    return "Path cannot be empty";
                }
                return null;
            },
        });
        if (!inputPath) {
            console.log("[Orbit Setup Wizard] User cancelled custom Node path input.");
            return false;
        }
        nodeCommand = inputPath.trim();
        await vscode.workspace.getConfiguration("orbit").update("nodePath", nodeCommand, vscode.ConfigurationTarget.Global);
    }

    // --- Step 3: Execution ---
    try {
        // 1. Configure MCP server if requested
        if (chosenMcp.action !== "skip") {
            if (!fs.existsSync(host.configDir)) {
                await fs.promises.mkdir(host.configDir, { recursive: true });
            }
            const configResult = await updateMcpConfig(host.mcpConfigPath, stableServerPath, nodeCommand);
            if (!configResult.success) {
                vscode.window.showErrorMessage(`Orbit Setup Error: ${configResult.error}`);
                return false;
            }
        }

        // 2. Configure GEMINI.md according to selected mode
        const alignmentRule = getOrbitRulesTemplate();
        if (chosenGemini.mode === "appended") {
            await injectOrbitRules(host.geminiMdPath, alignmentRule);
        } else if (chosenGemini.mode === "replaced") {
            await replaceOrbitRules(host.geminiMdPath, alignmentRule);
        } else if (chosenGemini.mode === "manual") {
            // Explicitly do not touch GEMINI.md
            console.log("[Orbit Setup Wizard] Manual mode selected. GEMINI.md left untouched.");
        }

        // 3. Persist state
        await context.globalState.update("orbit.geminiIntegrationMode", chosenGemini.mode);
        await context.globalState.update("orbit.integrationRemoved", undefined);
        await context.globalState.update("setupVersion", "10");

        // --- Step 4: Post-Setup Guidance ("What Comes After") ---
        await showPostSetupGuidance(chosenGemini.mode);
        return true;
    } catch (err: unknown) {
        console.error("[Orbit Setup Wizard] Execution failed:", err);
        vscode.window.showErrorMessage(`Orbit Setup Failed: ${(err as Error).message}`);
        return false;
    }
}

/**
 * Presents actionable post-setup orientation based on the user's choices.
 */
async function showPostSetupGuidance(mode: GeminiIntegrationMode): Promise<void> {
    if (mode === "manual") {
        const choice = await vscode.window.showInformationMessage(
            "Orbit Setup Complete: MCP server registered. GEMINI.md was left untouched for manual integration.",
            "View Specification",
            "Copy Specification",
            "Open Cartograph Hub"
        );
        if (choice === "View Specification") {
            await displaySpecificationDocument();
        } else if (choice === "Copy Specification") {
            await vscode.env.clipboard.writeText(getOrbitSpecification());
            vscode.window.showInformationMessage("Orbit: Technical specification copied to clipboard.");
        } else if (choice === "Open Cartograph Hub") {
            await vscode.commands.executeCommand("orbit.openHub");
        }
    } else {
        const choice = await vscode.window.showInformationMessage(
            "Orbit Setup Complete: Configuration finished successfully.",
            "Open Cartograph Hub",
            "Open Settings",
            "View Specification"
        );
        if (choice === "Open Cartograph Hub") {
            await vscode.commands.executeCommand("orbit.openHub");
        } else if (choice === "Open Settings") {
            await vscode.commands.executeCommand("orbit.openSettings");
        } else if (choice === "View Specification") {
            await displaySpecificationDocument();
        }
    }
}

/**
 * Opens the technical integration specification in an untitled markdown editor.
 */
export async function displaySpecificationDocument(): Promise<void> {
    const spec = getOrbitSpecification();
    const doc = await vscode.workspace.openTextDocument({
        content: spec,
        language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
}
