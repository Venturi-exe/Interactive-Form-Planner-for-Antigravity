import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { ProcessFinder } from "./ProcessFinder";
import { QuotaService, QuotaSnapshot } from "./QuotaService";
import { QuotaHistoryManager } from "./QuotaHistoryManager";
import { FormViewProvider } from "../FormViewProvider";

export class QuotaViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "orbit.quotaView";

  private _view?: vscode.WebviewView;
  private _processFinder: ProcessFinder;
  private _quotaService: QuotaService;
  private _historyManager: QuotaHistoryManager;
  private _pollInterval?: NodeJS.Timeout;
  private _lastSnapshot?: QuotaSnapshot;

  // Notification state tracking to ensure we notify only once per threshold crossing
  private _notifiedWarning = new Set<string>();
  private _notifiedCritical = new Set<string>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._processFinder = new ProcessFinder();
    this._quotaService = new QuotaService();
    this._historyManager = new QuotaHistoryManager(this._context.globalState);

    // Apply configuration settings
    const historyRange = this.getSetting<number>("quotaHistoryRangeDays", "historyRangeDays", 7);
    this._historyManager.setHistoryRange(historyRange);

    // Listen for config changes to dynamically adjust history range or polling rate
    this._context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("orbit.quota.historyRangeDays")) {
          const updatedRange = this.getSetting<number>("quotaHistoryRangeDays", "historyRangeDays", 7);
          this._historyManager.setHistoryRange(updatedRange);
        }
        if (e.affectsConfiguration("orbit.quota.refreshRate")) {
          this.startBackgroundPolling();
        }
        if (e.affectsConfiguration("orbit.quota.gaugeStyle")) {
          this.pushStateToWebview();
        }
      })
    );

    // Listen for custom settings tab changes
    FormViewProvider.onConfigChange(() => {
      const updatedRange = this.getSetting<number>("quotaHistoryRangeDays", "historyRangeDays", 7);
      this._historyManager.setHistoryRange(updatedRange);
      this.startBackgroundPolling();
      this.pushStateToWebview();
    });

    // Run discovery on extension startup, then start polling
    this.discoverAndFetch().then(() => {
      this.startBackgroundPolling();
    });
  }

  private getSetting<T>(key: string, section: string, defaultValue: T): T {
    const settings = this._context.globalState.get<any>("orbit.settings", {});
    if (settings[key] !== undefined) {
      return settings[key] as T;
    }
    return vscode.workspace.getConfiguration("orbit.quota").get<T>(section, defaultValue);
  }

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

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleWebviewMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.discoverAndFetch();
      }
    });
  }

  private async discoverAndFetch(): Promise<void> {
    try {
      console.log("[QuotaViewProvider] Triggering process discovery...");
      const serverInfo = await this._processFinder.detect();
      if (serverInfo) {
        this._quotaService.setServerInfo(serverInfo.port, serverInfo.csrfToken);
        const snapshot = await this._quotaService.fetchQuota();
        if (snapshot) {
          await this.processQuotaSnapshot(snapshot);
        }
      } else {
        console.warn("[QuotaViewProvider] Language server discovery yielded no active server.");
      }
    } catch (err) {
      console.error("[QuotaViewProvider] Error in discoverAndFetch:", err);
    }
  }

  private startBackgroundPolling(): void {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
    }

    const seconds = this.getSetting<number>("quotaRefreshRate", "refreshRate", 90);
    console.log(`[QuotaViewProvider] Background polling registered for every ${seconds} seconds.`);

    this._pollInterval = setInterval(() => {
      this.pollServer();
    }, seconds * 1000);
  }

  private async pollServer(): Promise<void> {
    try {
      const snapshot = await this._quotaService.fetchQuota();
      if (snapshot) {
        await this.processQuotaSnapshot(snapshot);
      } else {
        // Retry process finder if request fails (server might have restarted)
        console.log("[QuotaViewProvider] Poll returned empty, retrying process discovery...");
        await this.discoverAndFetch();
      }
    } catch (err) {
      console.error("[QuotaViewProvider] Error in background polling:", err);
    }
  }

  private async processQuotaSnapshot(snapshot: QuotaSnapshot): Promise<void> {
    this._lastSnapshot = snapshot;
    // 1. Record history points for burn rate
    const usageMap: Record<string, number> = {};
    const strategy = this._quotaService.getStrategyManager();

    snapshot.models.forEach((model) => {
      const group = strategy.getGroupForModel(model.modelId, model.label);
      // Group value is the minimum remaining among all models in that group
      if (usageMap[group.id] === undefined || model.remainingPercentage < usageMap[group.id]) {
        usageMap[group.id] = model.remainingPercentage;
      }
    });

    await this._historyManager.recordQuotaPoint(usageMap);

    const warnLimit = this.getSetting<number>("quotaWarningThreshold", "warningThreshold", 40);
    const critLimit = this.getSetting<number>("quotaCriticalThreshold", "criticalThreshold", 20);

    for (const [groupId, remaining] of Object.entries(usageMap)) {
      const groupLabel = strategy.getGroups().find(g => g.id === groupId)?.label || groupId;

      // Handle Critical Threshold (<= 20%)
      if (remaining <= critLimit) {
        if (!this._notifiedCritical.has(groupId)) {
          this._notifiedCritical.add(groupId);
          vscode.window.showWarningMessage(
            `Critical Quota Warning: ${groupLabel} is at ${remaining.toFixed(0)}% remaining!`
          );
        }
        this._notifiedWarning.delete(groupId);
      } else if (remaining <= warnLimit) { // Handle Warning Threshold (<= 40%)
        if (!this._notifiedWarning.has(groupId)) {
          this._notifiedWarning.add(groupId);
          vscode.window.showInformationMessage(
            `Low Quota: ${groupLabel} has fell below warning threshold (${remaining.toFixed(0)}% remaining).`
          );
        }
        this._notifiedCritical.delete(groupId);
      } else {
        this._notifiedCritical.delete(groupId);
        this._notifiedWarning.delete(groupId);
      }
    }

    // 3. Update active webviews
    this.pushStateToWebview(snapshot);
  }

  private pushStateToWebview(snapshot?: QuotaSnapshot): void {
    if (!this._view) return;

    const currentSnapshot = snapshot || this._lastSnapshot;
    const gaugeStyle = this.getSetting<string>("quotaGaugeStyle", "gaugeStyle", "circular-segmented");

    const strategy = this._quotaService.getStrategyManager();
    const groups = strategy.getGroups().map((g) => {
      // Find matching models in the snapshot to determine group remainder (minimum)
      const matchingModels = currentSnapshot?.models.filter(
        (m) => strategy.getGroupForModel(m.modelId, m.label).id === g.id
      ) || [];

      const hasData = matchingModels.length > 0;
      const minRemaining = hasData
        ? Math.min(...matchingModels.map((m) => m.remainingPercentage))
        : 100;
      const resetTime = hasData ? matchingModels[0].timeUntilReset : "Ready";

      return {
        id: g.id,
        label: g.label,
        remaining: minRemaining,
        resetTime,
        themeColor: g.themeColor,
        hasData,
        burnRate: this._historyManager.getGroupBurnRate(g.id),
      };
    });

    const burnRateVal = this._historyManager.calculateBurnRate();

    const viewState = {
      groups,
      burnRate: `Burn Rate: ${burnRateVal.toFixed(1)} %/h`,
      userInfo: currentSnapshot?.userInfo,
      tokenUsage: currentSnapshot?.tokenUsage,
      gaugeStyle,
    };

    this._view.webview.postMessage({
      type: "quotaUpdate",
      payload: viewState,
    });
  }

  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case "webviewReady":
        this.discoverAndFetch();
        break;

      case "refreshQuota":
        await this.discoverAndFetch();
        break;

      case "clearHistory":
        await this._historyManager.clear();
        this.discoverAndFetch();
        vscode.window.showInformationMessage("Orbit Quota: Persistent history logs cleared successfully.");
        break;

      case "openSettings":
        vscode.commands.executeCommand("orbit.openSettings");
        break;

      case "reloadWindow":
        vscode.commands.executeCommand("workbench.action.reloadWindow");
        break;

      case "openGeminiRules": {
        const rulesPath = path.join(os.homedir(), ".gemini", "GEMINI.md");
        this.openFileInEditor(rulesPath);
        break;
      }

      case "openMcpConfig": {
        let configPath = path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json");
        if (!fs.existsSync(configPath)) {
          configPath = path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
        }
        this.openFileInEditor(configPath);
        break;
      }
    }
  }

  private async openFileInEditor(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      try {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
      }
    } else {
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "src", "webview", "quota.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "src", "webview", "quota.js")
    );

    const nonce = this.getNonce();

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
    <title>Quota Monitoring</title>
</head>
<body>
    <div id="quota-root"></div>
    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public dispose(): void {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
    }
  }
}

