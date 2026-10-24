import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OrbitBrain } from './OrbitBrain';
import { ImpactReport, MergedTimelineEntry, ImpactChange } from './types';
import { HubWebviewMessageSchema } from './core/schemas.js';

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class HubPanelManager {
  private static _hubPanel?: vscode.WebviewPanel;
  private static _context?: vscode.ExtensionContext;
  private static _brain?: OrbitBrain;

  /**
   * Opens the Cartograph Hub singleton panel.
   */
  public static openHubPanel(context: vscode.ExtensionContext, brain: OrbitBrain): void {
    this._context = context;
    this._brain = brain;

    if (this._hubPanel) {
      this._hubPanel.reveal(vscode.ViewColumn.Active);
      this.refreshHubData();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'orbit.hub',
      'Cartograph Hub',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      }
    );

    this._hubPanel = panel;

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'tab-hub.png');

    panel.webview.html = this._getHtmlForHub(panel.webview);

    // Wire message routing dispatcher
    panel.webview.onDidReceiveMessage((message) => {
      this._handleHubMessage(message);
    });

    panel.onDidDispose(() => {
      this._hubPanel = undefined;
    });

    // Load initial data
    this.refreshHubData();
  }

  /**
   * Broadcasts a data refresh to the Hub if active, alongside sidebar/multi-tab panels.
   */
  public static broadcastRefresh(reports?: ImpactReport[]): void {
    if (this._hubPanel) {
      const allReports = reports || this.loadAllReports();
      this._hubPanel.webview.postMessage({
        type: 'hub_load_all',
        reports: allReports,
      });
    }
  }

  /**
   * Load all reports across all projects.
   */
  private static loadAllReports(): ImpactReport[] {
    if (!this._brain) return [];
    
    const projects = this._brain.listProjects();
    if (!projects.includes("Default")) {
      projects.push("Default");
    }
    let allReports: ImpactReport[] = [];
    
    projects.forEach((proj) => {
      const projectReports = this._brain!.listCartographReports(proj);
      projectReports.forEach((item) => {
        item.report.projectName = proj;
        item.report.filename = item.filename;
        allReports.push(item.report);
      });
    });

    // Sort reports chronologically, newest first
    return allReports.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Refreshes data on the Hub.
   */
  private static refreshHubData(): void {
    if (!this._hubPanel || !this._brain) return;

    const allReports = this.loadAllReports();
    this._hubPanel.webview.postMessage({
      type: 'hub_load_all',
      reports: allReports,
    });

    // Load tag registry for expanded project if we want, or send default tags registry
    // We send registry mapping for all active projects combined
    const projects = this._brain.listProjects();
    if (!projects.includes("Default")) {
      projects.push("Default");
    }
    const combinedRegistry: Record<string, { color: string; label: string }> = {};
    
    projects.forEach((proj) => {
      const reg = this._brain!.readTagRegistry(proj);
      Object.assign(combinedRegistry, reg);
    });

    this._hubPanel.webview.postMessage({
      type: 'hub_load_tags',
      tagRegistry: combinedRegistry,
    });
  }

  /**
   * Main Message Dispatcher Router.
   */
  private static async _handleHubMessage(rawMessage: unknown): Promise<void> {
    if (!this._brain || !this._context) return;

    const parsed = HubWebviewMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      console.warn('[HubPanelManager] Ignored invalid hub webview message:', parsed.error);
      return;
    }
    const message = parsed.data;

    switch (message.type) {
      case 'hub_ready':
        this.refreshHubData();
        break;

      case 'hub_delete_reports': {
        const { projectName, filenames } = message;
        const count = filenames.length;
        const confirmLabel = count === 1 ? 'Delete Report' : `Delete ${count} Reports`;

        const choice = await vscode.window.showWarningMessage(
          `Are you sure you want to permanently delete ${count === 1 ? 'this report' : `${count} reports`}? This cannot be undone.`,
          { modal: true },
          confirmLabel
        );

        if (choice === confirmLabel) {
          filenames.forEach((fn: string) => {
            this._brain!.deleteCartographReport(projectName, fn);
          });
          
          // Broadcast update globally to sidebar and hub
          this.triggerGlobalBroadcast();
        }
        break;
      }

      case 'hub_move_reports': {
        const { targetProject, reports, sourceProject, filenames } = message;
        
        if (reports && Array.isArray(reports)) {
          reports.forEach((item: { filename: string; sourceProject: string }) => {
            if (item.filename) {
              this._brain!.moveCartographReport(item.sourceProject, targetProject, item.filename);
            }
          });
        } else if (filenames && Array.isArray(filenames)) {
          filenames.forEach((fn: string) => {
            this._brain!.moveCartographReport(sourceProject || 'default', targetProject, fn);
          });
        }

        this.triggerGlobalBroadcast();
        break;
      }

      case 'hub_merge_selected_reports': {
        const { projectName, taskIds } = message;
        const allReports = this._brain.listCartographReports(projectName);
        const targetReports = allReports
          .filter((item) => taskIds.includes(item.report.taskId))
          .map((item) => item.report)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // oldest first

        if (targetReports.length < 2) return;

        // Perform Merge Timeline Construction
        const mergedTimeline: MergedTimelineEntry[] = [];
        const mergedChangesMap = new Map<string, ImpactChange>();
        const mergedTags = new Set<string>();

        const combinedRoadmap: string[] = [];
        const combinedAssumptions: string[] = [];
        const combinedQuestions: string[] = [];
        const combinedDecisions: Array<{ question: string; answer: string }> = [];

        targetReports.forEach((report) => {
          // If the report is already merged, expand its timeline inline to preserve sequence
          if (report.isMerged && report.timeline) {
            report.timeline.forEach((entry) => {
              mergedTimeline.push(entry);
              entry.changes.forEach((c) => mergedChangesMap.set(c.filePath, c));
              if (entry.tags) entry.tags.forEach((t) => mergedTags.add(t));
            });
          } else {
            const entry: MergedTimelineEntry = {
              taskId: report.taskId,
              timestamp: report.timestamp,
              summary: report.summary,
              changes: report.changes,
              planningContext: report.planningContext,
              tags: report.tags,
            };
            mergedTimeline.push(entry);
            report.changes.forEach((c) => mergedChangesMap.set(c.filePath, c));
            if (report.tags) report.tags.forEach((t) => mergedTags.add(t));
          }

          if (report.planningContext) {
            if (report.planningContext.roadmap) combinedRoadmap.push(...report.planningContext.roadmap);
            if (report.planningContext.assumptions) combinedAssumptions.push(...report.planningContext.assumptions);
            if (report.planningContext.questionsAsked) combinedQuestions.push(...report.planningContext.questionsAsked);
            if (report.planningContext.userDecisions) combinedDecisions.push(...report.planningContext.userDecisions);
          }
        });

        // Create new combined Merged Report
        const newMergedReport: ImpactReport = {
          taskId: `merged_${Date.now()}`,
          timestamp: new Date().toISOString(),
          summary: `Consolidated Timeline: ${targetReports.map((r) => r.summary).join('; ')}`,
          projectName: projectName,
          changes: Array.from(mergedChangesMap.values()),
          isMerged: true,
          mergedFrom: targetReports.map((r) => r.taskId),
          timeline: mergedTimeline,
          tags: Array.from(mergedTags),
          planningContext: {
            roadmap: Array.from(new Set(combinedRoadmap)),
            assumptions: Array.from(new Set(combinedAssumptions)),
            questionsAsked: Array.from(new Set(combinedQuestions)),
            userDecisions: combinedDecisions, // Keep choices history
          },
        };

        // Write new merged report
        this._brain.writeCartographReport(projectName, newMergedReport);

        // Delete original reports
        allReports.forEach((item) => {
          if (taskIds.includes(item.report.taskId)) {
            this._brain!.deleteCartographReport(projectName, item.filename);
          }
        });

        this.triggerGlobalBroadcast();
        break;
      }

      case 'hub_update_tags': {
        const { projectName, taskId, filename, tags, registryUpdate } = message;

        // 1. Update tag registry if custom tags colors are added
        if (Object.keys(registryUpdate).length > 0) {
          const currentRegistry = this._brain.readTagRegistry(projectName);
          const updatedRegistry = { ...currentRegistry, ...registryUpdate };
          this._brain.writeTagRegistry(projectName, updatedRegistry);
        }

        // 2. Read the specific report file, update tags property, and rewrite
        const allReports = this._brain.listCartographReports(projectName);
        const target = allReports.find((r) => filename ? r.filename === filename : r.report.taskId === taskId);
        if (target) {
          target.report.tags = tags;
          this._brain.writeCartographReport(projectName, target.report, target.filename);
        }

        this.triggerGlobalBroadcast();
        break;
      }

      case 'hub_export_all_projects': {
        const allReports = this.loadAllReports();
        const exportContent = JSON.stringify(allReports, null, 2);

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'cartograph_export.json')),
          filters: { 'JSON Files': ['json'] },
        });

        if (uri) {
          fs.writeFileSync(uri.fsPath, exportContent, 'utf-8');
          vscode.window.showInformationMessage('Cartograph Hub backup successfully exported!');
        }
        break;
      }

      case 'hub_export_project': {
        const { projectName, format } = message;
        const projectReports = this._brain.listCartographReports(projectName).map((item) => item.report);

        let exportContent = '';
        let ext = 'json';
        if (format === 'markdown') {
          ext = 'md';
          exportContent = `# Cartograph Impact Report Archive: ${projectName}\n\n`;
          projectReports.forEach((report) => {
            exportContent += `## ${report.summary}\n`;
            exportContent += `- **Task ID**: ${report.taskId}\n`;
            exportContent += `- **Timestamp**: ${new Date(report.timestamp).toLocaleString()}\n`;
            exportContent += `- **Tags**: ${report.tags?.join(', ') || 'None'}\n\n`;
            exportContent += `### File Impact Footprint\n\n`;
            exportContent += `| Change | Path | Details |\n`;
            exportContent += `|---|---|---|\n`;
            report.changes.forEach((c) => {
              exportContent += `| ${c.changeType.toUpperCase()} | \`${c.filePath}\` | ${c.description || c.promptExcerpt || '-'} |\n`;
            });
            exportContent += `\n---\n\n`;
          });
        } else {
          exportContent = JSON.stringify(projectReports, null, 2);
        }

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', `${projectName}_cartograph_export.${ext}`)),
          filters: { [format === 'markdown' ? 'Markdown Files' : 'JSON Files']: [ext] },
        });

        if (uri) {
          fs.writeFileSync(uri.fsPath, exportContent, 'utf-8');
          vscode.window.showInformationMessage(`Project ${projectName} successfully exported!`);
        }
        break;
      }

      case 'hub_open_in_cartograph': {
        const { taskId, projectName } = message;
        // Swing sidebar panel into focus and select the target report
        vscode.commands.executeCommand('orbit.formView.focus');
        
        // Find if FormViewProvider instance is registered and call select
        // Broadcast open request down to FormViewProvider message router
        vscode.commands.executeCommand('orbit.selectReport', { taskId, projectName });
        break;
      }
    }
  }

  /**
   * Syncs and updates both Hub and sidebar.
   */
  private static triggerGlobalBroadcast(): void {
    if (this._brain) {
      const allReports = this.loadAllReports();
      this.broadcastRefresh(allReports);

      // Post update to extension commands so sidebar refreshes
      vscode.commands.executeCommand('orbit.refreshSidebarData');
    }
  }

  private static _getHtmlForHub(webview: vscode.Webview): string {
    const extensionUri = this._context!.extensionUri;

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'hub.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'hub.js')
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
                   img-src ${webview.cspSource} data:;
                   script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}">
    <title>Cartograph Hub</title>
</head>
<body>
    <div id="hub-root"></div>
    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}
