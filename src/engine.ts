// 3D engine, loaded on demand: three.js and 3d-force-graph are only evaluated when a Galaxie view opens,
// so they add nothing to Obsidian's startup time.
export { default as ForceGraph3D } from '3d-force-graph';
export * as THREE from 'three';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { default as SpriteText } from 'three-spritetext';
