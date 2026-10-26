import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

// N-01: Wipe dist/ before packaging so stale or clashing builds never linger
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

console.log('\n[package-all] 0. Compiling production bundles...');
execSync('node esbuild.js --production', { cwd: rootDir, stdio: 'inherit' });

console.log('\n[package-all] 1. Packaging primary extension (Orbit 0.4.0)...');
const orbitVsix = path.join(distDir, 'orbit-0.4.0.vsix');
execSync(`npx @vscode/vsce package --no-dependencies -o "${orbitVsix}"`, { cwd: rootDir, stdio: 'inherit' });

console.log('\n[package-all] 2. Packaging legacy stub 1: antigravity-pre-execution-form-planner (0.2.7)...');
const stub1Dir = path.join(rootDir, 'legacy-stub');
const stub1Vsix = path.join(distDir, 'antigravity-pre-execution-form-planner-0.2.7.vsix');
execSync(`npx @vscode/vsce package --no-dependencies -o "${stub1Vsix}"`, { cwd: stub1Dir, stdio: 'inherit' });

console.log('\n[package-all] 3. Packaging legacy stub 2: antigravity-interactive-form-planner-planning-tool (0.2.7)...');
const stub2Dir = path.join(rootDir, 'legacy-stub-interactive');
const stub2Vsix = path.join(distDir, 'antigravity-interactive-form-planner-planning-tool-0.2.7.vsix');
execSync(`npx @vscode/vsce package --no-dependencies -o "${stub2Vsix}"`, { cwd: stub2Dir, stdio: 'inherit' });

console.log('\n[package-all] 4. Verifying primary Orbit VSIX...');
execSync(`node scripts/check-vsix.mjs "${orbitVsix}"`, { cwd: rootDir, stdio: 'inherit' });
execSync(`node scripts/smoke-vsix.mjs "${orbitVsix}"`, { cwd: rootDir, stdio: 'inherit' });

console.log('\n[package-all] 5. Verifying legacy stub packages (N-05)...');
function verifyStubVsix(vsixPath, expectedName) {
  const allowedFiles = new Set([
    'package.json',
    'extension.js',
    'license.txt',
    'readme.md',
  ]);

  const rawList = execFileSync('tar', ['-tf', vsixPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(l => l.trim().replace(/\\/g, '/'))
    .filter(Boolean);

  const packageFiles = rawList
    .filter(p => !p.endsWith('/') && !p.endsWith('[Content_Types].xml') && !p.endsWith('extension.vsixmanifest'))
    .map(p => p.startsWith('extension/') ? p.slice('extension/'.length) : p);

  console.log(`[check-stub] ${path.basename(vsixPath)}: contains ${packageFiles.length} files: ${packageFiles.join(', ')}`);

  for (const file of packageFiles) {
    const lower = file.toLowerCase();
    if (!allowedFiles.has(lower)) {
      throw new Error(`[check-stub] Unexpected file in stub VSIX ${vsixPath}: ${file}`);
    }
    if (file.endsWith('.ts') || file.endsWith('.map')) {
      throw new Error(`[check-stub] Forbidden source/map file found in stub ${vsixPath}: ${file}`);
    }
  }

  if (!packageFiles.some(f => f.toLowerCase() === 'extension.js')) {
    throw new Error(`[check-stub] Missing extension.js in ${vsixPath}`);
  }
  if (!packageFiles.some(f => f.toLowerCase() === 'package.json')) {
    throw new Error(`[check-stub] Missing package.json in ${vsixPath}`);
  }
}

verifyStubVsix(stub1Vsix, 'antigravity-pre-execution-form-planner');
verifyStubVsix(stub2Vsix, 'antigravity-interactive-form-planner-planning-tool');
console.log('[check-stub] Both legacy stub VSIXs verified successfully (zero source/map leakage).');

console.log('\n[package-all] SUCCESS! Exactly 3 clean packages created and verified in dist/:');
const distFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.vsix'));
for (const file of distFiles) {
  const stat = fs.statSync(path.join(distDir, file));
  console.log(`  - ${file} (${(stat.size / 1024).toFixed(2)} KB)`);
}

if (distFiles.length !== 3) {
  throw new Error(`[package-all] Expected exactly 3 VSIX files in dist/, found ${distFiles.length}`);
}
