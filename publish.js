const { execSync } = require('child_process');
const token = process.env.OVSX_TOKEN;

function run(cmd) {
    console.log(`Running: ${cmd}`);
    try {
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        console.error(`Error running ${cmd}:`, e.message);
    }
}

// 0. Build & Package
run('npm run package');

// 1. GitHub Push
run('git add .');
run('git commit -m "Update README with demo videos and reprioritize installation instructions"');
run('git push --force origin main');

// 2. Open VSX Publish
if (token) {
    run(`npx ovsx publish antigravity-pre-execution-form-planner-0.1.5.vsix -p ${token}`);
} else {
    console.error("No token provided. Skipping publish.");
}
