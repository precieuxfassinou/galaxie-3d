/*
 * Nébuleuses de fond, gazeuses et filamenteuses.
 *
 * Le gaz est calculé par un shader de « bruit fractal à domaine déformé » (domain warping) : on déforme les
 * coordonnées avec le bruit lui-même avant de l'échantillonner, ce qui donne des volutes, des filaments étirés
 * et des bords déchiquetés au lieu de taches rondes. Des bandes de poussière sombre traversent le gaz, comme
 * sur les photos de nébuleuses.
 *
 * Ce calcul est lourd, donc il n'est fait qu'une seule fois : il est « cuit » dans une texture de ciel (cubemap)
 * à l'ouverture de la vue, puis affiché comme fond de scène. Ensuite il ne coûte presque rien à chaque image.
 */
import type * as Three from 'three';

type ThreeLib = Pick<typeof Three, 'BackSide' | 'CubeCamera' | 'Mesh' | 'Scene' | 'ShaderMaterial' | 'SphereGeometry' | 'WebGLCubeRenderTarget' | 'HalfFloatType'>;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uSeed;
uniform float uGain;

// Bruit de valeur 3D lissé (hash sans texture)
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419) + uSeed);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = ROT * p * 2.03; a *= 0.5; }
  return s;
}
// Bruit « en crête » : lignes fines et brillantes, pour les filaments ionisés
float ridged(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); s += a * n * n; p = ROT * p * 2.1; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 p = d * 2.2;

  // Déformation du domaine en deux étages : q déforme p, r déforme p + q
  vec3 q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(1.7, 9.2, 4.1)));
  vec3 r = vec3(fbm(p + 2.8 * q + vec3(8.3, 2.8, 1.1)), fbm(p + 2.8 * q + vec3(2.4, 7.1, 5.5)), 0.0);
  float gas = fbm(p + 2.6 * r.xyy);

  // Le gaz se regroupe en quelques grandes régions séparées par du vide, un peu plus présentes près de la
  // bande galactique inclinée
  float tilt = 0.49;
  float band = d.y * cos(tilt) + d.z * sin(tilt);
  float nearBand = exp(-band * band * 5.0);
  float region = smoothstep(0.46, 0.70, fbm(d * 1.15 + vec3(3.1, 0.7, 6.3)) + 0.08 * nearBand);
  float density = pow(smoothstep(0.34, 0.92, gas), 1.7) * region;

  // Chaque région a sa teinte : rose-magenta (hydrogène), bleu-cyan (oxygène), violet
  float h1 = smoothstep(0.38, 0.62, fbm(d * 0.9 + vec3(7.7, 2.2, 0.4)));
  float h2 = smoothstep(0.45, 0.70, fbm(d * 1.4 + vec3(1.9, 5.5, 8.8)));
  vec3 pink   = vec3(0.95, 0.28, 0.55);
  vec3 teal   = vec3(0.16, 0.55, 0.90);
  vec3 violet = vec3(0.50, 0.24, 0.85);
  vec3 hue = mix(mix(pink, teal, h1), violet, h2 * 0.65);
  // Variation interne : zones profondes plus sombres et froides, coeurs presque blancs
  vec3 col = mix(hue * vec3(0.35, 0.35, 0.55), hue, smoothstep(0.2, 0.8, length(q) * 0.75));
  col = mix(col, vec3(1.0, 0.86, 0.92), pow(density, 3.0) * 0.55);

  // Filaments brillants qui soulignent les volutes
  float fil = pow(ridged(p * 1.6 + 2.0 * q), 3.0);
  vec3 emission = col * density + hue * fil * density * 0.4;

  // Poussière sombre : bandes opaques qui mangent la lumière du gaz
  float dust = smoothstep(0.50, 0.68, fbm(p * 1.8 + 2.5 * r.xyy + vec3(4.4)));
  emission *= 1.0 - 0.9 * dust;

  // Lueur diffuse et poussiéreuse de la bande galactique
  emission += vec3(0.16, 0.14, 0.24) * nearBand * smoothstep(0.3, 0.8, fbm(p * 2.5)) * 0.25 * (1.0 - 0.7 * dust);

  // Fond très sombre teinté, jamais noir pur
  vec3 base = vec3(0.012, 0.014, 0.035);
  // Valeurs pensées en sRGB, converties en linéaire : le rendu final les reconvertit pour l'écran
  gl_FragColor = vec4(pow(base + emission * uGain, vec3(2.2)), 1.0);
}`;

export interface Nebula {
  texture: Three.Texture;
  /** Résolu quand les 6 faces sont calculées. */
  ready: Promise<void>;
  dispose(): void;
}

/**
 * Calcule le fond de nébuleuses dans une cubemap, une face par image : le calcul complet prend environ une
 * demi-seconde sur une puce graphique intégrée, réparti ainsi il ne fige jamais l'affichage.
 * `size` : résolution d'une face.
 */
export function bakeNebula(lib: ThreeLib, renderer: Three.WebGLRenderer, size = 1024, seed = 0.37, gain = 1.8): Nebula {
  const target = new lib.WebGLCubeRenderTarget(size, { type: lib.HalfFloatType });   // précision des tons sombres : pas de paliers
  const scene = new lib.Scene();
  const geo = new lib.SphereGeometry(10, 64, 32);
  const mat = new lib.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: lib.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uSeed: { value: seed }, uGain: { value: gain } },
  });
  scene.add(new lib.Mesh(geo, mat));
  const cube = new lib.CubeCamera(1, 100, target);
  cube.updateMatrixWorld();
  if (cube.coordinateSystem !== renderer.coordinateSystem) {
    cube.coordinateSystem = renderer.coordinateSystem;
    cube.updateCoordinateSystem();
  }
  const faces = cube.children as Three.Camera[];

  let disposed = false;
  const cleanup = () => { geo.dispose(); mat.dispose(); };
  const ready = new Promise<void>((resolve, reject) => {
    let face = 0;
    const step = () => {
      if (disposed) { cleanup(); reject(new Error('disposed')); return; }
      try {
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(target, face);
        renderer.render(scene, faces[face]);
        renderer.setRenderTarget(previous);
      } catch (e) { cleanup(); reject(e instanceof Error ? e : new Error(String(e))); return; }
      face++;
      if (face < 6) window.requestAnimationFrame(step);
      else { cleanup(); resolve(); }
    };
    window.requestAnimationFrame(step);
  });
  return { texture: target.texture, ready, dispose: () => { disposed = true; target.dispose(); } };
}
