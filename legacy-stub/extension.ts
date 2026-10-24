import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
    const shownKey = "orbit.legacyNoticeShown_027";
    if (context.globalState.get(shownKey)) {
        return;
    }

    const message = "Orbit: This legacy extension is deprecated and replaced by Orbit.";
    const installOrbit = "Install Orbit";
    const uninstallThis = "Uninstall This Extension";

    vscode.window.showWarningMessage(message, installOrbit, uninstallThis).then(async (selection) => {
        if (selection === installOrbit) {
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
            await vscode.commands.executeCommand(
                "workbench.extensions.uninstallExtension",
                context.extension.id
            );
        }
    });

    context.globalState.update(shownKey, true);
}

export function deactivate(): void {
    // Zero background tasks to clean up
}
