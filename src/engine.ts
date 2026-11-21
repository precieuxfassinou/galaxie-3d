// 3D engine, loaded on demand: three.js and 3d-force-graph are only evaluated when a Galaxie view opens,
// so they add nothing to Obsidian's startup time.
export { default as ForceGraph3D } from '3d-force-graph';
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, Color, CubeCamera, Group, HalfFloatType, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, NormalBlending, OctahedronGeometry, Points, PointsMaterial, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector2, WebGLCubeRenderTarget } from 'three';
// Only the three.js classes Galaxie uses, so the bundle can drop the rest.
export const THREE = { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, Color, CubeCamera, Group, HalfFloatType, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, NormalBlending, OctahedronGeometry, Points, PointsMaterial, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector2, WebGLCubeRenderTarget };
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { default as SpriteText } from 'three-spritetext';
