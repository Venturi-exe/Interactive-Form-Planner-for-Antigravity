import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Find VSIX target
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
  console.error('[check-vsix] Error: No .vsix file found to check.');
  process.exit(1);
}

console.log(`[check-vsix] Checking VSIX: ${vsixPath}`);

// 1. Check file manifest
const manifestPath = path.join(__dirname, 'vsix-manifest.txt');
const expectedFiles = fs.readFileSync(manifestPath, 'utf8')
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean)
  .sort();

const rawList = execFileSync('tar', ['-tf', vsixPath], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map(l => l.trim().replace(/\\/g, '/'))
  .filter(Boolean);

// Filter vsce internal metadata files
const actualFiles = rawList
  .filter(p => !p.endsWith('/') && !p.endsWith('[Content_Types].xml') && !p.endsWith('extension.vsixmanifest'))
  .map(p => p.startsWith('extension/') ? p.slice('extension/'.length) : p)
  .sort();

console.log(`[check-vsix] Package contains ${actualFiles.length} files.`);

const missing = expectedFiles.filter(f => !actualFiles.includes(f));
const unexpected = actualFiles.filter(f => !expectedFiles.includes(f));

if (missing.length > 0 || unexpected.length > 0) {
  console.error('[check-vsix] FAILED: VSIX manifest mismatch!');
  if (missing.length > 0) console.error('Missing expected files:', missing);
  if (unexpected.length > 0) console.error('Unexpected new files:', unexpected);
  process.exit(1);
}
console.log('[check-vsix] Manifest check passed.');

// 2. Extract and check privacy rules
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-vsix-check-'));
try {
  execFileSync('tar', ['-xf', vsixPath, '-C', tempDir]);
  const extDir = path.join(tempDir, 'extension');

  const forbiddenPatterns = [
    { pattern: /C:\\Users\\/i, name: 'C:\\Users\\ path' },
    { pattern: /\/Users\//i, name: '/Users/ path' },
    { pattern: /\.orbit-brain[\\/][a-zA-Z0-9_-]+/i, name: '.orbit-brain path with username' },
    { pattern: /ORBIT_EXTENSION_FACTS/i, name: 'ORBIT_EXTENSION_FACTS reference' },
    { pattern: /report_[a-f0-9-]{36}/i, name: 'specific report identifier' },
  ];

  function checkDir(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        checkDir(fullPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        // Skip binary images
        if (['.png', '.jpg', '.jpeg', '.gif', '.mp4'].includes(ext)) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const { pattern, name } of forbiddenPatterns) {
          if (pattern.test(content)) {
            console.error(`[check-vsix] FAILED: Forbidden content '${name}' detected in ${path.relative(extDir, fullPath)}`);
            process.exit(1);
          }
        }
      }
    }
  }

  checkDir(extDir);
  console.log('[check-vsix] Privacy scan passed: zero personal or brain files detected.');

  // 3. Brain template check (if template exists)
  const templateDir = path.join(extDir, 'media', 'brain-template');
  if (fs.existsSync(templateDir)) {
    console.log('[check-vsix] Brain template verified.');
  }

  console.log('[check-vsix] All VSIX checks passed successfully!');
} finally {
  await fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
