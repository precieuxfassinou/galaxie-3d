import esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'dist/main.js', format: 'cjs', target: 'es2020',
  platform: 'browser', minify: true, sourcemap: false, logLevel: 'info',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
});
