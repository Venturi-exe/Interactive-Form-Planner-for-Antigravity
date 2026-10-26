/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 Venturi-exe / VNTR.CORP
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { AlignmentFormRequest, FormResult } from "./types.js";
import { FormWebviewMessageSchema } from "./core/schemas.js";
import { OrbitBrain } from "./OrbitBrain.js";
import { HubPanelManager } from "./HubPanelManager.js";

/**
 * Provides the sidebar webview panel for rendering planning forms.
 * Handles bidirectional messaging between the extension host and the webview.
 */
export class FormViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "orbit.formView";

    private _view?: vscode.WebviewView;
    private _pendingResolver?: (result: FormResult) => void;
    private _panels: Array<{ panel: vscode.WebviewPanel; viewMode: "combined" | "planner" | "cartograph" }> = [];
    private _activeTab: "planner" | "cartograph" = "planner";
    private _activeRequest?: AlignmentFormRequest;
    private _sessionReports: any[] = [];
    private _pendingSelectTaskId?: string;

    private static _configChangeCallbacks: Array<() => void> = [];

    public static onConfigChange(callback: () => void): void {
        FormViewProvider._configChangeCallbacks.push(callback);
    }

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _orbitBrain?: OrbitBrain
    ) {}

    public get activeTab(): "planner" | "cartograph" {
        return this._activeTab;
    }

    /**
     * Called by VS Code when the webview becomes visible.
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, "combined", false);

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            this._handleWebviewMessage(message);
        });

        // Watch for workspace configuration changes to notify the webview (only if not overridden by globalState settings)
        const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("orbit.inactivityTimeout") || e.affectsConfiguration("orbit.countdownWarningThreshold")) {
                const settings = this._context.globalState.get<any>("orbit.settings", {});
                const updatedConfig = vscode.workspace.getConfiguration("orbit");
                const newTimeout = settings.inactivityTimeout ?? updatedConfig.get<number>("inactivityTimeout", 5);
                const newWarning = settings.countdownWarningThreshold ?? updatedConfig.get<number>("countdownWarningThreshold", 60);
                
                const updateMsg = {
                    type: "config_updated",
                    config: {
                        inactivityTimeout: newTimeout,
                        countdownWarningThreshold: newWarning
                    }
                };

                webviewView.webview.postMessage(updateMsg);
                for (const { panel } of this._panels) {
                    panel.webview.postMessage(updateMsg);
                }
            }
        });

        webviewView.onDidDispose(() => {
            configDisposable.dispose();
        });
    }

    /**
     * Unified handler for bidirectional messages from any active webview (sidebar or panel).
     */
    private async _handleWebviewMessage(rawMessage: unknown, sourcePanel?: vscode.WebviewPanel): Promise<void> {
        const parsed = FormWebviewMessageSchema.safeParse(rawMessage);
        if (!parsed.success) {
            console.warn("[FormViewProvider] Ignored invalid webview message:", parsed.error);
            return;
        }
        const message = parsed.data;

        if (message.type === "webview_ready") {
            const targetWebview = sourcePanel ? sourcePanel.webview : this._view?.webview;
            targetWebview?.postMessage({
                type: "load_history",
                reports: this._sessionReports
            });

            if (this._pendingSelectTaskId) {
                const selectMsg = { type: "select_report", taskId: this._pendingSelectTaskId };
                targetWebview?.postMessage(selectMsg);
                const cartographOpenInPanel = this._panels.some(
                    ({ viewMode }) => viewMode === "cartograph" || viewMode === "combined"
                );
                if (!cartographOpenInPanel) {
                    targetWebview?.postMessage({ type: "switch_tab", tab: "cartograph" });
                }
                this._pendingSelectTaskId = undefined;
            }

            // Re-send active request if present to recover from reloading or toggling
            if (this._activeRequest) {
                const renderMsg = {
                    type: "render_form",
                    requestId: this._activeRequest.requestId,
                    title: this._activeRequest.title,
                    description: this._activeRequest.description ?? "",
                    fields: this._activeRequest.fields,
                    showExecuteButton: this._activeRequest.showExecuteButton ?? false,
                };
                targetWebview?.postMessage(renderMsg);
                if (!sourcePanel) {
                    targetWebview?.postMessage({ type: "switch_tab", tab: "planner" });
                }
            }
            return;
        }

        if (message.type === "restore_sidebar") {
            vscode.commands.executeCommand("workbench.view.extension.orbit-container");
            if (sourcePanel) {
                sourcePanel.dispose();
            }
            return;
        }

        if (message.type === "open_hub") {
            HubPanelManager.openHubPanel(this._context, this._orbitBrain!);
            return;
        }

        if (message.type === "tab_changed") {
            this._activeTab = message.tab === "cartograph" ? "cartograph" : "planner";
            return;
        }

        if (message.type === "close_report") {
            const taskId = message.taskId;
            this._sessionReports = this._sessionReports.filter(r => r.taskId !== taskId);
            const refreshMsg = {
                type: "load_history",
                reports: this._sessionReports
            };
            this._view?.webview.postMessage(refreshMsg);
            for (const { panel } of this._panels) {
                panel.webview.postMessage(refreshMsg);
            }
            return;
        }

        if (message.type === "delete_report") {
            this._handleDeleteReport(message.taskId, message.sessionId, message.projectName);
            return;
        }

        if (message.type === "interaction_reset") {
            const resetMsg = { type: "reset_timer" };
            this._view?.webview.postMessage(resetMsg);
            for (const { panel } of this._panels) {
                panel.webview.postMessage(resetMsg);
            }
            return;
        }

        if (message.type === "open_file") {
            const filePath = message.filePath;
            const projectName = message.projectName;
            if (filePath) {
                this._openFileInWorkspace(filePath, projectName);
            }
            return;
        }

        if (message.type === "open_receipt") {
            const projectName = message.projectName || "Default";
            const taskId = message.taskId;
            this._openPlanningReceipt(projectName, taskId);
            return;
        }

        if (message.type === "open_walkthrough") {
            const projectName = message.projectName || "Default";
            const taskId = message.taskId;
            this._openTaskWalkthrough(projectName, taskId);
            return;
        }

        if (!this._pendingResolver) return;
        
        if (message.type === "form_timeout") {
            this._pendingResolver({ action: "timeout", dismissed: true, data: {} });
            this._pendingResolver = undefined;
            this._broadcastDismiss();
        } else if (message.type === "form_clarification") {
            this._pendingResolver({
                action: "clarification",
                dismissed: false,
                data: {},
                clarificationRequest: message.question,
            });
            this._pendingResolver = undefined;
            this._broadcastDismiss();
        } else if (message.type === "form_submitted") {
            const action = message.action || "submit";
            this._pendingResolver({
                action,
                dismissed: false,
                data: message.data,
                clarificationRequest: message.clarificationRequest,
            });
            this._pendingResolver = undefined;
            this._broadcastDismiss();
        } else if (message.type === "form_executed") {
            this._pendingResolver({ action: "execute", dismissed: false, data: message.data });
            this._pendingResolver = undefined;
            this._broadcastDismiss();
        } else if (message.type === "form_dismissed") {
            this._pendingResolver({ action: "dismiss", dismissed: true, data: {} });
            this._pendingResolver = undefined;
            this._broadcastDismiss();
        }
    }

    /**
     * Broadcasts a reset message to all active webviews once a form is processed.
     */
    private _broadcastDismiss(): void {
        const resetMsg = { type: "reset_form" };
        this._view?.webview.postMessage(resetMsg);
        for (const { panel } of this._panels) {
            panel.webview.postMessage(resetMsg);
        }
    }

    /**
     * Opens a file in the active VS Code workspace editor.
     */
    private async _openFileInWorkspace(relativePath: string, projectName?: string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;
        
        let fullPath = path.isAbsolute(relativePath) ? relativePath : "";
        if (!fullPath) {
            for (const folder of workspaceFolders) {
                if (projectName) {
                    const projectPath = path.join(folder.uri.fsPath, projectName, relativePath);
                    if (fs.existsSync(projectPath)) {
                        fullPath = projectPath;
                        break;
                    }
                }

                const testPath = path.join(folder.uri.fsPath, relativePath);
                if (fs.existsSync(testPath)) {
                    fullPath = testPath;
                    break;
                }
            }
        }
        
        if (!fullPath) {
            if (projectName) {
                fullPath = path.join(workspaceFolders[0].uri.fsPath, projectName, relativePath);
            } else {
                fullPath = path.join(workspaceFolders[0].uri.fsPath, relativePath);
            }
        }
        
        try {
            const uri = vscode.Uri.file(fullPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open file: ${relativePath}. ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Searches the local brain directories for a matching planning receipt file and opens it in VS Code.
     */
    private async _openPlanningReceipt(projectName: string, taskId: string): Promise<void> {
        const homeDir = os.homedir();
        const orbitBrainDir = process.env.ORBIT_BRAIN_DIR || path.join(homeDir, ".orbit-brain");
        
        const locations = [
            path.join(orbitBrainDir, projectName),
            path.join(orbitBrainDir, "projects", projectName),
        ];

        let matchedFile: string | null = null;
        for (const loc of locations) {
            if (fs.existsSync(loc)) {
                try {
                    const files = fs.readdirSync(loc);
                    const match = files.find(f => 
                        f.toLowerCase().startsWith("planning_receipt") && 
                        f.toLowerCase().includes(taskId.toLowerCase())
                    );
                    if (match) {
                        matchedFile = path.join(loc, match);
                        break;
                    }
                } catch {
                    /* ignore directory read error */
                }
            }
        }

        if (matchedFile) {
            try {
                const uri = vscode.Uri.file(matchedFile);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open receipt: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            vscode.window.showInformationMessage(`Could not find a planning receipt for task ${taskId} in the Orbit-Brain.`);
        }
    }

    /**
     * Searches the local brain/antigravity directories for a matching walkthrough.md file and opens it in VS Code.
     */
    private async _openTaskWalkthrough(projectName: string, taskId: string): Promise<void> {
        const homeDir = os.homedir();
        const geminiBrainDir = path.join(homeDir, ".gemini", "antigravity-ide", "brain");

        let matchedFile: string | null = null;

        // 1. Direct match with taskId (in case taskId is the conversation ID)
        const directPath = path.join(geminiBrainDir, taskId, "walkthrough.md");
        if (fs.existsSync(directPath)) {
            matchedFile = directPath;
        }

        // 2. Scan all subdirectories to find the most recently modified walkthrough.md file (falls back to active session)
        if (!matchedFile && fs.existsSync(geminiBrainDir)) {
            try {
                const subdirs = fs.readdirSync(geminiBrainDir).filter(f => {
                    const full = path.join(geminiBrainDir, f);
                    return fs.statSync(full).isDirectory() && f !== "tempmediaStorage";
                });

                let newestFile: string | null = null;
                let newestMtime = 0;

                for (const dir of subdirs) {
                    const testPath = path.join(geminiBrainDir, dir, "walkthrough.md");
                    if (fs.existsSync(testPath)) {
                        const mtime = fs.statSync(testPath).mtimeMs;
                        if (mtime > newestMtime) {
                            newestMtime = mtime;
                            newestFile = testPath;
                        }
                    }
                }

                if (newestFile) {
                    matchedFile = newestFile;
                }
            } catch (e) {
                console.error("Failed to search conversation walkthroughs:", e);
            }
        }

        if (matchedFile) {
            try {
                const uri = vscode.Uri.file(matchedFile);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open walkthrough: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            vscode.window.showInformationMessage(`Could not find a walkthrough report for task ${taskId} in the Brain.`);
        }
    }

    /**
     * Renders a form in the webview and waits for the user to submit or dismiss.
     */
    public async showForm(request: AlignmentFormRequest): Promise<FormResult> {
        this._activeRequest = request;
        if (this._view) {
            this._view.show?.(true);
        }

        return new Promise<FormResult>((resolve) => {
            this._pendingResolver = (result) => {
                this._activeRequest = undefined;
                resolve(result);
            };

            const renderMsg = {
                type: "render_form",
                requestId: request.requestId,
                title: request.title,
                description: request.description ?? "",
                fields: request.fields,
                showExecuteButton: request.showExecuteButton ?? false,
            };

            const plannerOpenInPanel = this._panels.some(
                ({ viewMode }) => viewMode === "planner" || viewMode === "combined"
            );

            this._view?.webview.postMessage(renderMsg);
            if (this._view && !plannerOpenInPanel) {
                this._view.webview.postMessage({ type: "switch_tab", tab: "planner" });
            }

            for (const { panel } of this._panels) {
                panel.webview.postMessage(renderMsg);
            }
        });
    }

    /**
     * Commits a new impact report to both globalState and the filesystem backup store,
     * and broadcasts it to the active webview panel.
     */
    public async pushImpactReport(report: any): Promise<void> {
        // Exclude duplicate task ids from session history
        this._sessionReports = this._sessionReports.filter((r) => r.taskId !== report.taskId);
        
        // Prepend new report to session history
        this._sessionReports.unshift(report);
        
        const cartographOpenInPanel = this._panels.some(
            ({ viewMode }) => viewMode === "cartograph" || viewMode === "combined"
        );

        // Broadcast to active webview view
        if (this._view) {
            this._view.webview.postMessage({
                type: "new_report",
                report: report,
            });
            if (!cartographOpenInPanel) {
                this._view.webview.postMessage({
                    type: "switch_tab",
                    tab: "cartograph",
                });
            }
        }

        // Broadcast to all active editor panels
        for (const { panel } of this._panels) {
            panel.webview.postMessage({
                type: "new_report",
                report: report,
            });
        }
        
        // Write persistently inside Orbit Brain per-project cartograph
        if (this._orbitBrain) {
            try {
                this._orbitBrain.writeCartographReport(report.projectName || "Default", report);
            } catch (err) {
                console.error("Failed to write to orbit-brain cartograph storage:", err);
            }
        }
    }

    /**
     * Broadcasts a test impact report to the active webviews only,
     * without any filesystem or globalState persistence.
     */
    public async pushTestReport(report: any): Promise<void> {
        // Add to session reports for active previewing
        this._sessionReports = this._sessionReports.filter((r) => r.taskId !== report.taskId);
        this._sessionReports.unshift(report);

        const displayMsg = { type: "new_report", report };
        const cartographOpenInPanel = this._panels.some(
            ({ viewMode }) => viewMode === "cartograph" || viewMode === "combined"
        );
        if (this._view) {
            this._view.webview.postMessage(displayMsg);
            if (!cartographOpenInPanel) {
                this._view.webview.postMessage({
                    type: "switch_tab",
                    tab: "cartograph",
                });
            }
        }
        for (const { panel } of this._panels) {
            panel.webview.postMessage(displayMsg);
        }
    }

    /**
     * Selects and focuses a specific report in the sidebar and multi-tab panel webviews.
     * If the report is not in the current session list, we load it from disk to inject it.
     */
    public selectReport(taskId: string, projectName?: string): void {
        const existing = this._sessionReports.find(r => r.taskId === taskId);
        if (!existing && projectName && this._orbitBrain) {
            try {
                const reports = this._orbitBrain.listCartographReports(projectName);
                const found = reports.find(r => r.report.taskId === taskId);
                if (found) {
                    found.report.projectName = projectName;
                    found.report.filename = found.filename;
                    
                    // Inject into session reports
                    this._sessionReports = this._sessionReports.filter((r) => r.taskId !== taskId);
                    this._sessionReports.unshift(found.report);

                    const refreshMsg = {
                        type: "load_history",
                        reports: this._sessionReports
                    };

                    this._view?.webview.postMessage(refreshMsg);
                    for (const { panel } of this._panels) {
                        panel.webview.postMessage(refreshMsg);
                    }
                }
            } catch (err) {
                console.error("Failed to load historical report from disk:", err);
            }
        }

        this._pendingSelectTaskId = taskId;

        const selectMsg = { type: "select_report", taskId };
        const cartographOpenInPanel = this._panels.some(
            ({ viewMode }) => viewMode === "cartograph" || viewMode === "combined"
        );
        
        if (this._view) {
            this._view.webview.postMessage(selectMsg);
            if (!cartographOpenInPanel) {
                this._view.webview.postMessage({ type: "switch_tab", tab: "cartograph" });
            }
        }
        for (const { panel } of this._panels) {
            panel.webview.postMessage(selectMsg);
        }
    }

    /**
     * Reloads all project reports from the orbit-brain storage and refreshes all webview selectors.
     */
    public async refreshSidebarData(): Promise<void> {
        // No-op or we can update this._sessionReports with newly-written reports if needed.
        // Let's broadcast the current session reports to refresh the selectors.
        const refreshMsg = {
            type: "load_history",
            reports: this._sessionReports
        };

        if (this._view) {
            this._view.webview.postMessage(refreshMsg);
        }
        for (const { panel } of this._panels) {
            panel.webview.postMessage(refreshMsg);
        }
    }

    /**
     * Generates the full HTML document for the webview.
     */
    private _getHtmlForWebview(
        webview: vscode.Webview,
        viewMode: "combined" | "planner" | "cartograph" = "combined",
        isPanel: boolean = false
    ): string {
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "form.css")
        );
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "form.js")
        );
        const cytoscapeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "vendor", "cytoscape.min.js")
        );
        const cartographUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "cartograph.js")
        );
        const cartographCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "cartograph.css")
        );

        const nonce = getNonce();
        const settings = this._context.globalState.get<any>("orbit.settings", {});
        const config = vscode.workspace.getConfiguration("orbit");
        const timeoutMinutes = settings.inactivityTimeout ?? config.get<number>("inactivityTimeout", 5);
        const warningSeconds = settings.countdownWarningThreshold ?? config.get<number>("countdownWarningThreshold", 60);
        const zoomSensitivity = settings.zoomSensitivity ?? 0.15;
        const detailPanelHeight = settings.detailPanelHeight ?? 160;

        const tabPlannerClass = viewMode === "cartograph" ? "tab-panel" : "tab-panel active";
        const tabCartographClass = viewMode === "cartograph" ? "tab-panel active" : "tab-panel";
        const tabBarDisplay = viewMode === "combined" ? "" : "display: none;";

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   img-src ${webview.cspSource} data:;
                   script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}">
    <link rel="stylesheet" href="${cartographCssUri}">
    <title>Interactive Planner</title>
</head>
<body class="${isPanel ? "is-panel" : ""}">
    ${isPanel ? `
    <button id="btn-restore-sidebar" class="restore-btn" title="Restore to Sidebar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 14h6v6m10-10h-6V4M4 20l6-6m10-10l-6 6"/>
        </svg>
    </button>
    ` : ""}

    <div class="tab-bar" style="${tabBarDisplay}">
        <button class="tab-btn ${viewMode === "cartograph" ? "" : "active"}" id="tab-btn-planner">Planner</button>
        <button class="tab-btn ${viewMode === "cartograph" ? "active" : ""}" id="tab-btn-cartograph">Cartograph</button>
    </div>

    <div id="timeout-warning"></div>

    <div id="tab-planner" class="${tabPlannerClass}">
        <div id="form-container">
            <div id="empty-state">
                <div class="empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9 12l2 2 4-4"/>
                        <rect x="3" y="3" width="18" height="18" rx="3"/>
                    </svg>
                </div>
                <p class="empty-title">Waiting for input</p>
                <p class="empty-description">The agent will ask before making changes.</p>
                <button id="btn-empty-state-reload" class="empty-state-reload-btn" title="Check for Active Form">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M23 4v6h-6M1 20v-6h6"/>
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                    </svg>
                    Refresh
                </button>
            </div>
            <div id="form-content" style="display: none;"></div>
        </div>
    </div>

    <div id="tab-cartograph" class="${tabCartographClass}">
        <div class="cartograph-header">
            <div class="selector-container">
                <label for="report-selector">Active Report:</label>
                <select id="report-selector">
                    <option value="">No impact reports stored</option>
                </select>
            </div>
            <div class="toolbar-actions">
                <button id="btn-merge-reports" class="toolbar-btn" title="Merge Session Diagrams" style="display: none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="18" cy="18" r="3"/>
                        <circle cx="6" cy="6" r="3"/>
                        <circle cx="6" cy="18" r="3"/>
                        <path d="M6 9v6M21 15v-3a4 4 0 00-4-4H9"/>
                    </svg>
                <button id="btn-close-report" class="toolbar-btn" title="Close Diagram" style="display: none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <button id="btn-delete-report" class="toolbar-btn danger-hover" title="Delete Diagram" style="display: none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
        <div id="cartograph-canvas">
            <div id="canvas-empty-state" class="empty-state-cartograph">
                <div class="empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2l6 3 6-3v10.5M9 2v18M15 5v5"/>
                        <circle cx="18" cy="18" r="3"/>
                        <path d="M20 20l2 2"/>
                    </svg>
                </div>
                <p class="empty-title">No Map Generated</p>
                <p class="empty-description">Visual representation of file impact changes will appear here after execution.</p>
            </div>
        </div>
        <div id="cartograph-detail" class="detail-panel">
            <div class="detail-placeholder">Select a node in the graph to view file change parameters</div>
            <div class="detail-content" style="display: none;">
                <div class="detail-header">
                    <span id="detail-file-name" class="detail-title"></span>
                    <span id="detail-change-type" class="badge"></span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">File Path:</span>
                    <span id="detail-file-path" class="detail-value"></span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Authorized Instruction:</span>
                    <div id="detail-excerpt" class="detail-block"></div>
                </div>
                <div id="detail-tool-output-container" class="detail-row" style="display: none;">
                    <span class="detail-label">Planner Alignment Choices:</span>
                    <pre id="detail-tool-output" class="detail-block code-block"></pre>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        window.orbitConfig = {
            inactivityTimeout: ${timeoutMinutes},
            countdownWarningThreshold: ${warningSeconds},
            viewMode: "${viewMode}",
            zoomSensitivity: ${zoomSensitivity},
            detailPanelHeight: ${detailPanelHeight}
        };
    </script>
    <script nonce="${nonce}" src="${cytoscapeUri}"></script>
    <script nonce="${nonce}" src="${jsUri}"></script>
    <script nonce="${nonce}" src="${cartographUri}"></script>
</body>
</html>`;
    }

    /**
     * Opens a maximized Orbit editor panel in the main window column.
     */
    public openMainTab(viewMode: "combined" | "planner" | "cartograph" = "combined"): void {
        const title = viewMode === "planner" ? "Orbit Planner" :
                      viewMode === "cartograph" ? "Orbit Cartograph" :
                      "Orbit";

        const panel = vscode.window.createWebviewPanel(
            "orbit.mainTab",
            title,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri],
            }
        );

        const iconFile = viewMode === "planner" ? "tab-planner.png" : "tab-cartograph.png";
        panel.iconPath = vscode.Uri.joinPath(this._extensionUri, "assets", iconFile);

        const panelInfo = { panel, viewMode };
        this._panels.push(panelInfo);

        panel.webview.html = this._getHtmlForWebview(panel.webview, viewMode, true);

        // Listen for messages from the editor panel
        panel.webview.onDidReceiveMessage((message) => {
            this._handleWebviewMessage(message, panel);
        });

        // Clean up when panel is disposed
        panel.onDidDispose(() => {
            this._panels = this._panels.filter(p => p.panel !== panel);
        });

        // switch active tab in the sidebar view to focus the remaining tab
        if (this._view) {
            if (viewMode === "planner") {
                this._view.webview.postMessage({ type: "switch_tab", tab: "cartograph" });
            } else if (viewMode === "cartograph") {
                this._view.webview.postMessage({ type: "switch_tab", tab: "planner" });
            }
        }
    }

    /**
     * Handles the deletion of a specific report or an entire session from history and filesystem.
     */
    private async _handleDeleteReport(taskId?: string, sessionId?: string, projectName?: string): Promise<void> {
        const targetType = projectName ? "project group" : (sessionId ? "session" : "task diagram");
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to permanently delete this ${targetType} and its history?`,
            { modal: true },
            "Delete",
            "Cancel"
        );

        if (confirm !== "Delete") {
            return;
        }

        let history = this._context.globalState.get<any[]>("orbit.impactHistory", []);
        const toDelete: any[] = [];

        if (projectName) {
            history.forEach(r => {
                const key = r.projectName ?? 'default';
                if (key === projectName) {
                    toDelete.push(r);
                }
            });
            history = history.filter(r => (r.projectName ?? 'default') !== projectName);
            this._sessionReports = this._sessionReports.filter(r => (r.projectName ?? 'default') !== projectName);
        } else if (sessionId) {
            history.forEach(r => {
                if (r.sessionId === sessionId) {
                    toDelete.push(r);
                }
            });
            history = history.filter(r => r.sessionId !== sessionId);
            this._sessionReports = this._sessionReports.filter(r => r.sessionId !== sessionId);
        } else if (taskId) {
            history.forEach(r => {
                if (r.taskId === taskId) {
                    toDelete.push(r);
                }
            });
            history = history.filter(r => r.taskId !== taskId);
            this._sessionReports = this._sessionReports.filter(r => r.taskId !== taskId);
        }

        // Update globalState
        await this._context.globalState.update("orbit.impactHistory", history);

        // Delete from filesystem in orbit-brain
        if (this._orbitBrain) {
            try {
                for (const r of toDelete) {
                    const projName = r.projectName || "Default";
                    const safeTaskId = r.taskId.replace(/[^a-zA-Z0-9\-_]/g, "_");
                    const safeTimestamp = r.timestamp.replace(/[^a-zA-Z0-9\-_]/g, "_");
                    const filename = `${safeTaskId}_${safeTimestamp}.json`;
                    this._orbitBrain.deleteCartographReport(projName, filename);
                }
            } catch (err) {
                console.error("Failed to delete orbit-brain history files:", err);
            }
        }

        // Broadcast load_history with _sessionReports to refresh all webviews
        const refreshMsg = {
            type: "load_history",
            reports: this._sessionReports
        };

        if (this._view) {
            this._view.webview.postMessage(refreshMsg);
        }
        for (const { panel } of this._panels) {
            panel.webview.postMessage(refreshMsg);
        }

        // Notify Hub panel
        HubPanelManager.broadcastRefresh();

        vscode.window.showInformationMessage(`Orbit ${targetType} deleted successfully.`);
    }

    /**
     * Opens a standalone custom Settings editor page in the main window column.
     */
    public openSettingsPanel(context: vscode.ExtensionContext): void {
        const panel = vscode.window.createWebviewPanel(
            "orbit.settingsView",
            "Orbit Settings",
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri],
            }
        );

        panel.iconPath = vscode.Uri.joinPath(this._extensionUri, "assets", "tab-settings.png");

        panel.webview.html = this._getHtmlForSettings(panel.webview, context);

        // Listen for messages from the settings page
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === "update_setting") {
                const settings = context.globalState.get<any>("orbit.settings", {});
                settings[message.key] = message.value;
                await context.globalState.update("orbit.settings", settings);

                const updateMsg = {
                    type: "config_updated",
                    config: {
                        inactivityTimeout: settings.inactivityTimeout ?? 5,
                        countdownWarningThreshold: settings.countdownWarningThreshold ?? 60,
                        zoomSensitivity: settings.zoomSensitivity ?? 0.15,
                        detailPanelHeight: settings.detailPanelHeight ?? 160,
                        quotaRefreshRate: settings.quotaRefreshRate ?? 90,
                        quotaWarningThreshold: settings.quotaWarningThreshold ?? 40,
                        quotaCriticalThreshold: settings.quotaCriticalThreshold ?? 20,
                        quotaGaugeStyle: settings.quotaGaugeStyle ?? "circular-segmented",
                        quotaHistoryRangeDays: settings.quotaHistoryRangeDays ?? 7
                    }
                };

                // Broadcast configuration update to sidebar and panels
                if (this._view) {
                    this._view.webview.postMessage(updateMsg);
                }

                for (const { panel } of this._panels) {
                    panel.webview.postMessage(updateMsg);
                }

                // Notify custom config change listeners
                FormViewProvider._configChangeCallbacks.forEach(cb => cb());
            } else if (message.type === "clear_history") {
                const confirm = await vscode.window.showWarningMessage(
                    "Are you sure you want to permanently delete all stored impact history and backups?",
                    { modal: true },
                    "Delete",
                    "Cancel"
                );

                if (confirm === "Delete") {
                    // Purge state
                    await context.globalState.update("orbit.impactHistory", undefined);

                    // Clear files in directory in orbit-brain
                    if (this._orbitBrain) {
                        try {
                            const projects = this._orbitBrain.listProjects();
                            if (!projects.includes("Default")) {
                                projects.push("Default");
                            }
                            for (const proj of projects) {
                                const reports = this._orbitBrain.listCartographReports(proj);
                                for (const r of reports) {
                                    this._orbitBrain.deleteCartographReport(proj, r.filename);
                                }
                            }
                        } catch (err) {
                            console.error("Failed to clear orbit-brain history files:", err);
                        }
                    }

                    // Reload active sidebar cartograph dropdown
                    if (this._view) {
                        this._view.webview.postMessage({
                            type: "load_history",
                            reports: []
                        });
                    }

                    // Reload all active editor panel dropdowns
                    for (const { panel: p } of this._panels) {
                        p.webview.postMessage({
                            type: "load_history",
                            reports: []
                        });
                    }

                    // Notify Settings UI that history is cleared
                    panel.webview.postMessage({ type: "history_cleared" });
                    vscode.window.showInformationMessage("Orbit impact history and backups cleared successfully.");
                }
            }
        });
    }

    /**
     * Generates the HTML for the standalone Settings page.
     */
    private _getHtmlForSettings(webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "form.css")
        );
        
        const nonce = getNonce();
        const settings = context.globalState.get<any>("orbit.settings", {});
        const timeoutMinutes = settings.inactivityTimeout ?? 5;
        const warningSeconds = settings.countdownWarningThreshold ?? 60;
        const zoomSensitivity = settings.zoomSensitivity ?? 0.15;
        const detailPanelHeight = settings.detailPanelHeight ?? 160;
        const quotaRefreshRate = settings.quotaRefreshRate ?? 90;
        const quotaWarningThreshold = settings.quotaWarningThreshold ?? 40;
        const quotaCriticalThreshold = settings.quotaCriticalThreshold ?? 20;
        const quotaGaugeStyle = settings.quotaGaugeStyle ?? "circular-segmented";
        const quotaHistoryRangeDays = settings.quotaHistoryRangeDays ?? 7;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}">
    <title>Orbit Settings</title>
</head>
<body class="settings-body">
    <div class="settings-container">
        <h1 class="settings-title">Orbit Settings</h1>
        <p class="settings-subtitle">Configure Orbit planning timeouts and visual mapping defaults.</p>

        <div class="settings-section">
            <h2 class="section-title">Pre-Execution Planning Form</h2>
            
            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-timeout" class="setting-label">Inactivity Timeout (minutes)</label>
                    <span class="setting-description">Inactivity duration threshold for pre-execution forms before automatically triggering a timeout.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-timeout" min="1" max="60" value="${timeoutMinutes}" class="slider-input">
                    <span id="value-timeout" class="slider-value-display">${timeoutMinutes}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-warning" class="setting-label">Countdown Warning Threshold (seconds)</label>
                    <span class="setting-description">Countdown duration displayed in the form prior to triggering inactivity timeout.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-warning" min="5" max="300" step="5" value="${warningSeconds}" class="slider-input">
                    <span id="value-warning" class="slider-value-display">${warningSeconds}</span>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <h2 class="section-title">Cartograph Diagram</h2>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-zoom" class="setting-label">Zoom Sensitivity</label>
                    <span class="setting-description">Mouse wheel zoom speed for the Cartograph diagram canvas. Lower values zoom slower.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-zoom" min="0.01" max="0.5" step="0.01" value="${zoomSensitivity}" class="slider-input">
                    <span id="value-zoom" class="slider-value-display">${zoomSensitivity}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-detail-height" class="setting-label">Detail Panel Height (px)</label>
                    <span class="setting-description">Maximum height of the file detail panel below the diagram canvas.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-detail-height" min="80" max="800" step="10" value="${detailPanelHeight}" class="slider-input">
                    <span id="value-detail-height" class="slider-value-display">${detailPanelHeight}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label class="setting-label">Clear Diagram History</label>
                    <span class="setting-description">Permanently delete all stored task diagram files and clear the Cartograph history array.</span>
                </div>
                <div class="setting-control">
                    <button id="btn-clear-history" class="action-btn-danger">Clear Stored History</button>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <h2 class="section-title">Orbit Quota Monitoring</h2>
            
            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-quota-refresh" class="setting-label">Background Polling Interval (seconds)</label>
                    <span class="setting-description">Time between automated status checks and quota updates.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-quota-refresh" min="10" max="600" step="5" value="${quotaRefreshRate}" class="slider-input">
                    <span id="value-quota-refresh" class="slider-value-display">${quotaRefreshRate}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-quota-warning" class="setting-label">Warning Threshold (%)</label>
                    <span class="setting-description">Quota remaining percentage threshold below which indicators turn yellow.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-quota-warning" min="0" max="100" value="${quotaWarningThreshold}" class="slider-input">
                    <span id="value-quota-warning" class="slider-value-display">${quotaWarningThreshold}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-quota-critical" class="setting-label">Critical Threshold (%)</label>
                    <span class="setting-description">Quota remaining percentage threshold below which critical alerts fire.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-quota-critical" min="0" max="100" value="${quotaCriticalThreshold}" class="slider-input">
                    <span id="value-quota-critical" class="slider-value-display">${quotaCriticalThreshold}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="input-quota-history" class="setting-label">Burn Rate History Window (days)</label>
                    <span class="setting-description">Number of days of persistent logs to retain for burn rate calculation.</span>
                </div>
                <div class="setting-control">
                    <input type="range" id="input-quota-history" min="1" max="30" value="${quotaHistoryRangeDays}" class="slider-input">
                    <span id="value-quota-history" class="slider-value-display">${quotaHistoryRangeDays}</span>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <label for="select-quota-gauge" class="setting-label">Remaining Gauge Style</label>
                    <span class="setting-description">Visual representation of remaining percentages in the sidebar.</span>
                </div>
                <div class="setting-control">
                    <select id="select-quota-gauge" class="select-input">
                        <option value="circular-segmented" ${quotaGaugeStyle === "circular-segmented" ? "selected" : ""}>Circular Segmented</option>
                        <option value="circular-plain" ${quotaGaugeStyle === "circular-plain" ? "selected" : ""}>Circular Plain</option>
                        <option value="horizontal-bar" ${quotaGaugeStyle === "horizontal-bar" ? "selected" : ""}>Horizontal Bar</option>
                        <option value="vertical-bar" ${quotaGaugeStyle === "vertical-bar" ? "selected" : ""}>Vertical Bar</option>
                        <option value="segmented-horizontal-bar" ${quotaGaugeStyle === "segmented-horizontal-bar" ? "selected" : ""}>Segmented Horizontal Bar</option>
                        <option value="segmented-vertical-bar" ${quotaGaugeStyle === "segmented-vertical-bar" ? "selected" : ""}>Segmented Vertical Bar</option>
                    </select>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const timeoutSlider = document.getElementById("input-timeout");
        const timeoutDisplay = document.getElementById("value-timeout");
        const warningSlider = document.getElementById("input-warning");
        const warningDisplay = document.getElementById("value-warning");
        const zoomSlider = document.getElementById("input-zoom");
        const zoomDisplay = document.getElementById("value-zoom");
        const detailHeightSlider = document.getElementById("input-detail-height");
        const detailHeightDisplay = document.getElementById("value-detail-height");
        const clearBtn = document.getElementById("btn-clear-history");

        const quotaRefreshSlider = document.getElementById("input-quota-refresh");
        const quotaRefreshDisplay = document.getElementById("value-quota-refresh");
        const quotaWarningSlider = document.getElementById("input-quota-warning");
        const quotaWarningDisplay = document.getElementById("value-quota-warning");
        const quotaCriticalSlider = document.getElementById("input-quota-critical");
        const quotaCriticalDisplay = document.getElementById("value-quota-critical");
        const quotaHistorySlider = document.getElementById("input-quota-history");
        const quotaHistoryDisplay = document.getElementById("value-quota-history");
        const quotaGaugeSelect = document.getElementById("select-quota-gauge");

        timeoutSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            timeoutDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "inactivityTimeout", value: parseInt(val, 10) });
        });

        warningSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            warningDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "countdownWarningThreshold", value: parseInt(val, 10) });
        });

        zoomSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            zoomDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "zoomSensitivity", value: parseFloat(val) });
        });

        detailHeightSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            detailHeightDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "detailPanelHeight", value: parseInt(val, 10) });
        });

        quotaRefreshSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            quotaRefreshDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "quotaRefreshRate", value: parseInt(val, 10) });
        });

        quotaWarningSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            quotaWarningDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "quotaWarningThreshold", value: parseInt(val, 10) });
        });

        quotaCriticalSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            quotaCriticalDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "quotaCriticalThreshold", value: parseInt(val, 10) });
        });

        quotaHistorySlider.addEventListener("input", (e) => {
            const val = e.target.value;
            quotaHistoryDisplay.textContent = val;
            vscode.postMessage({ type: "update_setting", key: "quotaHistoryRangeDays", value: parseInt(val, 10) });
        });

        quotaGaugeSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            vscode.postMessage({ type: "update_setting", key: "quotaGaugeStyle", value: val });
        });

        clearBtn.addEventListener("click", () => {
            vscode.postMessage({ type: "clear_history" });
        });

        window.addEventListener("message", (event) => {
            if (event.data.type === "history_cleared") {
                clearBtn.disabled = true;
                clearBtn.textContent = "History Purged";
            }
        });
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
