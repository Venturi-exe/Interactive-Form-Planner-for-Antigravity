const { execSync } = require('child_process');
try {
  console.log("Packaging...");
  execSync('npx @vscode/vsce package --no-dependencies --no-yarn', { stdio: 'inherit' });
} catch (e) {
  console.error("Failed:", e.message);
}
