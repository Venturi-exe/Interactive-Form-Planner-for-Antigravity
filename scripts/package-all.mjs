import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('\n[package-all] 1. Packaging primary extension (Orbit 0.4.0)...');
const orbitVsix = path.join(distDir, 'orbit-0.4.0.vsix');
execSync(`npx @vscode/vsce package --no-dependencies -o "${orbitVsix}"`, { cwd: rootDir, stdio: 'inherit' });

console.log('\n[package-all] 3. Packaging legacy stub 1: antigravity-pre-execution-form-planner (0.2.7)...');
const stub1Dir = path.join(rootDir, 'legacy-stub');
const stub1Vsix = path.join(distDir, 'antigravity-pre-execution-form-planner-0.2.7.vsix');
execSync(`npx @vscode/vsce package --no-dependencies -o "${stub1Vsix}"`, { cwd: stub1Dir, stdio: 'inherit' });

console.log('\n[package-all] 4. Packaging legacy stub 2: antigravity-interactive-form-planner-planning-tool (0.2.7)...');
const stub2Dir = path.join(rootDir, 'legacy-stub-interactive');
const stub2Vsix = path.join(distDir, 'antigravity-interactive-form-planner-planning-tool-0.2.7.vsix');
execSync(`npx @vscode/vsce package --no-dependencies -o "${stub2Vsix}"`, { cwd: stub2Dir, stdio: 'inherit' });

console.log('\n[package-all] 5. Verifying primary Orbit VSIX...');
execSync(`node scripts/check-vsix.mjs "${orbitVsix}"`, { cwd: rootDir, stdio: 'inherit' });
execSync(`node scripts/smoke-vsix.mjs "${orbitVsix}"`, { cwd: rootDir, stdio: 'inherit' });

console.log('\n[package-all] SUCCESS! All 3 packages created and verified in dist/:');
for (const file of fs.readdirSync(distDir)) {
  if (file.endsWith('.vsix')) {
    const stat = fs.statSync(path.join(distDir, file));
    console.log(`  - ${file} (${(stat.size / 1024).toFixed(2)} KB)`);
  }
}
