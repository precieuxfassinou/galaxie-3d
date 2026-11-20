import esbuild from 'esbuild';

/*
 * Galaxie 3D n'utilise que le moteur de forces d3 et les contrôles « orbit ».
 * Les autres modules embarqués par 3d-force-graph ne servent jamais, mais ils déclenchent
 * des alertes de sécurité : ngraph.forcelayout génère du code avec new Function, et
 * ArcballControls copie et colle son état dans le presse-papiers. On les remplace par des
 * modules vides, pour que le fichier publié ne contienne ni l'un ni l'autre.
 */
const UNUSED = {
  'ngraph.forcelayout': 'export default function () { throw new Error("ngraph engine is not bundled"); }',
  'three/addons/controls/ArcballControls.js': 'export class ArcballControls { constructor() { throw new Error("not bundled"); } }',
  'three/addons/controls/TrackballControls.js': 'export class TrackballControls { constructor() { throw new Error("not bundled"); } }',
  'three/addons/controls/FlyControls.js': 'export class FlyControls { constructor() { throw new Error("not bundled"); } }',
};
const stubUnused = {
  name: 'stub-unused',
  setup(build) {
    const filter = new RegExp('^(' + Object.keys(UNUSED).map(k => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') + ')$');
    build.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub-unused' }));
    build.onLoad({ filter: /.*/, namespace: 'stub-unused' }, args => ({ contents: UNUSED[args.path], loader: 'js' }));
  },
};

await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'dist/main.js', format: 'cjs', target: 'es2020',
  platform: 'browser', minify: true, sourcemap: false, logLevel: 'info',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  plugins: [stubUnused],
});
