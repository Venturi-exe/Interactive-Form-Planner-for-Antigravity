const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const token = process.env.OVSX_TOKEN;
const version = pkg.version;
const originalName = pkg.name;

// Add any legacy IDs you want to keep updated here
const LEGACY_IDS = [
    "antigravity-pre-execution-form-planner",
    "antigravity-alignment"
];

function run(cmd) {
    console.log(`Running: ${cmd}`);
    try {
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        console.error(`Error running ${cmd}:`, e.message);
    }
}

function updatePackageName(newName) {
    const pkgContent = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    pkgContent.name = newName;
    fs.writeFileSync('./package.json', JSON.stringify(pkgContent, null, 2));
}

// 1. GitHub Push (Using original name)
run('git add .');
run(`git commit -m "release: v${version}"`);
run('git push --force origin main');

// 2. Publish New Version
console.log(`\n--- Publishing New Version: ${originalName} ---`);
run('npm run package');
if (token) {
    run(`npx ovsx publish ${originalName}-${version}.vsix -p ${token}`);
}

// 3. Publish Legacy Versions
for (const legacyId of LEGACY_IDS) {
    console.log(`\n--- Publishing Legacy Version: ${legacyId} ---`);
    try {
        updatePackageName(legacyId);
        run('npx @vscode/vsce package --no-dependencies');
        if (token) {
            run(`npx ovsx publish ${legacyId}-${version}.vsix -p ${token}`);
        }
    } finally {
        // Always restore original name
        updatePackageName(originalName);
    }
}

console.log("\n✅ Dual publishing complete.");
