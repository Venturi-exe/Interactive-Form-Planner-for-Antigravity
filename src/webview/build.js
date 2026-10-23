const esbuild = require('esbuild');
const path = require('path');

async function build() {
  try {
    console.log('Bundling Orbit Cartograph React Webview...');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'cartograph-ui', 'index.tsx')],
      bundle: true,
      minify: true,
      sourcemap: true,
      outfile: path.join(__dirname, 'cartograph.js'),
      loader: {
        '.png': 'dataurl',
        '.svg': 'text',
      },
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'info',
    });

    console.log('Bundling Orbit Cartograph Hub React Webview...');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'hub-ui', 'Hub.tsx')],
      bundle: true,
      minify: true,
      sourcemap: true,
      outfile: path.join(__dirname, 'hub.js'),
      loader: {
        '.png': 'dataurl',
        '.svg': 'text',
      },
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'info',
    });

    console.log('Bundling Orbit Quota React Webview...');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'quota-ui', 'Quota.tsx')],
      bundle: true,
      minify: true,
      sourcemap: true,
      outfile: path.join(__dirname, 'quota.js'),
      loader: {
        '.png': 'dataurl',
        '.svg': 'text',
      },
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'info',
    });

    console.log('Bundling complete!');
  } catch (error) {
    console.error('Bundling failed:', error);
    process.exit(1);
  }
}

build();


