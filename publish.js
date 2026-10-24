/**
 * Orbit : Open VSX Publishing Pipeline.
 *
 * Enforces strict safety gates:
 * 1. Clean git tree check
 * 2. Exact release tag check (v<version>)
 * 3. Prepublish build (typecheck, lint, test, esbuild)
 * 4. Packaging to dist/<name>-<version>.vsix
 * 5. check-vsix (manifest allowlist + privacy scan)
 * 6. smoke-vsix (standalone bundled server verification)
 * 7. Publishing to Open VSX using OVSX_PAT from environment (token never passed via CLI args)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const version = pkg.version;
const packageName = pkg.name;
const vsixName = `${packageName}-${version}.vsix`;
const vsixPath = path.join(__dirname, 'dist', vsixName);

function logStep(stepNum, description) {
  console.log(`\n[publish] [Step ${stepNum}/7] ${description}...`);
}

function runCommand(command, args, options = {}) {
  const displayArgs = args.map(arg => {
    if (process.env.OVSX_PAT && arg.includes(process.env.OVSX_PAT)) {
      return arg.replace(process.env.OVSX_PAT, '***');
    }
    return arg;
  });
  console.log(`> ${command} ${displayArgs.join(' ')}`);

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname,
    ...options,
  });

  if (result.status !== 0) {
    console.error(`\n[publish] ERROR: Command failed with exit code ${result.status}`);
    process.exit(1);
  }
}

// 1. Working tree must be clean
logStep(1, 'Verifying working tree is clean');
const statusRes = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: __dirname });
if (statusRes.stdout && statusRes.stdout.trim().length > 0) {
  console.error('[publish] ERROR: Working tree is not clean. Commit or stash all changes before publishing.');
  process.exit(1);
}
console.log('Working tree is clean.');

// 2. git describe --exact-match must equal v<version>
logStep(2, `Verifying git release tag matches v${version}`);
const tagRes = spawnSync('git', ['describe', '--exact-match', '--tags'], { encoding: 'utf8', cwd: __dirname });
const currentTag = tagRes.stdout ? tagRes.stdout.trim() : '';
if (tagRes.status !== 0 || currentTag !== `v${version}`) {
  console.warn(`[publish] Note: Current commit is tagged as '${currentTag}', expected 'v${version}'.`);
  if (!process.argv.includes('--allow-untagged')) {
    console.error(`[publish] ERROR: Commit must be tagged with exact tag 'v${version}'. Use --allow-untagged to bypass in dry run.`);
    process.exit(1);
  }
}

// 3. Prepublish build (typecheck, lint, test, esbuild)
logStep(3, 'Running vscode:prepublish');
runCommand('npm', ['run', 'vscode:prepublish']);

// 4. Package to dist/
logStep(4, 'Packaging VSIX to dist/');
if (!fs.existsSync(path.join(__dirname, 'dist'))) {
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
}
runCommand('npx', ['@vscode/vsce', 'package', '--no-dependencies', '-o', vsixPath]);

// 5. check-vsix (manifest allowlist + privacy scan)
logStep(5, 'Running VSIX manifest and privacy checks');
runCommand('node', ['scripts/check-vsix.mjs', vsixPath]);

// 6. smoke-vsix (standalone bundled server verification)
logStep(6, 'Running VSIX standalone smoke test');
runCommand('node', ['scripts/smoke-vsix.mjs', vsixPath]);

// 7. Publish to Open VSX
logStep(7, 'Publishing to Open VSX');
const pat = process.env.OVSX_PAT;

if (!pat) {
  console.log('[publish] OVSX_PAT not set in environment. Packaging and verification passed (dry run complete).');
  process.exit(0);
}

// Check if version already exists on Open VSX
const checkRes = spawnSync('npx', ['ovsx', 'get', `${pkg.publisher}.${packageName}`, '--extensionVersion', version], { encoding: 'utf8' });
if (checkRes.status === 0) {
  console.log(`[publish] Version ${version} already published to Open VSX. Skipping upload.`);
  process.exit(0);
}

// Publish using OVSX_PAT in process environment (never exposed as CLI argument)
runCommand('npx', ['ovsx', 'publish', vsixPath], {
  env: {
    ...process.env,
    OVSX_PAT: pat,
  },
});

console.log(`\n[publish] Successfully published ${vsixName} to Open VSX!`);
