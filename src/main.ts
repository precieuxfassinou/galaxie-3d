import { App, ItemView, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, debounce, getAllTags, moment, type SettingDefinitionItem } from 'obsidian';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import SpriteText from 'three-spritetext';

/* Langue de l'interface : celle d'Obsidian (français ou anglais). */
function pickLang(setting?: string): boolean {
  if (setting === 'fr') return true;
  if (setting === 'en') return false;
  // Obsidian règle la langue de moment sur celle de son interface
  return (moment.locale() || 'en').toLowerCase().startsWith('fr');
}
let FR = pickLang();
const TFR = {
  open: 'Ouvrir la galaxie 3D', rotate: 'Rotation automatique', fit: 'Recentrer', tags: 'Afficher les tags',
  help: 'Clic : centrer · Double-clic ou Ctrl+clic : ouvrir · Glisser : tourner · Molette : zoom',
  root: 'Racine', openNote: 'Ouvrir la note', notes: 'notes', links: 'liens', link: 'lien', search: 'Chercher une note…',
  bloom: 'Intensité du halo', bloomDesc: '0 = aucun halo, 1,5 = très lumineux', showTags: 'Afficher les tags',
  orphans: 'Afficher les notes isolées', particles: 'Particules sur les liens', particlesDesc: 'Sur les liens de la note survolée ou sélectionnée',
  labels: 'Noms toujours visibles', labelsDesc: 'Nombre de notes les plus reliées dont le nom reste affiché',
  language: 'Langue', languageDesc: 'Automatique : celle d\'Obsidian. Recharge le plugin après un changement.', auto: 'Automatique',
};
const TEN: typeof TFR = {
  open: 'Open 3D galaxy', rotate: 'Auto-rotate', fit: 'Re-center', tags: 'Show tags',
  help: 'Click: focus · Double-click or Ctrl+click: open · Drag: rotate · Wheel: zoom',
  root: 'Root', openNote: 'Open note', notes: 'notes', links: 'links', link: 'link', search: 'Search a note…',
  bloom: 'Glow intensity', bloomDesc: '0 = no glow, 1.5 = very bright', showTags: 'Show tags',
  orphans: 'Show orphan notes', particles: 'Particles on links', particlesDesc: 'On the links of the hovered or selected note',
  labels: 'Always-visible names', labelsDesc: 'How many of the most linked notes keep their name displayed',
  language: 'Language', languageDesc: 'Automatic: Obsidian\'s language. Reload the plugin after a change.', auto: 'Automatic',
};
let T = FR ? TFR : TEN;


const VIEW_TYPE = 'galaxie-3d-view';

/* ---------------------------------------------------------------- réglages */

interface GalaxieSettings {
  version: number;
  bloom: number;          // intensité du halo
  showTags: boolean;
  showOrphans: boolean;
  autoRotate: boolean;
  hubLabels: number;      // nombre de notes les plus reliées qui gardent leur nom affiché
  particles: boolean;     // particules qui circulent sur les liens de la note survolée
  hiddenGroups: string[];
  language: 'auto' | 'fr' | 'en';
}

const DEFAULTS: GalaxieSettings = {
  version: 3, bloom: 0.55, showTags: false, showOrphans: true, autoRotate: true, hubLabels: 18, particles: true, hiddenGroups: [], language: 'auto',
};

/* Palette vive, lisible sur fond sombre et flatteuse avec le halo */
const PALETTE = ['#4CC9F0', '#F72585', '#FFD166', '#06D6A0', '#9D4EDD', '#FF8C42', '#3A86FF',
  '#FF5D8F', '#B5E48C', '#00F5D4', '#FEE440', '#C77DFF', '#FF6B6B', '#48CAE4'];
const TAG_COLOR = '#39D353';
const ROOT_COLOR = '#E0E1DD';

/* ---------------------------------------------------------------- graphe */

/** Contrôles « orbit » de three.js, dans la partie qu'on utilise. */
interface Orbit { autoRotate: boolean; autoRotateSpeed: number; addEventListener?(type: string, fn: () => void): void }

interface GNode {
  id: string; name: string; kind: 'note' | 'tag'; group: string; deg: number;
  x?: number; y?: number; z?: number;
  __mat?: THREE.MeshBasicMaterial; __halo?: THREE.SpriteMaterial; __label?: SpriteText;
  __hub?: boolean; __baseOpacity?: number; __baseHalo?: number;
}
interface GLink { source: string | GNode; target: string | GNode; group: string }

function topFolder(path: string): string {
  const i = path.indexOf('/');
  return i === -1 ? '/' : path.slice(0, i);
}

function buildGraph(app: App, s: GalaxieSettings) {
  const nodes = new Map<string, GNode>();
  for (const f of app.vault.getMarkdownFiles()) {
    nodes.set(f.path, { id: f.path, name: f.basename, kind: 'note', group: topFolder(f.path), deg: 0 });
  }
  const links: GLink[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, group: string) => {
    if (a === b) return;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source: a, target: b, group });
    nodes.get(a)!.deg++; nodes.get(b)!.deg++;
  };
  const resolved = app.metadataCache.resolvedLinks;
  for (const src in resolved) {
    if (!nodes.has(src)) continue;
    for (const dst in resolved[src]) if (nodes.has(dst)) add(src, dst, nodes.get(src)!.group);
  }
  if (s.showTags) {
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(f);
      const tags = cache ? getAllTags(cache) : null;
      for (const t of new Set(tags ?? [])) {
        const id = `tag:${t.toLowerCase()}`;
        if (!nodes.has(id)) nodes.set(id, { id, name: t, kind: 'tag', group: '#tags', deg: 0 });
        add(f.path, id, '#tags');
      }
    }
  }
  let list = [...nodes.values()];
  if (!s.showOrphans) list = list.filter(n => n.deg > 0);
  const keep = new Set(list.map(n => n.id));
  return { nodes: list, links: links.filter(l => keep.has(l.source as string) && keep.has(l.target as string)) };
}

function colorMap(nodes: GNode[]): Map<string, string> {
  const groups = [...new Set(nodes.filter(n => n.kind === 'note').map(n => n.group))].sort((a, b) => a.localeCompare(b));
  const m = new Map<string, string>();
  let i = 0;
  for (const g of groups) m.set(g, g === '/' ? ROOT_COLOR : PALETTE[i++ % PALETTE.length]);
  m.set('#tags', TAG_COLOR);
  return m;
}

const idOf = (end: string | GNode) => (typeof end === 'string' ? end : end.id);

/* ---------------------------------------------------------------- vue */

class GalaxieView extends ItemView {
  private graph?: ForceGraph3DInstance;
  private bloom?: UnrealBloomPass;
  private resizeObs?: ResizeObserver;
  private visObs?: IntersectionObserver;
  private linkLayer?: LinkLayer;
  private signature = '';
  private colors = new Map<string, string>();
  private neighbors = new Map<string, Set<string>>();
  private hovered: GNode | null = null;
  private selected: GNode | null = null;
  private lastClick = { id: '', t: 0 };
  private data: { nodes: GNode[]; links: GLink[] } = { nodes: [], links: [] };
  private byId = new Map<string, GNode>();
  private legendEl!: HTMLElement;
  private infoEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: GalaxiePlugin) { super(leaf); }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Galaxie 3D'; }
  getIcon() { return 'orbit'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('galaxie-root');
    const stage = root.createDiv({ cls: 'galaxie-stage' });
    this.buildHud(root);

    const g = new ForceGraph3D(stage, { controlType: 'orbit' });
    this.graph = g;
    // Horodatage des VRAIS clics de souris : onNodeClick arrive avec un retard variable (~250 ms),
    // on ne peut donc pas mesurer un double-clic avec l'heure de onNodeClick.
    stage.addEventListener('click', () => { this.domClicks = [this.domClicks[1], performance.now()]; }, true);
    g.backgroundColor('#05060d')
      .showNavInfo(false)
      .nodeLabel((n: object) => {
        const node = n as GNode;
        return `<div class="galaxie-tip"><b>${escapeHtml(node.name)}</b><span>${escapeHtml(node.kind === 'tag' ? 'tag' : node.group)} · ${node.deg} lien${node.deg > 1 ? 's' : ''}</span></div>`;
      })
      .nodeThreeObject((n: object) => this.makeNode(n as GNode))
      // Les liens servent à la simulation mais ne sont pas dessinés un par un (2 000 objets = 2 000 appels
      // de dessin) : LinkLayer les dessine tous en UN seul objet.
      .linkVisibility(false)
      .nodeVisibility((n: object) => !this.plugin.settings.hiddenGroups.includes((n as GNode).group))
      .onNodeHover((n: object | null) => { this.hovered = n as GNode | null; stage.style.cursor = n ? 'pointer' : 'grab'; this.paint(); })
      .onNodeClick((n: object, ev: MouseEvent) => this.onClick(n as GNode, ev))
      .onBackgroundClick(() => {
        if (Date.now() - this.lastClick.t < 1500 && this.isDoubleGap()) {
          // 2e clic d'un double-clic qui a raté la sphère : on ouvre quand même la note visée
          const n = this.byId.get(this.lastClick.id);
          if (n && n.kind === 'note') this.openNote(n);
          return;
        }
        this.selected = null; this.paint(); this.updateInfo();
      })
      .enableNodeDrag(false)             // glisser = toujours tourner la vue
      .warmupTicks(80)
      .cooldownTicks(250)
      .d3AlphaDecay(0.035)                 // la mise en place se stabilise plus vite
      .onEngineTick(() => this.linkLayer?.syncPositions());

    (g.d3Force('charge') as unknown as { strength?(f: (n: GNode) => number): void } | undefined)?.strength?.((n: GNode) => (n.kind === 'tag' ? -20 : -180));
    (g.d3Force('link') as unknown as { distance?(f: (l: GLink) => number): void } | undefined)?.distance?.((l: GLink) => (l.group === '#tags' ? 18 : 80));

    // Fond opaque (sinon le thème d'Obsidian transparaît) + étoiles
    g.scene().background = new THREE.Color('#05060d');
    g.scene().add(makeStars(2600, 2200));
    this.linkLayer = new LinkLayer(g.scene(), (end) => (typeof end === 'string' ? this.byId.get(end) : end));
    // Résolution plafonnée : sur un écran haute densité, le rendu coûtait 2 à 4 fois plus cher
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    g.renderer().setPixelRatio(ratio);
    g.postProcessingComposer().setPixelRatio(ratio);

    // Halo (bloom)
    // Halo global doux. Pleine résolution : à mi-résolution, les petits points scintillaient en tournant.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.plugin.settings.bloom, 0.3, 0.6);
    g.postProcessingComposer().addPass(this.bloom);
    g.postProcessingComposer().addPass(new OutputPass());   // conversion en sRGB : couleurs justes et vives
    // Anticrénelage (MSAA) sur les tampons du rendu avec halo : sans lui, les bords des sphères
    // et des étoiles « clignotent » d'un pixel à l'autre pendant la rotation.
    const comp = g.postProcessingComposer() as unknown as { renderTarget1?: { samples: number; dispose(): void }; renderTarget2?: { samples: number; dispose(): void } };
    for (const rt of [comp.renderTarget1, comp.renderTarget2]) {
      if (rt) { rt.samples = 4; rt.dispose(); }
    }

    // Rotation automatique qui s'arrête dès qu'on touche la vue
    const controls = g.controls() as unknown as Orbit;
    controls.autoRotate = this.plugin.settings.autoRotate;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener?.('start', () => { controls.autoRotate = false; });
    // La rotation se met en pause dès que la souris survole la galaxie : on vise une note immobile.
    stage.addEventListener('pointerenter', () => { controls.autoRotate = false; });
    stage.addEventListener('pointerleave', () => {
      controls.autoRotate = this.plugin.settings.autoRotate && !this.selected;
    });

    // Taille
    this.resizeObs = new ResizeObserver(() => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (w && h) g.width(w).height(h);
    });
    this.resizeObs.observe(stage);

    // Onglet caché ou fenêtre réduite : on arrête complètement le rendu 3D
    this.visObs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) g.resumeAnimation(); else g.pauseAnimation();
    });
    this.visObs.observe(stage);

    this.refresh();
    let framed = false;
    g.onEngineStop(() => { this.linkLayer?.syncPositions(); if (!framed) { framed = true; this.fit(1200); } });

    // Mise à jour quand le vault change
    const refreshSoon = debounce(() => this.refresh(), 1500, true);
    this.registerEvent(this.app.metadataCache.on('resolved', refreshSoon));
    this.registerEvent(this.app.vault.on('rename', refreshSoon));
    this.registerEvent(this.app.vault.on('delete', refreshSoon));
  }

  async onClose() {
    this.resizeObs?.disconnect();
    this.visObs?.disconnect();
    this.graph?._destructor();
    this.graph = undefined;
    this.contentEl.empty();
  }

  /* ---------- données */

  refresh() {
    if (!this.graph) return;
    // Conserver les positions déjà calculées pour éviter que tout « explose » à chaque mise à jour
    const prev = new Map(this.data.nodes.map(n => [n.id, n]));
    const next = buildGraph(this.app, this.plugin.settings);
    // Le vault émet « resolved » à chaque frappe : sans changement de structure, on ne touche à rien
    const sig = `${this.plugin.settings.hubLabels}|${next.nodes.map(n => n.id).join('\u0001')}|${next.links.map(l => `${idOf(l.source)}>${idOf(l.target)}`).join('\u0001')}`;
    if (sig === this.signature) return;
    this.signature = sig;
    for (const n of next.nodes) {
      const p = prev.get(n.id);
      if (p) { n.x = p.x; n.y = p.y; n.z = p.z; }
    }
    this.data = next;
    this.byId = new Map(next.nodes.map(n => [n.id, n]));
    this.colors = colorMap(next.nodes);
    this.neighbors = new Map();
    for (const l of next.links) {
      const a = idOf(l.source), b = idOf(l.target);
      if (!this.neighbors.has(a)) this.neighbors.set(a, new Set());
      if (!this.neighbors.has(b)) this.neighbors.set(b, new Set());
      this.neighbors.get(a)!.add(b); this.neighbors.get(b)!.add(a);
    }
    // Les notes les plus reliées gardent leur nom affiché
    const hubs = new Set([...next.nodes].filter(n => n.kind === 'note').sort((a, b) => b.deg - a.deg)
      .slice(0, this.plugin.settings.hubLabels).map(n => n.id));
    for (const n of next.nodes) n.__hub = hubs.has(n.id);
    this.graph.graphData(next);
    this.linkLayer?.setLinks(this.visibleLinks(), (l) => this.colors.get(l.group) ?? '#8888aa');
    this.paint();
    this.renderLegend();
    this.updateInfo();
  }

  /* ---------- rendu des nœuds */

  private radius(n: GNode) {
    return n.kind === 'tag' ? 1.4 + Math.sqrt(n.deg) * 0.3 : 3 + Math.sqrt(n.deg) * 1.0;
  }

  private makeNode(n: GNode): THREE.Object3D {
    const color = new THREE.Color(this.colors.get(n.group) ?? '#ffffff');
    const group = new THREE.Group();
    const r = this.radius(n);

    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: n.kind === 'tag' ? 0.85 : 0.95 });
    n.__baseOpacity = n.kind === 'tag' ? 0.85 : 0.95;
    // Géométrie partagée par toutes les notes, mise à l'échelle : 1 géométrie au lieu de 800
    const mesh = new THREE.Mesh(n.kind === 'tag' ? OCTA : SPHERE, mat);
    mesh.scale.setScalar(r);
    group.add(mesh);
    n.__mat = mat;

    // Halo additif, réservé aux notes bien reliées (le bloom suffit pour les autres)
    if (n.kind === 'note' && n.deg >= 6) {
      const baseHalo = 0.09;
      const halo = new THREE.SpriteMaterial({ map: haloTexture(), color, transparent: true, opacity: baseHalo,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const sprite = new THREE.Sprite(halo);
      sprite.raycast = () => {};            // le halo ne capte pas la souris : seule la sphère est cliquable
      sprite.scale.setScalar(r * 2.2);
      n.__baseHalo = baseHalo;
      group.add(sprite);
      n.__halo = halo;
    }

    if (n.__hub) {
      const label = new SpriteText(n.name, 6, '#c9cdf0');
      label.fontFace = 'Inter, Segoe UI, sans-serif';
      label.fontWeight = '600';
      label.backgroundColor = 'rgba(5,6,13,0.55)';
      label.padding = 1.5;
      label.borderRadius = 2;
      (label.material).depthWrite = false;
      (label.material).opacity = 0.8;
      label.raycast = () => {};
      label.position.set(0, r + 5, 0);
      group.add(label);
      n.__label = label;
    }
    return group;
  }

  private focusSet(): Set<string> | null {
    const f = this.hovered ?? this.selected;
    if (!f) return null;
    const s = new Set(this.neighbors.get(f.id) ?? []);
    s.add(f.id);
    return s;
  }

  private isActiveLink(l: GLink): boolean {
    const f = this.hovered ?? this.selected;
    return !!f && (idOf(l.source) === f.id || idOf(l.target) === f.id);
  }

  /** Liens dont aucune extrémité n'est dans un dossier masqué. */
  private visibleLinks(): GLink[] {
    const h = this.plugin.settings.hiddenGroups;
    if (!h.length) return this.data.links;
    return this.data.links.filter(l => {
      const a = this.byId.get(idOf(l.source)), b = this.byId.get(idOf(l.target));
      return !(a && h.includes(a.group)) && !(b && h.includes(b.group));
    });
  }

  /** Met en valeur la note survolée/sélectionnée et ses voisines, estompe le reste. */
  private paint() {
    const focus = this.focusSet();
    for (const n of this.data.nodes) {
      if (!n.__mat) continue;
      const on = !focus || focus.has(n.id);
      const isFocus = !!focus && (this.hovered?.id === n.id || this.selected?.id === n.id);
      n.__mat.opacity = on ? (focus ? 0.85 : n.__baseOpacity ?? 0.95) : 0.08;
      if (n.__halo) n.__halo.opacity = on ? (isFocus ? 0.13 : focus ? 0.08 : n.__baseHalo ?? 0.09) : 0.01;
      if (n.__label) (n.__label.material).opacity = on ? 0.8 : 0.1;
    }
    // Plus aucune reconstruction d'objets au survol : on ne change que des couleurs dans un tampon
    const f = this.hovered ?? this.selected;
    this.linkLayer?.setFocus(f ? this.visibleLinks().filter(l => this.isActiveLink(l)) : null, this.plugin.settings.particles);
  }

  /* ---------- interactions */

  private flyTimer: number | null = null;

  private domClicks: [number, number] = [0, 0];

  /** Vrai si les deux derniers clics de souris sont assez rapprochés pour former un double-clic. */
  private isDoubleGap() {
    return this.domClicks[1] - this.domClicks[0] < 650;
  }

  private onClick(n: GNode, ev: MouseEvent) {
    const now = Date.now();
    const double = this.lastClick.id === n.id && now - this.lastClick.t < 1500 && this.isDoubleGap();
    this.lastClick = { id: n.id, t: now };
    if ((double || ev.ctrlKey || ev.metaKey) && n.kind === 'note') {
      this.openNote(n);
      return;
    }
    // Sélection immédiate, mais le vol de la caméra attend : sinon la note bouge
    // sous la souris et le second clic d'un double-clic tombe à côté.
    this.selected = n;
    this.paint();
    this.updateInfo();
    if (this.flyTimer) window.clearTimeout(this.flyTimer);
    this.flyTimer = window.setTimeout(() => { this.flyTimer = null; this.flyTo(n); }, 450);
  }

  private lastOpen = { id: '', t: 0 };

  private openNote(n: GNode) {
    if (this.flyTimer) { window.clearTimeout(this.flyTimer); this.flyTimer = null; }
    const now = Date.now();
    if (this.lastOpen.id === n.id && now - this.lastOpen.t < 1500) return;   // clic de lien + dblclick natif : une seule ouverture
    this.lastOpen = { id: n.id, t: now };
    void this.app.workspace.openLinkText(n.id, '', 'tab');
  }

  /** Cadre toutes les notes visibles : distance calculée à partir de leur rayon d'encombrement. */
  fit(ms: number) {
    const g = this.graph;
    if (!g) return;
    const hidden = this.plugin.settings.hiddenGroups;
    const pts = this.data.nodes.filter(n => n.x !== undefined && !hidden.includes(n.group));
    if (!pts.length) return;
    const c = { x: 0, y: 0, z: 0 };
    for (const n of pts) { c.x += n.x!; c.y += n.y!; c.z += n.z!; }
    c.x /= pts.length; c.y /= pts.length; c.z /= pts.length;
    // rayon qui contient 95 % des notes (une note isolée très loin ne doit pas tout rapetisser)
    const d = pts.map(n => Math.hypot(n.x! - c.x, n.y! - c.y, n.z! - c.z)).sort((a, b) => a - b);
    const r = Math.max(40, d[Math.floor(d.length * 0.95)] ?? 40);
    const cam = g.camera() as THREE.PerspectiveCamera;
    const fov = (cam.fov * Math.PI) / 180;
    const aspect = Math.min(1, cam.aspect || 1);
    const dist = (r / Math.sin(Math.atan(Math.tan(fov / 2) * aspect))) * 1.05;
    g.cameraPosition({ x: c.x, y: c.y, z: c.z + dist }, c, ms);
  }

  private flyTo(n: GNode) {
    if (!this.graph || n.x === undefined) return;
    const dist = 110 + this.radius(n) * 12;
    const ratio = 1 + dist / Math.max(1, Math.hypot(n.x, n.y!, n.z!));
    (this.graph.controls() as unknown as Orbit).autoRotate = false;
    this.syncButtons();
    this.graph.cameraPosition({ x: n.x * ratio, y: n.y! * ratio, z: n.z! * ratio }, { x: n.x, y: n.y!, z: n.z! }, 1400);
  }

  /* ---------- interface superposée */

  private buildHud(root: HTMLElement) {
    const top = root.createDiv({ cls: 'galaxie-hud galaxie-top' });
    const search = top.createEl('input', { type: 'search', placeholder: T.search, cls: 'galaxie-search' });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = search.value.trim().toLowerCase();
      if (!q) return;
      const hits = this.data.nodes.filter(n => n.name.toLowerCase().includes(q))
        .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? -1 : 0) - (b.name.toLowerCase().startsWith(q) ? -1 : 0) || b.deg - a.deg);
      const n = hits[0];
      if (n) { this.selected = n; this.flyTo(n); this.paint(); this.updateInfo(); }
    });

    const btns = top.createDiv({ cls: 'galaxie-buttons' });
    const mk = (label: string, title: string, fn: () => void, key: string) => {
      const b = btns.createEl('button', { text: label, cls: 'galaxie-btn', attr: { 'aria-label': title, 'data-key': key } });
      b.addEventListener('click', fn);
      return b;
    };
    mk('⟳', T.rotate, () => {
      const c = this.graph?.controls() as unknown as Orbit | undefined;
      if (!c) return;
      this.plugin.settings.autoRotate = !this.plugin.settings.autoRotate;
      c.autoRotate = false;            // la souris est sur le bouton, donc sur la vue : reprise en la quittant
      void this.plugin.saveSettings();
      this.syncButtons();
    }, 'rotate');
    mk('◎', T.fit, () => { this.selected = null; this.paint(); this.updateInfo(); this.fit(900); }, 'fit');
    mk('#', T.tags, () => {
      this.plugin.settings.showTags = !this.plugin.settings.showTags;
      void this.plugin.saveSettings(); this.refresh(); this.syncButtons();
    }, 'tags');

    this.legendEl = root.createDiv({ cls: 'galaxie-hud galaxie-legend' });
    this.infoEl = root.createDiv({ cls: 'galaxie-hud galaxie-info' });
    root.createDiv({ cls: 'galaxie-hud galaxie-help', text: T.help });
  }

  private syncButtons() {
    this.contentEl.querySelector('[data-key="rotate"]')?.toggleClass('is-on', this.plugin.settings.autoRotate);
    this.contentEl.querySelector('[data-key="tags"]')?.toggleClass('is-on', this.plugin.settings.showTags);
  }

  private renderLegend() {
    this.legendEl.empty();
    const counts = new Map<string, number>();
    for (const n of this.data.nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    const hidden = this.plugin.settings.hiddenGroups;
    for (const [group, color] of this.colors) {
      if (!counts.has(group)) continue;
      const row = this.legendEl.createDiv({ cls: 'galaxie-legend-row' + (hidden.includes(group) ? ' is-off' : '') });
      const dot = row.createSpan({ cls: 'galaxie-dot' });
      dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}`;
      row.createSpan({ text: group === '/' ? T.root : group === '#tags' ? 'Tags' : group, cls: 'galaxie-legend-name' });
      row.createSpan({ text: String(counts.get(group)), cls: 'galaxie-legend-count' });
      row.addEventListener('click', () => {
        const h = this.plugin.settings.hiddenGroups;
        this.plugin.settings.hiddenGroups = h.includes(group) ? h.filter(x => x !== group) : [...h, group];
        void this.plugin.saveSettings();
        const g = this.graph!;
        g.nodeVisibility(g.nodeVisibility());
        this.linkLayer?.setLinks(this.visibleLinks(), (l) => this.colors.get(l.group) ?? '#8888aa');
        this.paint();
        this.renderLegend();
      });
    }
    this.syncButtons();
  }

  private updateInfo() {
    this.infoEl.empty();
    const n = this.selected;
    const notes = this.data.nodes.filter(x => x.kind === 'note').length;
    if (!n) {
      this.infoEl.createDiv({ cls: 'galaxie-info-title', text: `${notes} ${T.notes} · ${this.data.links.length} ${T.links}` });
      return;
    }
    this.infoEl.createDiv({ cls: 'galaxie-info-title', text: n.name });
    this.infoEl.createDiv({ cls: 'galaxie-info-sub', text: `${n.kind === 'tag' ? 'Tag' : n.group} · ${n.deg} ${n.deg > 1 ? T.links : T.link}` });
    if (n.kind === 'note') {
      const open = this.infoEl.createEl('button', { text: T.openNote, cls: 'galaxie-btn galaxie-open' });
      open.addEventListener('click', () => this.openNote(n));
    }
  }

  applyBloom() {
    if (this.bloom) this.bloom.strength = this.plugin.settings.bloom;
  }
}

/* ---------------------------------------------------------------- utilitaires 3D */

const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const OCTA = new THREE.OctahedronGeometry(1, 0);

type Resolve = (end: string | GNode) => GNode | undefined;

/**
 * Tous les liens en UN objet (LineSegments), plus une couche « liens actifs » et des étincelles
 * qui circulent dessus. Le survol ne fait que réécrire des couleurs : aucun objet n'est recréé.
 */
class LinkLayer {
  private base: THREE.LineSegments;
  private active: THREE.LineSegments;
  private sparks: THREE.Points;
  private links: GLink[] = [];
  private baseColors = new Float32Array(0);
  private activeLinks: GLink[] = [];
  private activeColors: THREE.Color[] = [];
  private showSparks = true;
  private static SPARKS_PER_LINK = 3;

  constructor(scene: THREE.Scene, private resolve: Resolve) {
    const lineMat = (opacity: number) => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
    this.base = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0.42));
    this.active = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0.95));
    this.sparks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      size: 2.6, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, map: haloTexture(), blending: THREE.AdditiveBlending,
    }));
    for (const o of [this.base, this.active, this.sparks]) {
      o.frustumCulled = false;
      o.raycast = () => {};
      scene.add(o);
    }
    // Animation des étincelles, seulement quand la scène est effectivement dessinée
    this.sparks.onBeforeRender = () => this.animate();
  }

  setLinks(links: GLink[], colorOf: (l: GLink) => string) {
    this.links = links;
    const pos = new Float32Array(links.length * 6);
    this.baseColors = new Float32Array(links.length * 6);
    const c = new THREE.Color();
    links.forEach((l, i) => {
      c.set(dim(colorOf(l), 0.26));
      this.baseColors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    const geo = this.base.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.baseColors.slice(), 3));
    this.activeColors = links.map(l => new THREE.Color(colorOf(l)));
    this.syncPositions();
    this.setFocus(null, this.showSparks);
  }

  /** Recopie les positions des notes dans le tampon (pendant que la mise en place bouge). */
  syncPositions() {
    const attr = this.base.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const a = attr.array as Float32Array;
    this.links.forEach((l, i) => {
      const s = this.resolve(l.source), t = this.resolve(l.target);
      if (!s || !t || s.x === undefined || t.x === undefined) return;
      a[i * 6] = s.x!; a[i * 6 + 1] = s.y!; a[i * 6 + 2] = s.z!;
      a[i * 6 + 3] = t.x!; a[i * 6 + 4] = t.y!; a[i * 6 + 5] = t.z!;
    });
    attr.needsUpdate = true;
    this.writeActive();
  }

  setFocus(active: GLink[] | null, sparks: boolean) {
    this.showSparks = sparks;
    const col = this.base.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (col) {
      const a = col.array as Float32Array;
      const k = active ? 0.18 : 1;                 // estompe tout le reste quand une note est en avant
      for (let i = 0; i < a.length; i++) a[i] = this.baseColors[i] * k;
      col.needsUpdate = true;
    }
    this.activeLinks = active ?? [];
    const n = this.activeLinks.length;
    this.active.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const ac = new Float32Array(n * 6);
    const idx = new Map(this.links.map((l, i) => [l, i]));
    this.activeLinks.forEach((l, i) => {
      const c = this.activeColors[idx.get(l) ?? 0] ?? new THREE.Color('#ffffff');
      ac.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    this.active.geometry.setAttribute('color', new THREE.BufferAttribute(ac, 3));
    const m = sparks ? n * LinkLayer.SPARKS_PER_LINK : 0;
    this.sparks.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 3), 3));
    const sc = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) sc.set([ac[Math.floor(i / LinkLayer.SPARKS_PER_LINK) * 6], ac[Math.floor(i / LinkLayer.SPARKS_PER_LINK) * 6 + 1], ac[Math.floor(i / LinkLayer.SPARKS_PER_LINK) * 6 + 2]], i * 3);
    this.sparks.geometry.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.writeActive();
  }

  private writeActive() {
    const attr = this.active.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr || !this.activeLinks.length) return;
    const a = attr.array as Float32Array;
    this.activeLinks.forEach((l, i) => {
      const s = this.resolve(l.source), t = this.resolve(l.target);
      if (!s || !t || s.x === undefined || t.x === undefined) return;
      a.set([s.x, s.y!, s.z!, t.x, t.y!, t.z!], i * 6);
    });
    attr.needsUpdate = true;
  }

  private animate() {
    if (!this.showSparks || !this.activeLinks.length) return;
    const attr = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const a = attr.array as Float32Array;
    const time = performance.now() / 1000;
    const per = LinkLayer.SPARKS_PER_LINK;
    this.activeLinks.forEach((l, i) => {
      const s = this.resolve(l.source), t = this.resolve(l.target);
      if (!s || !t || s.x === undefined || t.x === undefined) return;
      for (let j = 0; j < per; j++) {
        const f = (time * 0.45 + j / per + i * 0.137) % 1;
        a.set([s.x + (t.x - s.x) * f, s.y! + (t.y! - s.y!) * f, s.z! + (t.z! - s.z!) * f], (i * per + j) * 3);
      }
    });
    attr.needsUpdate = true;
  }
}

let _halo: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (_halo) return _halo;
  const size = 128;
  const c = createEl('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  _halo = new THREE.CanvasTexture(c);
  return _halo;
}

function makeStars(count: number, radius: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tints = [new THREE.Color('#ffffff'), new THREE.Color('#a9c7ff'), new THREE.Color('#ffd6a5'), new THREE.Color('#d0b3ff')];
  for (let i = 0; i < count; i++) {
    // répartition uniforme sur une coquille épaisse
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
    const r = radius * (0.6 + Math.random() * 0.4);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
    const t = tints[i % tints.length];
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false });
  const stars = new THREE.Points(geo, mat);
  stars.raycast = () => {};
  return stars;
}

/** Assombrit une couleur vers le fond (k = part de la couleur conservée). */
function dim(hex: string, k: number): string {
  const c = new THREE.Color(hex).lerp(new THREE.Color('#05060d'), 1 - k);
  return `#${c.getHexString()}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/* ---------------------------------------------------------------- plugin */

export default class GalaxiePlugin extends Plugin {
  settings: GalaxieSettings = { ...DEFAULTS };

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new GalaxieView(leaf, this));
    this.addRibbonIcon('orbit', T.open, () => void this.open());
    this.addCommand({ id: 'open', name: T.open, callback: () => void this.open() });
    this.addSettingTab(new GalaxieSettingTab(this.app, this));
  }

  async open() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) { await this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  views(): GalaxieView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter((v): v is GalaxieView => v instanceof GalaxieView);
  }

  async loadSettings() {
    const saved = ((await this.loadData()) ?? {}) as Partial<GalaxieSettings>;
    this.settings = { ...DEFAULTS, ...saved };
    FR = pickLang(this.settings.language);
    T = FR ? TFR : TEN;
    if ((saved.version ?? 1) < 3) {            // v3 : halo doux par défaut
      this.settings.bloom = DEFAULTS.bloom;
      this.settings.version = 3;
      await this.saveSettings();
    }
  }
  async saveSettings() { await this.saveData(this.settings); }
}

class GalaxieSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GalaxiePlugin) { super(app, plugin); }

  // Declarative settings (Obsidian 1.13+: searchable). display() below stays for older versions.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: T.language, desc: T.languageDesc, control: { type: 'dropdown', key: 'language', options: { auto: T.auto, fr: 'Français', en: 'English' } } },
      { name: T.bloom, desc: T.bloomDesc, control: { type: 'slider', key: 'bloom', min: 0, max: 1.5, step: 0.05 } },
      { name: T.showTags, control: { type: 'toggle', key: 'showTags' } },
      { name: T.orphans, control: { type: 'toggle', key: 'showOrphans' } },
      { name: T.particles, desc: T.particlesDesc, control: { type: 'toggle', key: 'particles' } },
      { name: T.labels, desc: T.labelsDesc, control: { type: 'slider', key: 'hubLabels', min: 0, max: 60, step: 1 } },
    ];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case 'language': if (value === 'auto' || value === 'fr' || value === 'en') s.language = value; break;
      case 'bloom': case 'hubLabels': if (typeof value === 'number' && Number.isFinite(value)) s[key] = value; break;
      case 'showTags': case 'showOrphans': case 'particles': s[key] = value === true; break;
      default: return;
    }
    await this.plugin.saveSettings();
    const rebuild = key === 'showTags' || key === 'showOrphans' || key === 'hubLabels';
    for (const v of this.plugin.views()) { if (rebuild) v.refresh(); else v.applyBloom(); }
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async (refresh = false) => {
      await this.plugin.saveSettings();
      for (const v of this.plugin.views()) refresh ? v.refresh() : v.applyBloom();
    };
    new Setting(containerEl).setName(T.language).setDesc(T.languageDesc).addDropdown(d => d
      .addOption('auto', T.auto).addOption('fr', 'Français').addOption('en', 'English').setValue(s.language)
      .onChange(async v => { s.language = v as GalaxieSettings['language']; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(T.bloom).setDesc(T.bloomDesc)
      .addSlider(sl => sl.setLimits(0, 1.5, 0.05).setValue(s.bloom).onChange(async v => { s.bloom = v; await save(); }));
    new Setting(containerEl).setName(T.showTags).addToggle(t => t.setValue(s.showTags).onChange(async v => { s.showTags = v; await save(true); }));
    new Setting(containerEl).setName(T.orphans).addToggle(t => t.setValue(s.showOrphans).onChange(async v => { s.showOrphans = v; await save(true); }));
    new Setting(containerEl).setName(T.particles).setDesc(T.particlesDesc)
      .addToggle(t => t.setValue(s.particles).onChange(async v => { s.particles = v; await save(); }));
    new Setting(containerEl).setName(T.labels).setDesc(T.labelsDesc)
      .addSlider(sl => sl.setLimits(0, 60, 1).setValue(s.hubLabels).onChange(async v => { s.hubLabels = v; await save(true); }));
  }
}
