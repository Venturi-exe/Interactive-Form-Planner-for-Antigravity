import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as paths from '../src/core/paths';
import * as projectKey from '../src/core/projectKey';
import * as schemas from '../src/core/schemas';

// Run the provider source with a small host substitute, without building the extension.
function providerFixture(withBrain = true) {
  const state = new Map<string, any>();
  const posted: any[] = [];
  const listeners: { message?: (message: any) => Promise<void>; dispose?: () => void } = {};
  const messageDisposable = { dispose: vi.fn() };
  const configDisposable = { dispose: vi.fn() };
  const panel = {
    webview: {
      cspSource: 'test-resource:',
      asWebviewUri: (uri: string) => uri,
      html: '',
      postMessage: (message: any) => { posted.push(message); },
      onDidReceiveMessage: (handler: (message: any) => Promise<void>) => { listeners.message = handler; return messageDisposable; },
    },
    onDidDispose: (handler: () => void) => { listeners.dispose = handler; },
  };
  const host = {
    Uri: { joinPath: (_uri: unknown, ...parts: string[]) => parts.join('/') },
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => panel, showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(async () => 'Delete'), showInformationMessage: vi.fn(),
    },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidChangeConfiguration: () => configDisposable,
    },
  };
  const hub = { openHubPanel: vi.fn(), broadcastRefresh: vi.fn() };
  const nodeRequire = createRequire(import.meta.url);
  const module = { exports: {} as any };
  const source = fs.readFileSync(new URL('../src/FormViewProvider.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require: (name: string) => {
      if (name === 'vscode') return host;
      if (name === './HubPanelManager.js') return { HubPanelManager: hub };
      if (name === './core/paths.js') return paths;
      if (name === './core/projectKey.js') return projectKey;
      if (name === './core/schemas.js') return schemas;
      return nodeRequire(name);
    },
    console, process,
  });
  const context = {
    globalState: {
      get: (key: string, fallback: any) => state.get(key) ?? fallback,
      update: async (key: string, value: any) => { state.set(key, value); },
    },
  };
  const brain = { deleteCartographReport: vi.fn() };
  const provider = new module.exports.FormViewProvider({}, context, withBrain ? brain : undefined);
  return { provider, context, panel, state, posted, listeners, messageDisposable, configDisposable, host, hub, brain };
}

describe('form provider regressions', () => {
  it('renders settings without obsolete quota controls and ignores obsolete setting messages', async () => {
    const fixture = providerFixture();
    fixture.provider.openSettingsPanel(fixture.context);
    expect(fixture.panel.webview.html.toLowerCase()).not.toContain('quota');
    await fixture.listeners.message!({ type: 'update_setting', key: 'quotaRefreshRate', value: 10 });
    expect(fixture.state.has('orbit.settings')).toBe(false);
    fixture.provider._view = fixture.panel;
    await fixture.listeners.message!({ type: 'update_setting', key: 'inactivityTimeout', value: 10 });
    expect(fixture.state.get('orbit.settings')).toEqual({ inactivityTimeout: 10 });
    expect(fixture.posted[0].config).toEqual({ inactivityTimeout: 10, countdownWarningThreshold: 60, zoomSensitivity: 0.15, detailPanelHeight: 160 });
  });

  it('renders balanced buttons in the sidebar fallback markup', () => {
    const fixture = providerFixture();
    const html = fixture.provider._getHtmlForWebview(fixture.panel.webview);
    let depth = 0;
    for (const tag of html.match(/<\/?button\b[^>]*>/g) ?? []) {
      if (tag.startsWith('</')) depth--;
      else depth++;
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(1);
    }
    expect(depth).toBe(0);
  });

  it('disposes sidebar subscriptions and clears the disposed view', () => {
    const fixture = providerFixture();
    fixture.provider.resolveWebviewView(fixture.panel, {}, {});
    fixture.listeners.dispose!();
    expect(fixture.messageDisposable.dispose).toHaveBeenCalledOnce();
    expect(fixture.configDisposable.dispose).toHaveBeenCalledOnce();
    expect(fixture.provider._view).toBeUndefined();
  });

  it('reports a missing Brain when opening the Hub', async () => {
    const fixture = providerFixture(false);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await fixture.provider._handleWebviewMessage({ type: 'open_hub' });
      expect(fixture.host.window.showErrorMessage).toHaveBeenCalledOnce();
      expect(fixture.hub.openHubPanel).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('deletes the canonical default group from legacy history and current sidebar reports', async () => {
    const fixture = providerFixture();
    const timestamp = '2026-11-04T00:00:00Z';
    const historical = { taskId: 'old', timestamp, projectName: 'Default' };
    const current = { taskId: 'current', timestamp, filename: 'legacy-name.json' };
    const other = { taskId: 'other', timestamp, projectName: 'orbit' };
    fixture.state.set('orbit.impactHistory', [historical, other]);
    fixture.provider._sessionReports = [historical, current, other];
    await fixture.provider._handleDeleteReport(undefined, undefined, '_default');
    expect(fixture.brain.deleteCartographReport).toHaveBeenCalledTimes(2);
    expect(fixture.brain.deleteCartographReport).toHaveBeenCalledWith('_default', 'legacy-name.json');
    expect(fixture.state.get('orbit.impactHistory')).toEqual([other]);
    expect(fixture.provider._sessionReports).toEqual([other]);
  });
});
