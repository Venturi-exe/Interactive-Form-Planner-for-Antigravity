/**
 * Orbit Interactive Removal Wizard
 *
 * Provides a user-centric removal experience for Orbit.
 * Allows users to choose whether to keep, archive, or purge persistent
 * brain data, restore previous GEMINI.md backups, and clean MCP configuration.
 */
import * as vscode from "vscode";
import { runUninstall } from "../uninstall.js";
import { GeminiIntegrationMode } from "./setupWizard.js";

export async function runRemovalWizard(context: vscode.ExtensionContext): Promise<boolean> {
    const currentMode = context.globalState.get<GeminiIntegrationMode>("orbit.geminiIntegrationMode");

    interface RemovalOption extends vscode.QuickPickItem {
        brainAction: "keep" | "archive" | "delete";
        restoreBackup?: boolean;
    }

    const items: RemovalOption[] = [
        {
            label: "$(trash) Remove Integration (Keep Brain Memories)",
            description: "Recommended",
            detail: "Unregisters the Orbit MCP server and removes rules from GEMINI.md (if injected). Preserves all project memories in ~/.orbit-brain/.",
            brainAction: "keep",
        },
        {
            label: "$(archive) Remove Integration & Archive Brain Data",
            description: "Safe offboarding",
            detail: "Unregisters MCP server, removes rules, and moves ~/.orbit-brain/ to a dated archive directory.",
            brainAction: "archive",
        },
    ];

    if (currentMode === "replaced") {
        items.push({
            label: "$(history) Restore Original GEMINI.md & Remove Server",
            description: "Rollback",
            detail: "Restores your pre-Orbit GEMINI.md backup and unregisters the Orbit MCP server.",
            brainAction: "keep",
            restoreBackup: true,
        });
    }

    items.push({
        label: "$(flame) Complete Purge (Delete Brain Data)",
        description: "Permanent deletion",
        detail: "Unregisters server, cleans rules, and permanently deletes ~/.orbit-brain/.",
        brainAction: "delete",
    });

    const selection = await vscode.window.showQuickPick(items, {
        title: "Orbit: Remove Integration",
        placeHolder: "Select what should be removed",
        ignoreFocusOut: true,
    });

    if (!selection) {
        console.log("[Orbit Removal Wizard] User cancelled removal selection.");
        return false;
    }

    if (selection.brainAction === "delete") {
        const confirm = await vscode.window.showWarningMessage(
            "Are you sure you want to permanently delete ~/.orbit-brain/ and all stored project memories? This cannot be undone.",
            { modal: true },
            "Delete Everything",
            "Cancel"
        );
        if (confirm !== "Delete Everything") {
            return false;
        }
    }

    const res = await runUninstall({
        appName: vscode.env.appName,
        globalStoragePath: context.globalStorageUri.fsPath,
        preserveRules: currentMode === "manual",
        restoreBackup: selection.restoreBackup,
        brainAction: selection.brainAction,
    });

    if (res.success) {
        await context.globalState.update("setupVersion", undefined);
        await context.globalState.update("orbit.setupConsented", undefined);
        await context.globalState.update("orbit.integrationRemoved", true);

        const summaryParts: string[] = [];
        if (res.removedServer) {
            summaryParts.push("MCP server unlisted");
        }
        if (res.restoredBackup) {
            summaryParts.push("GEMINI.md restored from backup");
        } else if (res.removedRules) {
            summaryParts.push("rules removed from GEMINI.md");
        } else if (currentMode === "manual") {
            summaryParts.push("GEMINI.md preserved untouched");
        }
        if (res.brainActionTaken) {
            summaryParts.push(res.brainActionTaken);
        } else {
            summaryParts.push("brain data preserved");
        }

        vscode.window.showInformationMessage(`Orbit: Removal complete (${summaryParts.join(", ")}).`);
        return true;
    } else {
        vscode.window.showErrorMessage(`Orbit: Failed to complete removal (${res.reason || "unknown error"}).`);
        return false;
    }
}
