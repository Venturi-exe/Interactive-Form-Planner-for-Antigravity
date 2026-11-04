import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const vsixArg = process.argv[2];
let vsixPath = vsixArg ? path.resolve(vsixArg) : null;

if (!vsixPath) {
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir).filter(f => f.endsWith('.vsix'));
    if (files.length > 0) {
      vsixPath = path.join(distDir, files[0]);
    }
  }
}

if (!vsixPath) {
  const rootFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.vsix'));
  if (rootFiles.length > 0) {
    vsixPath = path.join(rootDir, rootFiles[0]);
  }
}

if (!vsixPath || !fs.existsSync(vsixPath)) {
  console.error('[smoke-vsix] Error: No .vsix file found to smoke test.');
  process.exit(1);
}

console.log(`[smoke-vsix] Smoke testing VSIX: ${vsixPath}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-smoke-'));
const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-smoke-brain-'));
let client;

try {
  // 1. Unzip to temp folder
  execFileSync('tar', ['-xf', vsixPath, '-C', tempDir]);
  const serverPath = path.join(tempDir, 'extension', 'out', 'mcp-server', 'index.js');

  if (!fs.existsSync(serverPath)) {
    throw new Error(`Server entrypoint not found at ${serverPath}`);
  }

  // Confirm NO node_modules exists in the unzipped extension
  const nodeModulesPath = path.join(tempDir, 'extension', 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    throw new Error('node_modules found in extension package (should be bundled)');
  }

  console.log('[smoke-vsix] Starting bundled MCP server via stdio transport...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      ...process.env,
      ORBIT_BRAIN_DIR: tempBrainDir,
      HOME: tempDir,
      USERPROFILE: tempDir,
    },
  });

  client = new Client({ name: 'smoke-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  console.log('[smoke-vsix] Calling tools/list...');
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map(t => t.name);

  console.log(`[smoke-vsix] Registered tools: ${toolNames.join(', ')}`);

  const expectedTools = ['orbit_planner', 'write_impact_report', 'orbit_memory'];
  for (const expected of expectedTools) {
    if (!toolNames.includes(expected)) {
      throw new Error(`Expected tool '${expected}' missing from server`);
    }
  }

} catch (error) {
  console.error('[smoke-vsix] Smoke test FAILED:', error);
  process.exitCode = 1;
} finally {
  try {
    await client?.close();
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.promises.rm(tempBrainDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

if (!process.exitCode) {
  console.log('[smoke-vsix] Smoke test PASSED: Bundled server functions with zero external dependencies!');
}
