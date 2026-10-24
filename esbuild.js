const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

const commonNodeConfig = {
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  bundle: true,
  mainFields: ['module', 'main'],
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
    console.log(`[esbuild] Building Orbit (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}${isWatch ? ' - WATCH MODE' : ''})...`);

    if (isProduction) {
      const outDir = path.join(__dirname, 'out');
      if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }

    const configs = [
      // 1. Extension bundle
      {
        ...commonNodeConfig,
        entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
        outfile: path.join(__dirname, 'out', 'extension.js'),
        external: ['vscode'],
      },
      // 2. Standalone MCP Server bundle
      {
        ...commonNodeConfig,
        entryPoints: [path.join(__dirname, 'src', 'mcp-server', 'index.ts')],
        outfile: path.join(__dirname, 'out', 'mcp-server', 'index.js'),
        external: [],
      },
      // 3. Uninstall hook bundle
      {
        ...commonNodeConfig,
        entryPoints: [path.join(__dirname, 'src', 'uninstall.ts')],
        outfile: path.join(__dirname, 'out', 'uninstall.js'),
        external: [],
      },
      // 4. Cartograph Webview bundle
      {
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
      },
      // 5. Hub Webview bundle
      {
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
      },
      // 6. Legacy stub 1 (antigravity-pre-execution-form-planner)
      {
        ...commonNodeConfig,
        sourcemap: false,
        entryPoints: [path.join(__dirname, 'legacy-stub', 'extension.ts')],
        outfile: path.join(__dirname, 'legacy-stub', 'extension.js'),
        external: ['vscode'],
      },
      // 7. Legacy stub 2 (antigravity-interactive-form-planner-planning-tool)
      {
        ...commonNodeConfig,
        sourcemap: false,
        entryPoints: [path.join(__dirname, 'legacy-stub', 'extension.ts')],
        outfile: path.join(__dirname, 'legacy-stub-interactive', 'extension.js'),
        external: ['vscode'],
      },
    ];

    if (isWatch) {
      console.log('[esbuild] Initializing watch contexts...');
      const contexts = await Promise.all(configs.map(cfg => esbuild.context(cfg)));
      await Promise.all(contexts.map(ctx => ctx.watch()));
      console.log('[esbuild] Watching for file changes...');
      return;
    }

    for (const cfg of configs) {
      await esbuild.build(cfg);
    }

    console.log('[esbuild] Build finished successfully!');
  } catch (error) {
    console.error('[esbuild] Build failed:', error);
    process.exit(1);
  }
}

buildAll();
