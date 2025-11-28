const esbuild = require('esbuild');
const { glob } = require('glob');
const path = require('path');

// Find all node and credential files
const entryPoints = glob.sync('./{nodes,credentials}/**/*.ts');

console.log('Building nodes using esbuild...');

esbuild.build({
    entryPoints,
    bundle: true,
    platform: 'node',
    target: 'node18',
    outdir: 'dist',
    format: 'cjs',           // CRITICAL: Forces CommonJS output for n8n
    external: ['n8n-workflow'],
    sourcemap: true,
    logLevel: 'info',
}).catch(() => process.exit(1));