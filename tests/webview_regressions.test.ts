import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function loadFormScript() {
  const elements: ElementStub[] = [];
  class ElementStub {
    id = '';
    value = '';
    disabled = false;
    textContent = '';
    innerHTML = '';
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: ElementStub[] = [];
    listeners: Record<string, () => void> = {};
    classes = new Set<string>();
    classList = {
      add: (name: string) => this.classes.add(name),
      remove: (name: string) => this.classes.delete(name),
      contains: (name: string) => this.classes.has(name),
    };
    constructor(public tagName = 'div', id = '') {
      this.id = id;
      elements.push(this);
    }
    appendChild(child: ElementStub) { this.children.push(child); }
    addEventListener(name: string, callback: () => void) { this.listeners[name] = callback; }
    querySelector() { return null; }
    querySelectorAll(selector: string): ElementStub[] {
      const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      return selector === '*' ? descendants : descendants.filter(child => child.tagName === selector);
    }
  }
  for (const id of ['empty-state', 'form-content', 'tab-planner', 'tab-cartograph', 'timeout-warning', 'agent-disconnect-banner']) {
    new ElementStub('div', id);
  }
  const navigation = ['tab-btn-planner', 'tab-btn-cartograph', 'btn-open-hub'].map(id => new ElementStub('button', id));
  const messages: any[] = [];
  const windowListeners: Record<string, (event: any) => void> = {};
  let tick = () => {};
  const document = {
    getElementById: (id: string) => elements.find(element => element.id === id),
    createElement: (tag: string) => new ElementStub(tag),
    addEventListener() {},
    querySelectorAll: (selector: string) => selector === 'button' ? elements.filter(element => element.tagName === 'button') : [],
  };
  const window = {
    orbitConfig: { inactivityTimeout: 1, viewMode: 'combined' },
    addEventListener: (name: string, callback: (event: any) => void) => { windowListeners[name] = callback; },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../src/webview/form.js', import.meta.url), 'utf8'), {
    window, document,
    acquireVsCodeApi: () => ({ postMessage: (message: any) => messages.push(message) }),
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval() {}, setTimeout() {}, console, alert() {},
  });
  windowListeners.message({ data: { type: 'render_form', requestId: 'test-request', title: 'Test', fields: [] } });
  return { navigation, messages, windowListeners, document, tick: () => tick() };
}

describe('planner webview navigation', () => {
  it('keeps tabs and Hub enabled after an inactivity timeout', () => {
    const form = loadFormScript();
    for (let second = 0; second < 60; second++) form.tick();
    expect(form.messages.some(message => message.type === 'form_timeout')).toBe(true);
    expect(form.document.getElementById('planner-form')!.querySelectorAll('button').every(button => button.disabled)).toBe(true);
    expect(form.navigation.every(button => !button.disabled)).toBe(true);
    form.navigation[1].listeners.click();
    expect(form.messages.at(-1)).toEqual({ type: 'tab_changed', tab: 'cartograph' });
  });

  it('keeps navigation enabled when clarification is submitted', () => {
    const form = loadFormScript();
    form.document.getElementById('clarification-input')!.value = 'What does this option mean?';
    form.document.getElementById('clarification-btn')!.listeners.click();
    expect(form.messages.some(message => message.type === 'form_clarification')).toBe(true);
    expect(form.navigation.every(button => !button.disabled)).toBe(true);
  });

  it('forwards uncaught errors and rejected promises to the extension', () => {
    const form = loadFormScript();
    form.windowListeners.error?.({ message: 'Script failed', filename: 'form.js', lineno: 10, colno: 2, error: new Error('Script failed') });
    form.windowListeners.unhandledrejection?.({ reason: new Error('Promise failed') });
    const errors = form.messages.filter(message => message.type === 'webview_error');
    expect(errors.map(message => message.message)).toEqual(['Script failed', 'Promise failed']);
  });
});
