import { LoadAssetContainerAsync, TransformNode, Vector3, type AnimationGroup, type AssetContainer, type Mesh, type Scene } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';
import type { Fighter } from './fighter';

const BASE = import.meta.env.BASE_URL;

export type BeastKind = 'wolf' | 'bull';
export const BEAST_KINDS: BeastKind[] = ['wolf', 'bull'];

/** Werte der Tiere */
export const BEAST: Record<
  BeastKind,
  { name: string; hp: number; run: number; walk: number; reach: number; dmg: number; windup: number; cd: [number, number]; height: number; radius: number }
> = {
  wolf: { name: 'Wolf', hp: 55, run: 6.4, walk: 2.4, reach: 1.7, dmg: 9, windup: 0.42, cd: [1.1, 2.1], height: 0.9, radius: 0.45 },
  bull: { name: 'Stier', hp: 150, run: 9.5, walk: 2.6, reach: 2.2, dmg: 30, windup: 0.5, cd: [2.2, 3.6], height: 1.6, radius: 0.85 },
};

/** Logische Bewegungen -> Namen im Modell */
const CLIPS: Record<BeastKind, Record<string, string>> = {
  wolf: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', hit: 'Idle_HitReact_Left', death: 'Death', paw: 'Idle_2_HeadLow' },
  bull: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack_Headbutt', hit: 'Idle_HitReact_Left', death: 'Death', paw: 'Idle_Headlow' },
};

let loading: Promise<Map<BeastKind, AssetContainer>> | null = null;
let ready: Map<BeastKind, AssetContainer> | null = null;

/** Tiermodelle laden (einmal, erst wenn sie gebraucht werden) */
export function loadBeasts(scene: Scene): Promise<Map<BeastKind, AssetContainer>> {
  if (!loading) {
    MeshoptCompression.Configuration = { decoder: { url: `${BASE}vendor/meshopt_decoder.js` } };
    loading = Promise.all(BEAST_KINDS.map((k) => LoadAssetContainerAsync(`${BASE}assets/${k}.glb`, scene))).then((list) => {
      const m = new Map<BeastKind, AssetContainer>();
      list.forEach((c, i) => {
        for (const g of c.animationGroups) g.stop();
        for (const mat of c.materials) {
          // Flache Farben etwas matter und dunkler, passend zum Sand und Licht der Arena
          const pm = mat as unknown as { roughness?: number; metallic?: number };
          if ('roughness' in pm) pm.roughness = 0.92;
          if ('metallic' in pm) pm.metallic = 0;
        }
        m.set(BEAST_KINDS[i], c);
      });
      ready = m;
      return m;
    });
  }
  return loading;
}

export function beastsReady(): boolean {
  return ready !== null;
}

const scaleOf = new Map<BeastKind, number>();
let nextId = 1;

export type BeastMode = 'enter' | 'hunt' | 'windup' | 'charge' | 'stun' | 'hit' | 'dead' | 'leave' | 'gone';
export const MODE_CODES: BeastMode[] = ['enter', 'hunt', 'windup', 'charge', 'stun', 'hit', 'dead', 'leave', 'gone'];

/**
 * Ein Tier in der Arena (Wolf oder Stier). Die Regeln stehen in life.ts, hier nur Figur und Bewegungen.
 */
export class Beast {
  readonly id: number;
  readonly holder: TransformNode;
  private groups = new Map<string, AnimationGroup>();
  private cur = '';
  hp: number;
  hpMax: number;
  /** Stärke (Venatio-Stufe): Schaden mal diesem Wert */
  dmgMul = 1;
  mode: BeastMode = 'enter';
  modeUntil = 0;
  target: Fighter | null = null;
  heading = 0;
  vel = new Vector3();
  nextAttack = 0;
  nextRetarget = 0;
  chargeDir = new Vector3(0, 0, 1);
  chargeHit = new Set<Fighter>();
  impactAt = 0;
  struck = false;
  strafe = Math.random() < 0.5 ? 1 : -1;
  backoffUntil = 0;
  /** Gast: Zielposition aus dem Schnappschuss */
  netPos: Vector3 | null = null;

  constructor(
    readonly kind: BeastKind,
    scene: Scene,
    container: AssetContainer,
    caster: ((m: Mesh) => void) | null,
    id?: number,
  ) {
    this.id = id ?? nextId++;
    if (id !== undefined) nextId = Math.max(nextId, id + 1);
    this.hp = BEAST[kind].hp;
    this.hpMax = this.hp;
    this.holder = new TransformNode(`beast-${kind}-${this.id}`, scene);
    const inst = container.instantiateModelsToScene((n) => `${n}-${this.id}`, false, { doNotInstantiate: true });
    for (const r of inst.rootNodes) r.parent = this.holder;
    for (const g of inst.animationGroups) {
      const name = g.name.replace(`-${this.id}`, '').replace(/^Clone of /, '');
      for (const ta of g.targetedAnimations) {
        ta.animation.enableBlending = true;
        ta.animation.blendingSpeed = 0.12;
      }
      this.groups.set(name, g);
    }
    for (const m of this.holder.getChildMeshes()) {
      m.receiveShadows = true;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      caster?.(m as Mesh);
    }
    // Größe einmal pro Art messen und auf die gewünschte Schulterhöhe bringen
    let s = scaleOf.get(kind);
    if (s === undefined) {
      this.holder.computeWorldMatrix(true);
      const { min, max } = this.holder.getHierarchyBoundingVectors(true);
      const h = Math.max(0.01, max.y - min.y);
      s = BEAST[kind].height / h;
      scaleOf.set(kind, s);
    }
    this.holder.scaling.setAll(s);
    this.play('idle');
  }

  get pos(): Vector3 {
    return this.holder.position;
  }

  get alive(): boolean {
    return this.mode !== 'dead' && this.mode !== 'gone';
  }

  setHeading(h: number): void {
    this.heading = h;
    this.holder.rotation.y = h;
  }

  /** Bewegung abspielen (logischer Name: idle, walk, run, attack, hit, death, paw) */
  play(logical: string, loop = true, speed = 1): void {
    const clip = CLIPS[this.kind][logical] ?? logical;
    const g = this.groups.get(clip);
    if (!g) return;
    if (this.cur === clip && g.isPlaying) {
      g.speedRatio = speed;
      return;
    }
    for (const [n, o] of this.groups) if (n !== clip) o.stop();
    this.cur = clip;
    g.start(loop, speed, g.from, g.to, false);
  }

  get clip(): string {
    return this.cur;
  }

  dispose(): void {
    for (const g of this.groups.values()) {
      g.stop();
      g.dispose();
    }
    this.holder.dispose(false, false);
    this.mode = 'gone';
  }
}
