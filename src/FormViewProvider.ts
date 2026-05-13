import * as vscode from "vscode";
import type { AlignmentFormRequest, FormResult } from "./types.js";

/**
 * Provides the sidebar webview panel for rendering planning forms.
 * Handles bidirectional messaging between the extension host and the webview.
 */
export class FormViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "interactiveForms.formView";

    private _view?: vscode.WebviewView;
    private _pendingResolver?: (result: FormResult) => void;

    constructor(private readonly _extensionUri: vscode.Uri) {}

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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            if (!this._pendingResolver) return;

            if (message.type === "form_submitted") {
                this._pendingResolver({ action: "submit", dismissed: false, data: message.data });
                this._pendingResolver = undefined;
            } else if (message.type === "form_executed") {
                this._pendingResolver({ action: "execute", dismissed: false, data: message.data });
                this._pendingResolver = undefined;
            } else if (message.type === "form_dismissed") {
                this._pendingResolver({ action: "dismiss", dismissed: true, data: {} });
                this._pendingResolver = undefined;
            }
        });
    }

    /**
     * Renders a form in the webview and waits for the user to submit or dismiss.
     */
    public async showForm(request: AlignmentFormRequest): Promise<FormResult> {
        if (this._view) {
            this._view.show?.(true);
        }

        return new Promise<FormResult>((resolve) => {
            this._pendingResolver = resolve;

            this._view?.webview.postMessage({
                type: "render_form",
                requestId: request.requestId,
                title: request.title,
                description: request.description ?? "",
                fields: request.fields,
                showExecuteButton: request.showExecuteButton ?? false,
            });
        });
    }

    /**
     * Generates the full HTML document for the webview.
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "form.css")
        );
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "webview", "form.js")
        );

        const nonce = getNonce();

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
    <title>Interactive Planner</title>
</head>
<body>
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
        </div>
        <div id="form-content" style="display: none;"></div>
    </div>
    <script nonce="${nonce}" src="${jsUri}"></script>
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
