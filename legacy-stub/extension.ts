import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function cleanupDeadLegacyMcpEntries(extensionId: string): void {
    try {
        const homeDir = os.homedir();
        const candidateConfigs = [
            path.join(homeDir, ".gemini", "antigravity-ide", "mcp_config.json"),
            path.join(homeDir, ".gemini", "antigravity", "mcp_config.json"),
        ];

        for (const configPath of candidateConfigs) {
            if (!fs.existsSync(configPath)) continue;
            try {
                const raw = fs.readFileSync(configPath, "utf-8");
                const config = JSON.parse(raw);
                if (!config?.mcpServers || typeof config.mcpServers !== "object") continue;

                let modified = false;
                for (const key of ["antigravity-planner", "orbit"]) {
                    const entry = config.mcpServers[key];
                    if (entry?.args && Array.isArray(entry.args) && typeof entry.args[0] === "string") {
                        const scriptPath = entry.args[0].toLowerCase();
                        const isThisLegacyExt =
                            scriptPath.includes(extensionId.toLowerCase()) ||
                            scriptPath.includes("antigravity-pre-execution-form-planner") ||
                            scriptPath.includes("antigravity-interactive-form-planner-planning-tool");

                        if (isThisLegacyExt && !fs.existsSync(entry.args[0])) {
                            delete config.mcpServers[key];
                            modified = true;
                        }
                    }
                }

                if (modified) {
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
                }
            } catch {
                // Ignore parse errors on best-effort cleanup
            }
        }
    } catch {
        // Safe best-effort
    }
}

export function activate(context: vscode.ExtensionContext): void {
    // N-04: Clean up dead 0.2.6 MCP entries that point to removed mcp-server bundles
    cleanupDeadLegacyMcpEntries(context.extension.id);

    const actionTakenKey = "orbit.legacyNoticeActionTaken_027";
    if (context.globalState.get(actionTakenKey)) {
        return;
    }

    const lastPromptKey = "orbit.legacyNoticeLastPrompt_027";
    const lastPrompt = context.globalState.get<number>(lastPromptKey, 0);
    const now = Date.now();
    // Throttle reminder: if dismissed without action, re-prompt after 24 hours
    if (now - lastPrompt < 24 * 60 * 60 * 1000) {
        return;
    }
    context.globalState.update(lastPromptKey, now);

    const message = "Orbit: This legacy extension is deprecated and replaced by Orbit.";
    const installOrbit = "Install Orbit";
    const uninstallThis = "Uninstall This Extension";

    vscode.window.showWarningMessage(message, installOrbit, uninstallThis).then(async (selection) => {
        if (selection === installOrbit) {
            context.globalState.update(actionTakenKey, true);
            try {
                await vscode.commands.executeCommand(
                    "workbench.extensions.installExtension",
                    "VNTRCORP.orbit"
                );
                vscode.window.showInformationMessage("Orbit installed successfully.");
            } catch {
                vscode.env.openExternal(
                    vscode.Uri.parse("https://open-vsx.org/extension/VNTRCORP/orbit")
                );
            }
        } else if (selection === uninstallThis) {
            context.globalState.update(actionTakenKey, true);
            cleanupDeadLegacyMcpEntries(context.extension.id);
            await vscode.commands.executeCommand(
                "workbench.extensions.uninstallExtension",
                context.extension.id
            );
        }
    });
}

export function deactivate(): void {
    // Zero background tasks to clean up
}
