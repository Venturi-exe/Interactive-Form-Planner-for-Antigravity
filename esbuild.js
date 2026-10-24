const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');

const isProduction = process.argv.includes('--production');

const commonNodeConfig = {
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  define: {
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
    '__ORBIT_VERSION__': JSON.stringify(pkg.version),
    '__DEV__': isProduction ? 'false' : 'true',
  },
  logLevel: 'info',
};

async function buildAll() {
  try {
    console.log(`[esbuild] Building Orbit (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})...`);

    if (isProduction) {
      const outDir = path.join(__dirname, 'out');
      if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }

    // 1. Extension bundle
    console.log('[esbuild] Bundling extension...');
    await esbuild.build({
      ...commonNodeConfig,
      entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
      outfile: path.join(__dirname, 'out', 'extension.js'),
      external: ['vscode'],
    });

    // 2. Standalone MCP Server bundle (inlining @modelcontextprotocol/sdk, zod, etc.)
    console.log('[esbuild] Bundling standalone MCP server...');
    await esbuild.build({
      ...commonNodeConfig,
      entryPoints: [path.join(__dirname, 'src', 'mcp-server', 'index.ts')],
      outfile: path.join(__dirname, 'out', 'mcp-server', 'index.js'),
      external: [],
    });

    // 3. Uninstall hook bundle
    console.log('[esbuild] Bundling uninstall hook...');
    await esbuild.build({
      ...commonNodeConfig,
      entryPoints: [path.join(__dirname, 'src', 'uninstall.ts')],
      outfile: path.join(__dirname, 'out', 'uninstall.js'),
      external: [],
    });

    // 4. Cartograph Webview bundle
    console.log('[esbuild] Bundling Cartograph webview...');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src', 'webview', 'cartograph-ui', 'index.tsx')],
      bundle: true,
      minify: isProduction,
      sourcemap: !isProduction,
      outfile: path.join(__dirname, 'src', 'webview', 'cartograph.js'),
      loader: {
        '.png': 'dataurl',
        '.svg': 'text',
      },
      define: {
        'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
        '__ORBIT_VERSION__': JSON.stringify(pkg.version),
        '__DEV__': isProduction ? 'false' : 'true',
      },
      logLevel: 'info',
    });

    // 5. Hub Webview bundle
    console.log('[esbuild] Bundling Cartograph Hub webview...');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src', 'webview', 'hub-ui', 'Hub.tsx')],
      bundle: true,
      minify: isProduction,
      sourcemap: !isProduction,
      outfile: path.join(__dirname, 'src', 'webview', 'hub.js'),
      loader: {
        '.png': 'dataurl',
        '.svg': 'text',
      },
      define: {
        'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
        '__ORBIT_VERSION__': JSON.stringify(pkg.version),
        '__DEV__': isProduction ? 'false' : 'true',
      },
      logLevel: 'info',
    });

    // 6. Legacy stub bundle
    console.log('[esbuild] Bundling legacy stub...');
    await esbuild.build({
      ...commonNodeConfig,
      entryPoints: [path.join(__dirname, 'legacy-stub', 'extension.ts')],
      outfile: path.join(__dirname, 'legacy-stub', 'extension.js'),
      external: ['vscode'],
    });

    console.log('[esbuild] Build finished successfully!');
  } catch (error) {
    console.error('[esbuild] Build failed:', error);
    process.exit(1);
  }
}

buildAll();
