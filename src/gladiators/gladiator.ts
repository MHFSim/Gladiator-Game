import {
  AbstractMesh,
  AnimationGroup,
  AnimationGroupMask,
  AnimationGroupMaskMode,
  AssetContainer,
  LoadAssetContainerAsync,
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';
import '@babylonjs/loaders/glTF';
import type { Environment } from '../render/environment';
import {
  buildBelt,
  buildChestPlate,
  buildGalerus,
  buildGladius,
  buildGreave,
  buildHelmet,
  buildHelmetHoplomachus,
  buildHelmetProvocator,
  buildHelmetSecutor,
  buildHelmetThraex,
  buildManica,
  buildParma,
  buildParmula,
  buildProvocatorShield,
  buildScutum,
  buildSica,
  buildSpear,
  buildTrident,
  buildWraps,
  gearMaterials,
  type GearMaterials,
  type Team,
} from './gear';
import { CLASSES, type ClassId } from '../data/classes';

export type SeverPart = 'head' | 'armR' | 'armL' | 'legL' | 'legR';

/** Aussehen: Klasse und Seltenheit je Platz [Waffe, Schild, Helm, Arme, Beine] */
export interface Look {
  cls: ClassId;
  tiers: [number, number, number, number, number];
}

/** Metallfarben je Seltenheit: gewöhnlich, gut, selten, episch, legendär */
const TIER_COLORS = {
  bronze: [new Color3(0.42, 0.3, 0.17), new Color3(0.6, 0.36, 0.15), new Color3(0.66, 0.42, 0.18), new Color3(0.5, 0.3, 0.32), new Color3(0.88, 0.64, 0.22)],
  iron: [new Color3(0.5, 0.48, 0.46), new Color3(0.72, 0.72, 0.74), new Color3(0.78, 0.8, 0.86), new Color3(0.62, 0.6, 0.72), new Color3(0.92, 0.8, 0.5)],
};

const BASE = import.meta.env.BASE_URL;

export class GladiatorAssets {
  private constructor(
    readonly character: AssetContainer,
    readonly anims: AnimationGroup[],
  ) {}

  static async load(scene: Scene, progress: (p: number, label: string) => void): Promise<GladiatorAssets> {
    MeshoptCompression.Configuration = { decoder: { url: `${BASE}vendor/meshopt_decoder.js` } };
    // Alle drei Dateien gleichzeitig laden und Fortschritt in MB anzeigen
    const files = ['gladiator.glb', 'anims1.glb', 'anims2.glb'];
    const loaded = [0, 0, 0];
    const totals = [0.5e6, 3e6, 3.1e6];
    const show = () => {
      const l = loaded.reduce((a, b) => a + b, 0);
      const t = totals.reduce((a, b) => a + b, 0);
      progress(0.3 + 0.45 * Math.min(1, l / t), `Lade Gladiator und Bewegungen … ${(l / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)} MB`);
    };
    show();
    const [character, a1, a2] = await Promise.all(
      files.map((f, i) =>
        LoadAssetContainerAsync(`${BASE}assets/${f}`, scene, {
          onProgress: (ev) => {
            loaded[i] = ev.loaded;
            if (ev.lengthComputable && ev.total > 0) totals[i] = ev.total;
            show();
          },
        }),
      ),
    );
    progress(0.78, 'Bereite Figuren vor …');
    const anims = [...a1.animationGroups, ...a2.animationGroups];
    for (const g of anims) g.stop();
    return new GladiatorAssets(character, anims);
  }
}

/* ---------- Animations-Steuerung mit Ebenen ---------- */

interface ActionState {
  id: number;
  group: AnimationGroup;
  weight: number;
  elapsed: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  fading: boolean;
  events: { at: number; fn: () => void; done: boolean }[];
  onEnd?: () => void;
}

export interface PlayOptions {
  speed?: number;
  /** Ausschnitt der Animation in Sekunden [von, bis] */
  range?: [number, number];
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  /** Gesamtdauer in Sekunden überschreiben (wenn das Tempo unterwegs geändert wird) */
  duration?: number;
  /** Ereignisse bei einem Anteil (0..1) der Dauer */
  events?: { at: number; fn: () => void }[];
  onEnd?: () => void;
}

const LOCO: [string, number][] = [
  ['sword_idle', 0],
  ['walk', 1.4],
  ['jog', 3.4],
  ['sprint', 6.0],
];

let actionIds = 1;

/** Befehl an den Animator, übertragbar ans andere Handy */
export type AnimCmd =
  | { c: 'play'; id: number; name: string; speed: number; range?: [number, number]; duration?: number; fadeIn?: number; fadeOut?: number; loop?: boolean }
  | { c: 'cancel'; id: number; fade: number }
  | { c: 'speed'; id: number; speed: number }
  | { c: 'stop'; name: string }
  | { c: 'pause'; name: string }
  | { c: 'resume'; name: string };

export class Animator {
  private loco: AnimationGroup[] = [];
  private overlay: AnimationGroup;
  private actions: ActionState[] = [];
  private locoWeights = [1, 0, 0, 0];
  /** Gastgeber: jeder Befehl wird hier gemeldet */
  listener: ((cmd: AnimCmd) => void) | null = null;
  private remoteIds = new Map<number, number>();

  constructor(private readonly groups: Map<string, AnimationGroup>, leftArm: string[]) {
    const exclude = new AnimationGroupMask(leftArm, AnimationGroupMaskMode.Exclude);
    for (const [name] of LOCO) {
      const g = this.get(name);
      g.mask = exclude;
      g.start(true, 1);
      g.weight = name === 'sword_idle' ? 1 : 0;
      this.loco.push(g);
    }
    this.overlay = this.get('shield_idle');
    this.overlay.mask = new AnimationGroupMask(leftArm, AnimationGroupMaskMode.Include);
    this.overlay.start(true, 1);
    this.overlay.weight = 1;
  }

  get(name: string): AnimationGroup {
    const g = this.groups.get(name);
    if (!g) throw new Error('Animation fehlt: ' + name);
    return g;
  }

  fps(name: string): number {
    return this.get(name).targetedAnimations[0]?.animation.framePerSecond ?? 30;
  }

  durationOf(name: string, speed = 1, range?: [number, number]): number {
    const g = this.get(name);
    const len = range ? range[1] - range[0] : (g.to - g.from) / this.fps(name);
    return len / speed;
  }

  /** Fortbewegung: Geschwindigkeit in m/s, rückwärts spielt die Laufanimationen umgekehrt */
  setSpeed(s: number, backwards = false): void {
    const w = [0, 0, 0, 0];
    if (s <= 0.05) w[0] = 1;
    else {
      let placed = false;
      for (let i = 0; i < LOCO.length - 1; i++) {
        const a = LOCO[i][1];
        const b = LOCO[i + 1][1];
        if (s <= b) {
          const t = (s - a) / (b - a);
          w[i] = 1 - t;
          w[i + 1] = t;
          placed = true;
          break;
        }
      }
      if (!placed) w[3] = 1;
    }
    this.locoWeights = w;
    for (let i = 1; i < LOCO.length; i++) {
      const nominal = LOCO[i][1];
      const r = Math.min(1.5, Math.max(0.7, s / nominal));
      this.loco[i].speedRatio = backwards ? -r : r;
    }
  }

  /** Spielt eine Aktion über allem anderen. Gibt eine Kennung zurück, mit der sie abgebrochen werden kann. */
  play(name: string, opts: PlayOptions = {}): number {
    const g = this.get(name);
    for (const a of this.actions) a.fading = true;
    const speed = opts.speed ?? 1;
    const fps = this.fps(name);
    const from = opts.range ? g.from + opts.range[0] * fps : g.from;
    const to = opts.range ? g.from + opts.range[1] * fps : g.to;
    g.stop();
    g.start(true, speed, from, to);
    g.weight = 0;
    this.actions = this.actions.filter((a) => a.group !== g);
    const id = actionIds++;
    this.listener?.({ c: 'play', id, name, speed, range: opts.range, duration: opts.duration, fadeIn: opts.fadeIn, fadeOut: opts.fadeOut, loop: opts.loop });
    this.actions.push({
      id,
      group: g,
      weight: 0,
      elapsed: 0,
      duration: opts.duration ?? this.durationOf(name, speed, opts.range),
      fadeIn: opts.fadeIn ?? 0.1,
      fadeOut: opts.fadeOut ?? 0.15,
      loop: opts.loop ?? false,
      fading: false,
      events: (opts.events ?? []).map((e) => ({ ...e, done: false })),
      onEnd: opts.onEnd,
    });
    return id;
  }

  /** Bricht eine laufende Aktion ab (Finte, Unterbrechung). Ereignisse feuern nicht mehr. */
  cancel(id: number, fadeOut = 0.12): void {
    this.listener?.({ c: 'cancel', id, fade: fadeOut });
    for (const a of this.actions) {
      if (a.id === id) {
        a.fading = true;
        a.fadeOut = fadeOut;
        a.events = [];
        a.onEnd = undefined;
      }
    }
  }

  /** Beendet alle Aktionen einer Animation (z. B. eine Schleife) */
  stop(name: string): void {
    this.listener?.({ c: 'stop', name });
    for (const a of this.actions) if (a.group.name.startsWith(name + '#') || a.group.name === name) a.fading = true;
  }

  /** Tempo einer laufenden Aktion ändern (z. B. langsames Ausholen, schneller Schwung) */
  setActionSpeed(id: number, speed: number): void {
    this.listener?.({ c: 'speed', id, speed });
    for (const a of this.actions) if (a.id === id) a.group.speedRatio = speed;
  }

  pause(name: string): void {
    this.listener?.({ c: 'pause', name });
    this.get(name).pause();
  }

  resume(name: string): void {
    this.listener?.({ c: 'resume', name });
    this.get(name).play(false);
  }

  /** Gast: Befehl vom Gastgeber nachspielen */
  apply(cmd: AnimCmd): void {
    switch (cmd.c) {
      case 'play': {
        const local = this.play(cmd.name, { speed: cmd.speed, range: cmd.range, duration: cmd.duration, fadeIn: cmd.fadeIn, fadeOut: cmd.fadeOut, loop: cmd.loop });
        this.remoteIds.set(cmd.id, local);
        if (this.remoteIds.size > 64) this.remoteIds.delete(this.remoteIds.keys().next().value as number);
        break;
      }
      case 'cancel': {
        const id = this.remoteIds.get(cmd.id);
        if (id) this.cancel(id, cmd.fade);
        break;
      }
      case 'speed': {
        const id = this.remoteIds.get(cmd.id);
        if (id) this.setActionSpeed(id, cmd.speed);
        break;
      }
      case 'stop':
        this.stop(cmd.name);
        break;
      case 'pause':
        this.pause(cmd.name);
        break;
      case 'resume':
        this.resume(cmd.name);
        break;
    }
  }

  isPlaying(id: number): boolean {
    return this.actions.some((a) => a.id === id && !a.fading);
  }

  get busy(): boolean {
    return this.actions.some((a) => !a.fading);
  }

  update(dt: number): void {
    let total = 0;
    for (const a of this.actions) {
      a.elapsed += dt;
      for (const e of a.events) {
        if (!e.done && a.elapsed >= e.at * a.duration) {
          e.done = true;
          e.fn();
        }
      }
      if (!a.loop && !a.fading && a.elapsed >= a.duration - a.fadeOut) {
        a.fading = true;
        a.onEnd?.();
      }
      if (a.fading) a.weight = Math.max(0, a.weight - dt / a.fadeOut);
      else a.weight = Math.min(1, a.weight + dt / a.fadeIn);
    }
    for (const a of this.actions) {
      if (a.fading && a.weight <= 0) a.group.stop();
    }
    this.actions = this.actions.filter((a) => !(a.fading && a.weight <= 0));
    // Gewichte normalisieren, damit die Summe nie über 1 liegt
    for (const a of this.actions) total += a.weight;
    const scale = total > 1 ? 1 / total : 1;
    for (const a of this.actions) a.group.weight = a.weight * scale;
    const rest = Math.max(0, 1 - total * scale);
    for (let i = 0; i < this.loco.length; i++) this.loco[i].weight = this.locoWeights[i] * rest;
    this.overlay.weight = rest;
  }
}

/* ---------- Gladiator ---------- */

let counter = 0;

export class Gladiator {
  readonly root: TransformNode;
  readonly animator: Animator;
  readonly id: string;
  heading = 0; // Blickrichtung in Radiant (0 = +Z)
  hp = 100;
  stamina = 100;
  meshes: AbstractMesh[] = [];
  nodes = new Map<string, TransformNode>();
  align!: TransformNode;
  baseAlignYaw = 0;
  twistBones: { node: TransformNode; axis: Vector3; w: number }[] = [];
  twistSign = 1;
  headNode: TransformNode | null = null;
  headAxis = new Vector3(1, 0, 0);
  headUpSign = 1;
  /** Kopf anheben (Radiant) */
  headLift = 0.32;
  /** Drehung der Beine relativ zur Blickrichtung (Radiant). Der Oberkörper dreht entgegen. */
  legYaw = 0;
  readonly chestHeight: number;

  private constructor(root: TransformNode, animator: Animator, id: string, chestHeight: number) {
    this.root = root;
    this.animator = animator;
    this.id = id;
    this.chestHeight = chestHeight;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  static create(scene: Scene, env: Environment, assets: GladiatorAssets, team: Team): Gladiator {
    const id = `g${counter++}`;
    const inst = assets.character.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const modelRoot = inst.rootNodes[0] as TransformNode;
    const wrapper = new TransformNode('gladiator_' + id, scene);
    const align = new TransformNode('align_' + id, scene);
    align.parent = wrapper;
    modelRoot.parent = align;

    const nodes = new Map<string, TransformNode>();
    const meshes: AbstractMesh[] = [];
    for (const n of modelRoot.getDescendants(false)) {
      if (n instanceof AbstractMesh) meshes.push(n);
      if (n instanceof TransformNode && !nodes.has(n.name)) nodes.set(n.name, n);
    }
    const need = (name: string) => {
      const n = nodes.get(name);
      if (!n) throw new Error('Knochen fehlt: ' + name);
      return n;
    };
    const refresh = () => {
      wrapper.computeWorldMatrix(true);
      align.computeWorldMatrix(true);
      modelRoot.computeWorldMatrix(true);
      for (const n of modelRoot.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
    };
    const P = (name: string) => need(name).getAbsolutePosition().clone();

    // Blickrichtung des Modells auf +Z ausrichten
    refresh();
    const toe = P('ball_l').subtract(P('foot_l'));
    toe.y = 0;
    align.rotation.y = -Math.atan2(toe.x, toe.z);
    refresh();

    // Haare unter dem Helm ausblenden
    for (const m of meshes) {
      const mat = m.material?.name ?? '';
      if (mat.includes('Hair')) m.setEnabled(false);
      m.receiveShadows = true;
      env.addCaster(m as Mesh);
    }

    // Körpermaße aus dem Skelett
    const headY = P('Head').y;
    const bs = headY / 1.62; // Körpergrößen-Faktor
    const mat = gearMaterials(scene, env, team, id);

    /** Befestigungspunkt an einem Knochen: Y-Achse, Z-Hinweis und Lage im Ruhezustand */
    const sockets = new Map<string, TransformNode>();
    const socket = (name: string, bone: string, pos: Vector3, yAxis: Vector3, zHint: Vector3) => {
      const y = yAxis.normalize();
      const x = Vector3.Cross(y, zHint).normalize();
      const z = Vector3.Cross(x, y).normalize();
      const t = new TransformNode(`${name}_${id}`, scene);
      t.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(x, y, z);
      t.position = pos;
      t.computeWorldMatrix(true);
      t.setParent(need(bone));
      sockets.set(name, t);
    };
    const dims: Record<string, number> = { bs };
    // Waffe in der rechten Hand: Klinge zeigt von der Kleinfinger- zur Zeigefingerseite
    {
      const hand = P('hand_r');
      const mid = P('middle_01_r');
      const across = P('index_01_r').subtract(P('pinky_01_r')).normalize();
      const fingers = mid.subtract(hand).normalize();
      const palm = Vector3.Lerp(hand, mid, 0.75).add(fingers.scale(0.02 * bs));
      socket('weapon', 'hand_r', palm, across, fingers);
    }
    // Schild am linken Unterarm
    {
      const fore = P('lowerarm_l');
      const hand = P('hand_l');
      const d = hand.subtract(fore).normalize();
      const across = P('index_01_l').subtract(P('pinky_01_l')).normalize();
      let out = Vector3.Cross(d, across).normalize();
      const side = hand.subtract(P('pelvis'));
      side.y = 0;
      if (Vector3.Dot(out, side) < 0) out = out.scale(-1);
      out = out.scale(-1); // Bemalte Seite nach außen (empirisch geprüft)
      const longAxis = Vector3.Cross(out, d).normalize();
      const center = Vector3.Lerp(hand, P('middle_01_l'), 0.4).add(out.scale(0.07 * bs));
      socket('shield', 'hand_l', center, longAxis, out);
    }
    // Helm
    {
      const head = P('Head');
      const up = new Vector3(0, 1, 0);
      socket('helmet', 'Head', head.add(up.scale(0.115 * bs)).add(new Vector3(0, 0, -0.012 * bs)), up, new Vector3(0, 0, 1));
    }
    // Arme (Unter- und Oberarm, beide Seiten)
    for (const side of ['r', 'l']) {
      const lo = P('lowerarm_' + side);
      const hand = P('hand_' + side);
      dims['fore_' + side] = Vector3.Distance(lo, hand);
      socket('fore_' + side, 'lowerarm_' + side, lo.add(hand.subtract(lo).normalize().scale(0.02)), hand.subtract(lo), new Vector3(0, 0, 1));
      const ua = P('upperarm_' + side);
      dims['upper_' + side] = Vector3.Distance(ua, lo);
      const dir2 = lo.subtract(ua).normalize();
      socket('upper_' + side, 'upperarm_' + side, ua.add(dir2.scale(dims['upper_' + side] * 0.2)), dir2, new Vector3(0, 0, 1));
      // Schulter: Galerus sitzt außen auf dem Oberarm
      const outward = new Vector3(side === 'l' ? 1 : -1, 0, 0);
      const sideX = Math.sign(ua.x - P('pelvis').x) || (side === 'l' ? 1 : -1);
      socket('shoulder_' + side, 'upperarm_' + side, ua.add(new Vector3(sideX * 0.03 * bs, 0.03 * bs, 0)), new Vector3(0, 1, 0), new Vector3(sideX, 0, 0));
      void outward;
    }
    // Beine
    for (const side of ['l', 'r']) {
      const knee = P('calf_' + side);
      const foot = P('foot_' + side);
      dims['shin_' + side] = Vector3.Distance(knee, foot);
      const up = knee.subtract(foot).normalize();
      socket('shin_' + side, 'calf_' + side, knee.subtract(up.scale(0.05 * bs)), up, new Vector3(0, 0, 1));
    }
    // Gürtel und Brust
    {
      const pelvis = P('pelvis');
      const spine = P('spine_01');
      socket('belt', 'pelvis', Vector3.Lerp(pelvis, spine, 0.6), spine.subtract(pelvis), new Vector3(0, 0, 1));
      const chest = P('spine_03');
      socket('chest', 'spine_03', chest.add(new Vector3(0, -0.02 * bs, 0.13 * bs)), new Vector3(0, 1, 0), new Vector3(0, 0, 1));
    }
    const hair = meshes.filter((m) => (m.material?.name ?? '').includes('Hair'));

    // Animationen auf diese Figur übertragen
    const groups = new Map<string, AnimationGroup>();
    for (const src of assets.anims) {
      const g = new AnimationGroup(`${src.name}#${id}`, scene);
      for (const ta of src.targetedAnimations) {
        const t = nodes.get((ta.target as { name: string }).name);
        if (t) g.addTargetedAnimation(ta.animation, t);
      }
      g.normalize(src.from, src.to);
      groups.set(src.name, g);
    }
    const leftArm = ['clavicle_l', ...need('clavicle_l').getDescendants(false).map((n) => n.name)];
    const animator = new Animator(groups, leftArm);

    const chest = P('spine_03').y;
    const g = new Gladiator(wrapper, animator, id, chest);
    g.nodes = nodes;
    g.sockets = sockets;
    g.dims = dims;
    g.mat = mat;
    g.env = env;
    g.scene = scene;
    g.hair = hair;
    g.body = meshes.slice();
    g.equip({ cls: 'murmillo', tiers: [1, 1, 1, 1, 1] });
    g.align = align;
    g.baseAlignYaw = align.rotation.y;

    // Oberkörper-Drehung vorbereiten: lokale Drehachse je Wirbel, die im Ruhezustand der Welt-Hochachse entspricht
    const yawOf = (v: Vector3) => Math.atan2(v.x, v.z);
    const shoulderYaw = () => {
      refresh();
      const v = P('clavicle_r').subtract(P('clavicle_l'));
      return yawOf(v);
    };
    const spec: [string, number][] = [
      ['spine_01', 0.3],
      ['spine_02', 0.3],
      ['spine_03', 0.28],
      ['neck_01', 0.12],
    ];
    for (const [name, w] of spec) {
      const n = need(name);
      const inv = n.getWorldMatrix().clone().invert();
      const axis = Vector3.TransformNormal(new Vector3(0, 1, 0), inv).normalize();
      g.twistBones.push({ node: n, axis, w });
    }
    const before = shoulderYaw();
    const sp = g.twistBones[0];
    const q0 = sp.node.rotationQuaternion!.clone();
    sp.node.rotationQuaternion = q0.multiply(Quaternion.RotationAxis(sp.axis, 0.3));
    const after = shoulderYaw();
    sp.node.rotationQuaternion = q0;
    refresh();
    let d = after - before;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    g.twistSign = d >= 0 ? 1 : -1;
    // Kopf etwas anheben: die Kampf-Animationen schauen stark nach unten, so sieht man das Gesicht
    {
      const head = need('Head');
      const inv = head.getWorldMatrix().clone().invert();
      const axis = Vector3.TransformNormal(new Vector3(1, 0, 0), inv).normalize();
      const fwdY = () => {
        refresh();
        const m = head.getWorldMatrix();
        return Vector3.TransformNormal(new Vector3(0, 0, 1), m).normalize().y;
      };
      const q0 = head.rotationQuaternion!.clone();
      const y0 = fwdY();
      head.rotationQuaternion = q0.multiply(Quaternion.RotationAxis(axis, 0.3));
      const y1 = fwdY();
      head.rotationQuaternion = q0;
      refresh();
      g.headNode = head;
      g.headAxis = axis;
      g.headUpSign = y1 > y0 ? 1 : -1;
    }
    scene.onAfterAnimationsObservable.add(() => g.applyTwist());
    (window as unknown as Record<string, unknown>)['__pose_' + id] = () => {
      const w = (n: string) => need(n).getAbsolutePosition();
      const toe = w('ball_l').subtract(w('foot_l'));
      const helm = g.meshes.find((m) => m.name === 'helmet') ?? meshes[0];
      const hf = Vector3.TransformNormal(new Vector3(0, 0, 1), helm.getWorldMatrix());
      const body = meshes.find((m) => m.name === 'SuperHero_Male')!;
      return { toe: toe.toString(), helmFwd: hf.toString(), bodyWorldDet: body.getWorldMatrix().determinant(), bodyParent: body.parent?.name, alignRot: align.rotation.y, handR: w('hand_r').toString(), headPos: w('Head').toString() };
    };
    return g;
  }

  /* ---------- Zerstückelung ---------- */

  private severedNodes: TransformNode[] = [];
  private stumps: Mesh[] = [];
  private stumpMat: PBRMaterial | null = null;

  get severedParts(): number {
    return this.severedNodes.length;
  }

  /** Körperteil abtrennen. Gibt Lage und mitgerissene Ausrüstung zurück (für das fliegende Teil). */
  sever(part: SeverPart): { pos: Vector3; axis: Vector3; gear: Mesh[]; stump: Mesh; parent: TransformNode } | null {
    const map: Record<SeverPart, { bone: string; sockets: string[] }> = {
      head: { bone: 'Head', sockets: ['helmet'] },
      armR: { bone: 'lowerarm_r', sockets: ['weapon', 'fore_r'] },
      armL: { bone: 'lowerarm_l', sockets: ['shield', 'fore_l'] },
      legL: { bone: 'calf_l', sockets: ['shin_l'] },
      legR: { bone: 'calf_r', sockets: ['shin_r'] },
    };
    const m = map[part];
    const node = this.nodes.get(m.bone);
    if (!node || this.severedNodes.includes(node)) return null;
    node.computeWorldMatrix(true);
    const pos = node.getAbsolutePosition().clone();
    const rot = node.absoluteRotationQuaternion.clone();
    // Richtung vom Schnitt zum Ende des Teils
    const endName = { head: 'Head', armR: 'hand_r', armL: 'hand_l', legL: 'foot_l', legR: 'foot_r' }[part];
    const parentNode = node.parent as TransformNode;
    let axis: Vector3;
    if (part === 'head') {
      axis = pos.subtract(parentNode.getAbsolutePosition());
    } else {
      const end = this.nodes.get(endName)!;
      end.computeWorldMatrix(true);
      axis = end.getAbsolutePosition().subtract(pos);
    }
    if (axis.lengthSquared() < 1e-6) axis = new Vector3(0, 1, 0);
    axis.normalize();
    // Ausrüstung an diesem Teil löst sich mit
    const gear: Mesh[] = [];
    for (const sk of m.sockets) {
      const sock = this.sockets.get(sk);
      if (!sock) continue;
      for (const g of this.gear.filter((x) => x.parent === sock)) {
        g.computeWorldMatrix(true);
        g.setParent(null);
        gear.push(g);
      }
    }
    this.gear = this.gear.filter((g) => !gear.includes(g));
    this.meshes = [...this.body, ...this.gear];
    this.severedNodes.push(node);
    // Stumpf: rohes Fleisch und Knochen an der Schnittstelle
    if (!this.stumpMat) {
      const sm = new PBRMaterial('stump_' + this.id, this.scene);
      sm.albedoColor = new Color3(0.32, 0.015, 0.012);
      sm.metallic = 0;
      sm.roughness = 0.25;
      sm.environmentIntensity = 0;
      this.stumpMat = sm;
    }
    const bs = this.dims.bs;
    const r = (part === 'head' ? 0.06 : part.startsWith('arm') ? 0.042 : 0.055) * bs;
    const stump = MeshBuilder.CreateSphere('stump', { diameterX: r * 2.2, diameterY: r * 1.1, diameterZ: r * 2.2, segments: 8 }, this.scene);
    stump.material = this.stumpMat;
    stump.position.copyFrom(pos);
    stump.rotationQuaternion = rot.clone();
    stump.computeWorldMatrix(true);
    stump.setParent(node.parent as TransformNode);
    this.env.addCaster(stump);
    this.stumps.push(stump);
    return { pos, axis, gear, stump, parent: parentNode };
  }

  /** Neue Runde: alles wieder dran, Ausrüstung neu anlegen */
  restoreBody(): void {
    if (!this.severedNodes.length && !this.stumps.length) return;
    for (const n of this.severedNodes) n.scaling.setAll(1);
    this.severedNodes = [];
    for (const s of this.stumps) s.dispose();
    this.stumps = [];
    const look = this.look;
    this.look = null;
    if (look) this.equip(look);
  }

  /** Blut an der Waffe (0..1) */
  setWeaponBlood(k: number): void {
    if (!this.look) return;
    const key = 'iron' + this.look.tiers[0];
    const m = this.tierMats.get(key);
    if (!m) return;
    const base = TIER_COLORS.iron[Math.max(0, Math.min(4, this.look.tiers[0]))];
    m.albedoColor = Color3.Lerp(base, new Color3(0.28, 0.01, 0.01), Math.min(0.85, k));
    m.roughness = 0.24 - Math.min(0.12, k * 0.12);
  }

  /* ---------- Ausrüstung ---------- */

  sockets = new Map<string, TransformNode>();
  dims: Record<string, number> = {};
  mat!: GearMaterials;
  env!: Environment;
  scene!: Scene;
  hair: AbstractMesh[] = [];
  body: AbstractMesh[] = [];
  private gear: Mesh[] = [];
  private tierMats = new Map<string, PBRMaterial>();
  /** Spitze der Waffe (für die Waffenspur) */
  tip: TransformNode | null = null;
  look: Look | null = null;

  private metal(kind: 'bronze' | 'iron', tier: number): PBRMaterial {
    const key = kind + tier;
    let m = this.tierMats.get(key);
    if (!m) {
      const base = kind === 'bronze' ? this.mat.bronze : this.mat.iron;
      m = base.clone(`${base.name}_t${tier}`, false) as PBRMaterial;
      // Texturen teilen (geklonte Canvas-Texturen wären leer)
      m.albedoTexture = base.albedoTexture;
      m.reflectionTexture = base.reflectionTexture;
      m.backFaceCulling = false;
      m.albedoColor = TIER_COLORS[kind][Math.max(0, Math.min(4, tier))].clone();
      m.roughness = Math.max(0.15, (base.roughness ?? 0.3) - tier * 0.03);
      this.tierMats.set(key, m);
    }
    return m;
  }

  /** Ausrüstung nach Klasse und Seltenheit anlegen (alte Teile werden entfernt) */
  equip(look: Look): void {
    const same = this.look && this.look.cls === look.cls && this.look.tiers.join() === look.tiers.join();
    if (same) return;
    this.look = { cls: look.cls, tiers: [...look.tiers] as Look['tiers'] };
    for (const m of this.gear) m.dispose(false, false);
    this.gear = [];
    const def = CLASSES[look.cls];
    const [tw, tsh, th, ta, tl] = look.tiers;
    const bs = this.dims.bs;
    const sc = this.scene;
    const withMetal = (tier: number): GearMaterials => ({ ...this.mat, bronze: this.metal('bronze', tier), iron: this.metal('iron', tier) });
    const put = (mesh: Mesh, sock: string, offset?: Vector3) => {
      mesh.parent = this.sockets.get(sock)!;
      mesh.position = offset ?? Vector3.Zero();
      mesh.rotationQuaternion = null;
      mesh.rotation.setAll(0);
      mesh.receiveShadows = true;
      this.env.addCaster(mesh);
      this.gear.push(mesh);
      for (const c of mesh.getChildMeshes()) {
        this.env.addCaster(c as Mesh);
        this.gear.push(c as Mesh);
      }
      return mesh;
    };
    // Waffe
    const wm = withMetal(tw);
    const weapon =
      def.weapon === 'sica' ? buildSica(sc, wm) : def.weapon === 'spear' ? buildSpear(sc, wm) : def.weapon === 'trident' ? buildTrident(sc, wm) : buildGladius(sc, wm);
    put(weapon, 'weapon');
    if (!this.tip) this.tip = new TransformNode('tip_' + this.id, sc);
    this.tip.parent = weapon;
    this.tip.position.setAll(0);
    this.tip.position.y = def.weapon === 'spear' ? 1.45 : def.weapon === 'trident' ? 1.4 : 0.55;
    // Schild
    const sm = withMetal(tsh);
    if (def.shield === 'scutum') put(look.cls === 'provocator' ? buildProvocatorShield(sc, sm) : buildScutum(sc, sm), 'shield');
    else if (def.shield === 'parmula') put(buildParmula(sc, sm), 'shield');
    else if (def.shield === 'parma') put(buildParma(sc, sm), 'shield');
    // Helm
    const hm = withMetal(th);
    const hs = bs * 0.86;
    const helmet =
      def.helmet === 'murmillo'
        ? buildHelmet(sc, hm, hs)
        : def.helmet === 'secutor'
          ? buildHelmetSecutor(sc, hm, hs)
          : def.helmet === 'thraex'
            ? buildHelmetThraex(sc, hm, hs)
            : def.helmet === 'hoplomachus'
              ? buildHelmetHoplomachus(sc, hm, hs)
              : def.helmet === 'provocator'
                ? buildHelmetProvocator(sc, hm, hs)
                : null;
    if (helmet) put(helmet, 'helmet');
    for (const h of this.hair) h.setEnabled(!helmet);
    // Arme: Manica am Waffenarm (Retiarius: links, dazu der Galerus)
    const am = withMetal(ta);
    const armSide = look.cls === 'retiarius' ? 'l' : 'r';
    put(buildManica(sc, am, this.dims['fore_' + armSide] * 0.9, 0.05 * bs), 'fore_' + armSide);
    put(buildManica(sc, am, this.dims['upper_' + armSide] * 0.75, 0.062 * bs), 'upper_' + armSide);
    if (look.cls === 'retiarius') put(buildGalerus(sc, am, bs), 'shoulder_l');
    if (look.cls === 'provocator') put(buildChestPlate(sc, am, bs), 'chest');
    // Beine
    const lm = withMetal(tl);
    if (look.cls === 'retiarius') {
      for (const sd of ['l', 'r']) put(buildWraps(sc, lm, this.dims['shin_' + sd] * 0.5, 0.06 * bs), 'shin_' + sd);
    } else {
      const both = look.cls === 'thraex' || look.cls === 'hoplomachus';
      const len = both ? 0.95 : 0.82;
      for (const sd of both ? ['l', 'r'] : ['l']) put(buildGreave(sc, lm, this.dims['shin_' + sd] * len, 0.062 * bs), 'shin_' + sd, new Vector3(0, both ? 0.06 * bs : 0, 0));
    }
    put(buildBelt(sc, this.mat, 0.165 * bs, 0.125 * bs), 'belt');
    this.meshes = [...this.body, ...this.gear];
  }

  /** Nach den Animationen: Beine in Laufrichtung, Oberkörper bleibt zum Gegner gerichtet */
  applyTwist(): void {
    this.align.rotation.y = this.baseAlignYaw + this.legYaw;
    // Abgetrennte Körperteile: Knochen auf (fast) null skalieren, die Haut fällt dort in sich zusammen
    for (const n of this.severedNodes) n.scaling.setAll(0.0001);
    if (this.headNode?.rotationQuaternion && this.headLift !== 0) {
      this.headNode.rotationQuaternion = this.headNode.rotationQuaternion.multiply(
        Quaternion.RotationAxis(this.headAxis, this.headLift * this.headUpSign),
      );
    }
    if (Math.abs(this.legYaw) < 1e-3) return;
    const total = -this.legYaw * this.twistSign;
    for (const b of this.twistBones) {
      const q = b.node.rotationQuaternion;
      if (!q) continue;
      b.node.rotationQuaternion = q.multiply(Quaternion.RotationAxis(b.axis, total * b.w));
    }
  }

  setHeading(h: number): void {
    this.heading = h;
    this.root.rotation.y = h;
  }
}
