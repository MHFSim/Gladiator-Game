import {
  AbstractMesh,
  AnimationGroup,
  AnimationGroupMask,
  AnimationGroupMaskMode,
  AssetContainer,
  LoadAssetContainerAsync,
  Mesh,
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
  buildGladius,
  buildGreave,
  buildHelmet,
  buildManica,
  buildScutum,
  gearMaterials,
  type Team,
} from './gear';

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

export class Animator {
  private loco: AnimationGroup[] = [];
  private overlay: AnimationGroup;
  private actions: ActionState[] = [];
  private locoWeights = [1, 0, 0, 0];

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
    for (const a of this.actions) if (a.group.name.startsWith(name + '#') || a.group.name === name) a.fading = true;
  }

  /** Tempo einer laufenden Aktion ändern (z. B. langsames Ausholen, schneller Schwung) */
  setActionSpeed(id: number, speed: number): void {
    for (const a of this.actions) if (a.id === id) a.group.speedRatio = speed;
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

    const attach = (mesh: Mesh, bone: string, pos: Vector3, yAxis: Vector3, zHint: Vector3) => {
      const y = yAxis.normalize();
      const x = Vector3.Cross(y, zHint).normalize();
      const z = Vector3.Cross(x, y).normalize();
      mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(x, y, z);
      mesh.position = pos;
      mesh.computeWorldMatrix(true);
      mesh.setParent(need(bone));
      env.addCaster(mesh);
      meshes.push(mesh);
    };

    // Schwert in der rechten Hand: Klinge zeigt von der Kleinfinger- zur Zeigefingerseite
    {
      const hand = P('hand_r');
      const mid = P('middle_01_r');
      const idx = P('index_01_r');
      const pinky = P('pinky_01_r');
      const across = idx.subtract(pinky).normalize();
      const fingers = mid.subtract(hand).normalize();
      const palm = Vector3.Lerp(hand, mid, 0.75).add(fingers.scale(0.02 * bs));
      const sword = buildGladius(scene, mat);
      attach(sword, 'hand_r', palm, across, fingers);
    }
    // Schild am linken Unterarm: Mitte am Griff in der Hand
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
      const shield = buildScutum(scene, mat);
      attach(shield, 'hand_l', center, longAxis, out);
    }
    // Helm
    {
      const head = P('Head');
      const up = new Vector3(0, 1, 0);
      const center = head.add(up.scale(0.115 * bs)).add(new Vector3(0, 0, -0.012 * bs));
      const helmet = buildHelmet(scene, mat, bs * 0.86);
      attach(helmet, 'Head', center, up, new Vector3(0, 0, 1));
    }
    // Manica am rechten Arm (Unter- und Oberarm)
    {
      const lo = P('lowerarm_r');
      const hand = P('hand_r');
      const len = Vector3.Distance(lo, hand);
      const dir = hand.subtract(lo).normalize();
      const m1 = buildManica(scene, mat, len * 0.9, 0.05 * bs);
      attach(m1, 'lowerarm_r', lo.add(dir.scale(0.02)), dir, new Vector3(0, 0, 1));
      const ua = P('upperarm_r');
      const len2 = Vector3.Distance(ua, lo);
      const dir2 = lo.subtract(ua).normalize();
      const m2 = buildManica(scene, mat, len2 * 0.75, 0.062 * bs);
      attach(m2, 'upperarm_r', ua.add(dir2.scale(len2 * 0.2)), dir2, new Vector3(0, 0, 1));
    }
    // Beinschiene links
    {
      const knee = P('calf_l');
      const foot = P('foot_l');
      const len = Vector3.Distance(knee, foot);
      const up = knee.subtract(foot).normalize();
      const greave = buildGreave(scene, mat, len * 0.82, 0.062 * bs);
      attach(greave, 'calf_l', knee.subtract(up.scale(0.05 * bs)), up, new Vector3(0, 0, 1));
    }
    // Gürtel
    {
      const pelvis = P('pelvis');
      const spine = P('spine_01');
      const center = Vector3.Lerp(pelvis, spine, 0.6);
      const belt = buildBelt(scene, mat, 0.165 * bs, 0.125 * bs);
      attach(belt, 'pelvis', center, spine.subtract(pelvis), new Vector3(0, 0, 1));
    }

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
      const helm = meshes.find((m) => m.name === 'helmet')!;
      const hf = Vector3.TransformNormal(new Vector3(0, 0, 1), helm.getWorldMatrix());
      const body = meshes.find((m) => m.name === 'SuperHero_Male')!;
      return { toe: toe.toString(), helmFwd: hf.toString(), bodyWorldDet: body.getWorldMatrix().determinant(), bodyParent: body.parent?.name, alignRot: align.rotation.y, handR: w('hand_r').toString(), headPos: w('Head').toString() };
    };
    g.meshes = meshes;
    return g;
  }

  /** Nach den Animationen: Beine in Laufrichtung, Oberkörper bleibt zum Gegner gerichtet */
  applyTwist(): void {
    this.align.rotation.y = this.baseAlignYaw + this.legYaw;
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
