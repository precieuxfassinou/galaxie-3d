// 3D engine, loaded on demand: three.js and 3d-force-graph are only evaluated when a Galaxie view opens,
// so they add nothing to Obsidian's startup time.
export { default as ForceGraph3D } from '3d-force-graph';
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OctahedronGeometry, Points, PointsMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector2 } from 'three';
// Only the three.js classes Galaxie uses, so the bundle can drop the rest.
export const THREE = { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OctahedronGeometry, Points, PointsMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector2 };
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { default as SpriteText } from 'three-spritetext';
