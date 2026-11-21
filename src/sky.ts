/*
 * Ciel de fond de la galaxie : des étoiles de tailles et de luminosités variées (beaucoup de petites étoiles
 * pâles, quelques grosses très brillantes) et une bande plus dense façon Voie lactée. Tout tient en 4 nuages
 * de points, pour rester léger même sur une petite machine. Les nébuleuses sont dans nebula.ts.
 */
import type * as Three from 'three';

type ThreeLib = Pick<typeof Three, 'AdditiveBlending' | 'BufferAttribute' | 'BufferGeometry' | 'CanvasTexture' | 'Color' | 'Group' | 'NormalBlending' | 'Points' | 'PointsMaterial'>;

/** Générateur pseudo-aléatoire déterministe : le ciel reste le même d'une ouverture à l'autre. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Les 4 familles d'étoiles : part des étoiles, taille en pixels, luminosité min-max, halo rond ou non. */
export const STAR_TIERS = [
  { share: 0.66, size: 1.1, min: 0.18, max: 0.55, glow: false },   // poussière d'étoiles, très nombreuses et pâles
  { share: 0.25, size: 1.8, min: 0.35, max: 0.8, glow: false },    // petites étoiles
  { share: 0.07, size: 3.4, min: 0.55, max: 1.0, glow: true },     // étoiles moyennes, rondes et lumineuses
  { share: 0.02, size: 7, min: 0.8, max: 1.0, glow: true },        // quelques grosses étoiles brillantes
] as const;

/** Couleurs réelles des étoiles : bleu-blanc (chaudes), blanc, jaune, orange (froides). */
const STAR_TINTS = ['#ffffff', '#ffffff', '#cfe0ff', '#a9c7ff', '#fff4e0', '#ffd6a5', '#ffb38a'];

function softTexture(lib: ThreeLib, inner = 1): Three.CanvasTexture {
  const size = 64;
  const c = createEl('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(255,255,255,${inner})`);
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new lib.CanvasTexture(c);
}

/** Position d'une étoile : 40 % resserrées autour d'une bande inclinée (la « Voie lactée »), le reste partout. */
export function starPosition(rand: () => number, radius: number): [number, number, number] {
  const theta = 2 * Math.PI * rand();
  let lat: number;
  if (rand() < 0.4) {
    // latitude proche de 0 : distribution resserrée autour du plan de la bande
    const g = (rand() + rand() + rand() - 1.5) / 1.5;      // approximation d'une loi normale dans [-1, 1]
    lat = g * 0.22;
  } else {
    lat = Math.asin(2 * rand() - 1);                        // uniforme sur la sphère
  }
  const r = radius * (0.65 + rand() * 0.35);
  const x = r * Math.cos(lat) * Math.cos(theta), y = r * Math.sin(lat), z = r * Math.cos(lat) * Math.sin(theta);
  // bande inclinée de 28° pour éviter un trait parfaitement horizontal
  const a = 0.49;
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

export function makeSky(lib: ThreeLib, count: number, radius: number): Three.Group {
  const rand = rng(20261121);
  const sky = new lib.Group();
  const tint = new lib.Color();
  const glowTex = softTexture(lib);

  for (const tier of STAR_TIERS) {
    const n = Math.max(1, Math.round(count * tier.share));
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(starPosition(rand, radius), i * 3);
      // luminosité : la plupart des étoiles sont pâles, quelques-unes très brillantes (tirage au carré)
      const b = tier.min + (tier.max - tier.min) * rand() * rand();
      tint.set(STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)]);
      col[i * 3] = tint.r * b; col[i * 3 + 1] = tint.g * b; col[i * 3 + 2] = tint.b * b;
    }
    const geo = new lib.BufferGeometry();
    geo.setAttribute('position', new lib.BufferAttribute(pos, 3));
    geo.setAttribute('color', new lib.BufferAttribute(col, 3));
    const mat = new lib.PointsMaterial({
      size: tier.size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false,
      opacity: tier.glow ? 1 : 0.85,
      map: tier.glow ? glowTex : null,
      blending: tier.glow ? lib.AdditiveBlending : lib.NormalBlending,
    });
    const pts = new lib.Points(geo, mat);
    pts.raycast = () => {};
    pts.renderOrder = -10;
    sky.add(pts);
  }

  return sky;
}
