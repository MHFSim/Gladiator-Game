import { Color3, FreeCamera, MeshBuilder, Scene, StandardMaterial, TrailMesh, Vector3, type Mesh } from '@babylonjs/core';
import type { Arena } from '../arena/capua';
import type { AnimCmd, Gladiator, SeverPart } from '../gladiators/gladiator';
import type { Action, TouchInput } from '../input/touch';
import type { Transport } from '../net/transport';
import type { Sound } from '../audio/sound';
import { CLASSES, type ClassId } from '../data/classes';
import { buildNet } from '../gladiators/gear';
import { AiController } from './ai';
import { COMBAT, Fighter, type ActiveAttack, type Dir, type FighterEvents, type Kit } from './fighter';
import { Fx } from './fx';
import { Gore, type GoreLevel } from './gore';
import { ArenaLife, BEAST, type EnvHitKind, type EnvHitResult } from './life';
import type { FighterInfo } from './hero';
import { isTeamMode, spawnPoints, TEAM_COLORS, type FighterSetup, type MatchMode, type MatchSetup } from './match';
import { Spectacle, type Deed, type Verdict } from './spectacle';

const TAU = Math.PI * 2;

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Kleine Anzeige über einem Kämpfer (Name, Leben) */
export interface Mark {
  x: number;
  y: number;
  hp: number;
  ally: boolean;
  name: string;
}

export interface HudHooks {
  setBars(hp: number, st: number, exhausted: boolean): void;
  hint(text: string, seconds?: number): void;
  floatText(world: Vector3, text: string, kind?: 'good' | 'bad' | 'big' | ''): void;
  guard(info: GuardInfo | null): void;
  score(text: string): void;
  setLocked(on: boolean): void;
  foeName(text: string): void;
  favor(mine: number, foe: number): void;
  vote(p: number | null, label?: string): void;
  thumb(v: 'missio' | 'iugula' | null): void;
  cinematic(on: boolean): void;
  flash?(kind: 'hurt' | 'parry' | 'strike'): void;
  screenBlood?(amount: number): void;
  special?(name: string | null, left: number, total: number): void;
  marks?(list: Mark[]): void;
  project(world: Vector3): { x: number; y: number } | null;
}

export const WINS_NEEDED = 2;

export interface MatchResult {
  won: boolean;
  mode: MatchMode;
  wins: number;
  losses: number;
  /** Gegner (bei mehreren: Durchschnitt der Stufen) */
  foe: FighterInfo;
  enemies: number;
  kills: number;
  parries: number;
  pvp: boolean;
  verdict: Verdict;
}

export type Role = 'solo' | 'host' | 'guest';

/** Zustand eines Kämpfers im Netz-Schnappschuss */
interface NetFighter {
  p: [number, number];
  h: number;
  ly: number;
  sp: number;
  bw: boolean;
  m: string;
  bl: boolean;
  hp: number;
  st: number;
  ex: boolean;
  fv: number;
  sc: number;
  t: number;
  at: { d: Dir; hv: boolean; ii: number; wu: number } | null;
}

interface Snap {
  f: NetFighter[];
  recv: number;
}

interface InMsg {
  p: [number, number];
  h: number;
  ly: number;
  v: [number, number];
  bw: boolean;
}

type NetAction = Exclude<Action, { type: 'roll' }> | { type: 'roll'; v: [number, number] } | { type: 'target' };

export interface GuardInfo {
  anchor: Vector3; // Weltposition über dem Gegner
  blocking: boolean;
  foeBlocking: boolean;
  incoming: boolean;
  heavy: boolean;
  impactIn: number | null; // Sekunden bis zum Treffer (für die Zeitanzeige)
  windup: number;
  parryWindow: number;
  foeHp: number;
  foeSt: number;
}

type FloatKind = 'good' | 'bad' | 'big' | '';
type HitFx = 'parry' | 'hit' | 'big';

/**
 * Das Spiel: beliebig viele Kämpfer in Teams (Duell, 2 gegen 2, 3 gegen 3, jeder gegen jeden).
 * Training: alles auf diesem Handy. Gastgeber: rechnet alles und schickt Schnappschüsse. Gast: zeigt an und schickt Eingaben.
 */
export class Game implements FighterEvents {
  fighters: Fighter[] = [];
  private setups: FighterSetup[] = [];
  private meIdx = 0;
  mode: MatchMode = 'duel';
  private ais = new Map<Fighter, AiController>();
  private aiMoves = new Map<Fighter, { dir: Vector3; speed: number }>();
  private fx: Fx;
  readonly spec: Spectacle;
  readonly gore: Gore;
  readonly life: ArenaLife;
  private yaw = 0;
  private pitch = 0.32;
  private lastDrag = 0;
  private shake = 0;
  now = 0;
  private hitStop = 0;
  private locked = false;
  private manualUnlock = false;
  private roundOver = false;
  /** Siege je Team (Duell) */
  private teamWins: number[] = [0, 0];
  private camLook = new Vector3(0, 1.5, 0);
  private difficulty: number;

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private arena: Arena,
    private readonly pool: Gladiator[],
    private readonly makeGladiator: () => Gladiator,
    private readonly input: TouchInput,
    private readonly hud: HudHooks,
    difficulty: number,
    readonly sound: Sound,
  ) {
    this.difficulty = difficulty;
    this.fx = new Fx(scene);
    this.gore = new Gore(scene, this.fx, () => this.arena.play);
    this.life = new ArenaLife(scene, {
      now: () => this.now,
      authority: () => this.role !== 'guest',
      fighters: () => this.fighters,
      mode: () => this.mode,
      calm: () => this.spec.inCeremony || this.roundOver || this.matchOver,
      envHit: (D, dmg, from, kind) => this.envHit(D, dmg, from, kind),
      beastAttack: (D, at) => this.ais.get(D)?.onBeastAttack(at, this.now),
      blood: (p, d, pw) => this.blood(p, d, pw),
      pool: (p, sc) => {
        this.fx.pool(p, sc);
        this.send('ev', { k: 'pool', p: [p.x, p.z], s: sc });
      },
      sfx: (n) => this.sfx(n),
      shake: (v) => this.setShake(v),
      announce: (t) => {
        this.hud.hint(t, 2.6);
        this.send('ev', { k: 'msg', t });
      },
      float: (p, t) => {
        this.hud.floatText(p, t, '');
        this.send('ev', { k: 'float', p: [p.x, p.y, p.z], t, s: 0, o: -1, g: null, b: false });
      },
      kick: (v) => this.spec.kick(v),
      send: (ev) => this.send('ev', ev),
    });
    this.life.setArena(arena);
    this.spec = new Spectacle(() => this.arena.crowd, sound, {
      now: () => this.now,
      isAuthority: () => this.role !== 'guest',
      fighters: () => this.fighters,
      opp: (f) => this.opp(f),
      byIdx: (i) => this.fighters[i] ?? this.player,
      hint: (t, sec) => this.hud.hint(t, sec),
      float: (f, t, good) => this.float(this.chest(f), t, f, good),
      send: (ev) => this.send('ev', ev),
      vote: (p, label) => this.hud.vote(p, label),
      thumb: (v) => this.hud.thumb(v),
      heal: (f, hp) => {
        f.g.hp = Math.min(f.stats.hpMax, f.g.hp + hp);
        f.g.stamina = f.stats.staminaMax;
        this.float(this.chest(f), `Geschenk des Volkes +${hp}`, f, true);
        if (f === this.player) this.hud.hint('Das Publikum liebt dich: Wein und Brot fliegen in die Arena!', 2.5);
      },
      pelt: (f) => {
        f.stagger(0.6, 'hit_head', 1.2);
        f.drain(15);
        this.float(this.chest(f), 'Faules Obst!', f, false);
        if (f === this.player) this.hud.hint('Das Publikum bewirft dich – zeig mehr Mut!', 2.5);
      },
      finisher: (w, l) => this.finisher(w, l),
      done: (v) => this.ceremonyDone(v),
    });
    // Start: Duell gegen eine KI (bis das Menü etwas anderes festlegt)
    const base = (team: number, owner: string): FighterSetup => ({
      cls: 'murmillo',
      kit: CLASSES.murmillo.kit,
      tiers: [1, 1, 1, 1, 1],
      stats: { hpMax: 100, staminaMax: 100, staminaRegen: 20, lightMul: 1, heavyMul: 1, headMul: 1, bashMul: 1, windupMul: 1, rollMul: 1, moveMul: 1, parryBonus: 0, gloriaMul: 1 },
      info: { name: owner === 'ai' ? 'Gegner' : 'Du', level: 1 },
      team,
      owner,
      ai: difficulty,
    });
    this.applySetup({ mode: 'duel', fighters: [base(0, 'local'), base(1, 'ai')] }, 'local');
  }

  /* ---------- Kämpfer und Teams ---------- */

  /** Der eigene Kämpfer */
  get player(): Fighter {
    return this.fighters[this.meIdx];
  }

  /** Das aktuelle Ziel des eigenen Kämpfers (für Kamera, Anzeige) */
  get foe(): Fighter {
    const p = this.player;
    return (p.target && p.target.mode !== 'dead' ? p.target : this.nearestEnemy(p)) ?? p.target ?? this.fighters.find((f) => f !== p) ?? p;
  }

  /** Erste KI (für Tests und Schwierigkeit) */
  get ai(): AiController {
    return [...this.ais.values()][0] ?? new AiController(this.player, () => null, 0);
  }

  private enemies(f: Fighter): Fighter[] {
    return this.fighters.filter((o) => o !== f && o.team !== f.team && o.mode !== 'dead');
  }

  private nearestEnemy(f: Fighter): Fighter | null {
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const o of this.enemies(f)) {
      const d = Vector3.DistanceSquared(o.pos, f.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Gegenüber eines Kämpfers: sein Ziel, sonst der nächste Gegner */
  private opp(f: Fighter): Fighter | null {
    if (f.target && f.target.mode !== 'dead' && f.target.team !== f.team) return f.target;
    return this.nearestEnemy(f);
  }

  private idx(f: Fighter): number {
    return this.fighters.indexOf(f);
  }

  private byIdx(w: number): Fighter {
    return this.fighters[w] ?? this.player;
  }

  private isRemote(f: Fighter): boolean {
    return f.owner !== 'local' && f.owner !== 'ai';
  }

  private nextTargetCheck = 0;

  /** Ziele wählen: tote oder fehlende Ziele ersetzen, KI wechselt ab und zu */
  private updateTargets(force = false): void {
    if (this.role === 'guest') return;
    if (!force && this.now < this.nextTargetCheck) return;
    this.nextTargetCheck = this.now + 0.3;
    for (const f of this.fighters) {
      if (f.mode === 'dead') continue;
      const bad = !f.target || f.target.mode === 'dead' || f.target.team === f.team;
      if (bad) {
        f.target = this.nearestEnemy(f);
        continue;
      }
      // KI: gelegentlich neu entscheiden, damit nicht alle auf denselben gehen
      if (f.owner === 'ai' && Math.random() < 0.04) {
        const options = this.enemies(f);
        if (options.length > 1) {
          let best = f.target;
          let bs = Infinity;
          for (const o of options) {
            const s = Vector3.Distance(o.pos, f.pos) * (0.6 + Math.random() * 0.9) + (o === this.player ? 0.6 : 0);
            if (s < bs) {
              bs = s;
              best = o;
            }
          }
          f.target = best;
        }
      }
    }
  }

  /** Tier in der Nähe, näher als das Ziel: dorthin schauen und schlagen */
  private updateFocus(): void {
    for (const f of this.fighters) {
      if (f.mode === 'dead') {
        f.focus = null;
        continue;
      }
      const b = this.life.nearest(f.pos, 2.8);
      const t = this.role === 'guest' ? f.target : this.opp(f);
      const bd = b ? Vector3.Distance(b.pos, f.pos) : Infinity;
      f.focus = b && (!t || bd < Vector3.Distance(t.pos, f.pos) - 0.3) ? b.pos : null;
    }
  }

  /** Ziel wechseln (Aufschalt-Taste bei mehreren Gegnern) */
  private cycleTarget(f: Fighter): void {
    const list = this.enemies(f).sort((a, b) => Vector3.Distance(a.pos, f.pos) - Vector3.Distance(b.pos, f.pos));
    if (!list.length) return;
    const i = f.target ? list.indexOf(f.target) : -1;
    f.target = list[(i + 1) % list.length];
    if (f === this.player) this.hud.foeName(`${f.target.info.name} · Stufe ${f.target.info.level}`);
  }

  /** Vorrat an Figuren: bei Bedarf weitere erzeugen */
  private gladiator(i: number): Gladiator {
    while (this.pool.length <= i) this.pool.push(this.makeGladiator());
    return this.pool[i];
  }

  /** Kämpfer nach Plan aufstellen (Training, Gastgeber, Gast) */
  private applySetup(setup: MatchSetup, meOwner: string): void {
    for (const t of this.trails.values()) t.dispose();
    this.trails.clear();
    this.remoteAtk.clear();
    this.remoteIn.clear();
    this.ais.clear();
    this.aiMoves.clear();
    this.mode = setup.mode;
    this.setups = setup.fighters;
    this.life.enabled = setup.life ?? true;
    if (this.role === 'guest' && this.life.enabled) this.life.preload();
    this.fighters = setup.fighters.map((fs, i) => {
      const g = this.gladiator(i);
      g.animator.listener = null;
      g.animator.resume('death');
      g.animator.stop('death');
      g.animator.stop('get_up');
      g.setActive(true);
      const f = new Fighter(g, fs.info.name, this);
      f.stats = fs.stats;
      f.info = fs.info;
      f.team = fs.team;
      f.owner = fs.owner;
      f.weather = { ...this.weatherRules };
      this.setClass(f, fs.cls, fs.kit, fs.tiers);
      g.setTeam(TEAM_COLORS[fs.team % TEAM_COLORS.length]);
      return f;
    });
    for (let i = setup.fighters.length; i < this.pool.length; i++) this.pool[i].setActive(false);
    this.meIdx = Math.max(0, this.fighters.findIndex((f) => f.owner === meOwner));
    if (this.role !== 'guest') {
      for (const [i, f] of this.fighters.entries()) {
        if (f.owner !== 'ai') continue;
        const ai = new AiController(f, () => f.target, setup.fighters[i].ai ?? this.difficulty);
        ai.special = () => this.special(f);
        ai.specialKind = CLASSES[f.cls].special.id;
        ai.threat = () => this.threatFor(f);
        this.ais.set(f, ai);
      }
    }
  }

  /** Für die KI: nächstes Tier und ob es gerade anstürmt */
  private threatFor(f: Fighter): { pos: Vector3; charging: boolean; dist: number } | null {
    const b = this.life.nearest(f.pos, 8);
    if (!b) return null;
    const dist = Vector3.Distance(b.pos, f.pos) - BEAST[b.kind].radius * 0.5;
    const charging = (b.mode === 'charge' || (b.mode === 'windup' && b.kind === 'bull' && !b.struck)) && b.target === f;
    if (!charging && dist > 3) return null;
    return { pos: b.pos, charging, dist };
  }

  private weatherRules = { regenMul: 1, rollCostMul: 1 };

  /* ---------- Einstellungen ---------- */

  private weaponBlood = new Map<Fighter, number>();
  private trails = new Map<Fighter, TrailMesh>();
  private trailMat: StandardMaterial | null = null;
  private remoteAtk = new Map<Fighter, number>();
  private fovKick = 0;
  private baseFov = 0.8;
  private lockRange = COMBAT.lockRange;
  private slowmo = 0;
  private pendingResult: Omit<MatchResult, 'verdict'> | null = null;
  blockAssist: 'off' | 'show' | 'auto' = 'show';

  /** Brutalität: voll, reduziert, aus */
  setGore(level: GoreLevel): void {
    this.gore.level = level;
    this.fx.goreMul = level === 'full' ? 1 : level === 'reduced' ? 0.4 : 0;
  }

  /** Andere Arena (nach dem Umbau der Szene) */
  setArena(a: Arena): void {
    this.arena = a;
    this.life.setArena(a);
    this.resetMatch();
  }

  get arenaKind(): Arena['kind'] {
    return this.arena.kind;
  }

  /** Wetterregeln für alle Kämpfer */
  setWeatherRules(r: { regenMul: number; rollCostMul: number; lockRange: number }): void {
    this.lockRange = r.lockRange;
    this.weatherRules = { regenMul: r.regenMul, rollCostMul: r.rollCostMul };
    for (const f of this.fighters) f.weather = { ...this.weatherRules };
  }

  setDifficulty(i: number): void {
    this.difficulty = i;
    for (const a of this.ais.values()) a.setLevel(i);
  }

  /** Klasse eines Kämpfers setzen: Werte, Aussehen, Sonderfähigkeit */
  setClass(f: Fighter, cls: ClassId, kit: Kit = CLASSES[cls].kit, tiers: [number, number, number, number, number] = [1, 1, 1, 1, 1]): void {
    f.cls = cls;
    f.kit = kit;
    f.g.equip({ cls, tiers });
    const ai = this.ais.get(f);
    if (ai) ai.specialKind = CLASSES[cls].special.id;
  }

  /* ---------- Match ---------- */

  role: Role = 'solo';
  private net: Transport | null = null;
  private boundNet: Transport | null = null;
  private snapTimer = 0;
  private inTimer = 0;
  private snaps: Snap[] = [];
  private remoteIn = new Map<Fighter, InMsg>();
  private guestRollUntil = 0;
  private foeAttackLocal: { d: Dir; hv: boolean; impactAt: number; wu: number } | null = null;
  onNetEnd: ((reason: string) => void) | null = null;
  onMatchEnd: ((r: MatchResult) => void) | null = null;
  onRematch: (() => void) | null = null;
  matchOver = false;

  /** Training: alles läuft auf diesem Handy */
  startSolo(setup: MatchSetup): void {
    this.role = 'solo';
    this.net = null;
    this.applySetup(setup, 'local');
    this.rematch();
  }

  /** Mehrspieler: Gastgeber rechnet, Gast zeigt an. meOwner = eigene Kennung im Plan */
  startNet(role: Role, net: Transport, setup: MatchSetup, meOwner: string): void {
    this.role = role;
    this.net = net;
    this.applySetup(setup, meOwner);
    if (this.boundNet !== net) {
      this.boundNet = net;
      if (role === 'guest') {
        net.on('snap', (d) => {
          const m = d as { f: NetFighter[]; x?: number; bs?: [number, number, number, number, number, number, number][] };
          this.onSnap(m);
          this.life.applySnap(m.bs);
        });
        net.on('anim', (d) => {
          const m = d as { w: number; cmd: AnimCmd };
          this.fighters[m.w]?.g.animator.apply(m.cmd);
        });
        net.on('ev', (d) => this.onEvent(d as Record<string, unknown>));
      } else {
        net.on('in', (d, peer) => {
          const f = this.fighters.find((x) => x.owner === peer);
          if (f) this.remoteIn.set(f, d as InMsg);
        });
        net.on('act', (d, peer) => {
          const f = this.fighters.find((x) => x.owner === peer);
          if (f) this.handleRemote(f, d as NetAction);
        });
      }
    }
    if (role === 'host') {
      this.fighters.forEach((f, i) => (f.g.animator.listener = (cmd) => net.send('anim', { w: i, cmd })));
      this.rematch();
    } else {
      // Reste eines früheren Trainingskampfs aufräumen
      for (const f of this.fighters) {
        if (f.mode === 'dead') {
          f.g.animator.resume('death');
          f.mode = 'free';
        }
      }
      this.resetMatch();
    }
  }

  /** Ein Gast hat die Arena verlassen (Gastgeber): die KI übernimmt. Gastgeber weg (Gast): zurück ins Menü. */
  peerLeft(peer: string, name: string): void {
    if (this.role === 'host') {
      const f = this.fighters.find((x) => x.owner === peer);
      if (f) {
        f.owner = 'ai';
        f.g.animator.listener = null;
        const ai = new AiController(f, () => f.target, this.difficulty);
        ai.special = () => this.special(f);
        ai.specialKind = CLASSES[f.cls].special.id;
        ai.threat = () => this.threatFor(f);
        this.ais.set(f, ai);
        this.remoteIn.delete(f);
        if (this.net) {
          const i = this.idx(f);
          f.g.animator.listener = (cmd) => this.net?.send('anim', { w: i, cmd });
        }
      }
      const humans = this.fighters.filter((x) => this.isRemote(x)).length;
      this.hud.hint(`${name} hat die Arena verlassen – die KI übernimmt`, 3);
      if (humans === 0) {
        this.role = 'solo';
        for (const x of this.fighters) x.g.animator.listener = null;
        this.net = null;
      }
    } else if (this.role === 'guest') {
      this.onNetEnd?.(name);
    }
  }

  /** Alter Name, wird vom Menü noch genutzt: Gegner weg */
  endNet(reason: string): void {
    if (this.role === 'guest') this.onNetEnd?.(reason);
    else {
      const remote = this.fighters.find((f) => this.isRemote(f));
      if (remote) this.peerLeft(remote.owner, reason);
    }
  }

  /** Neuer Kampf: alle wieder auf die Beine, Stand 0:0 */
  rematch(): void {
    if (this.role !== 'guest') {
      for (const f of this.fighters) if (f.mode === 'dead' || f.mode === 'stagger') f.standUp();
    }
    this.roundOver = false;
    this.sfx('horn');
    this.resetMatch();
    this.send('ev', { k: 'rematch' });
  }

  resetMatch(): void {
    this.teamWins = [0, 0];
    this.matchOver = false;
    this.slowmo = 0;
    this.scene.animationTimeScale = 1;
    this.spec.resetMatch();
    this.fx.clearPools();
    this.fx.clearDecals();
    this.fx.clearWounds();
    this.gore.clear(this.fighters.map((f) => f.g));
    this.weaponBlood.clear();
    this.life.reset();
    for (const f of this.fighters) {
      f.g.setWeaponBlood(0);
      if (this.role !== 'guest') f.refill();
      f.parries = 0;
      f.kills = 0;
      f.damageTaken = 0;
      f.vel.setAll(0);
      f.target = null;
    }
    // Startplätze (auch beim Gast für die eigene Figur)
    const spawns = spawnPoints(this.mode, this.setups);
    this.fighters.forEach((f, i) => {
      if (this.role === 'guest' && f !== this.player) return;
      const [x, z, h] = spawns[i];
      f.g.root.position.set(x, 0, z);
      f.g.setHeading(h);
    });
    this.yaw = this.player.g.heading;
    this.updateTargets(true);
    for (const a of this.ais.values()) a.reset(this.now);
    this.hud.foeName(this.foeLabel());
    this.updateScore();
  }

  private foeLabel(): string {
    if (this.mode === 'duel') return `${this.foe.info.name} · Stufe ${this.foe.info.level}`;
    return `${this.foe.info.name} · Stufe ${this.foe.info.level}`;
  }

  /** Anzeige oben: Spielstand bzw. wer noch steht */
  private updateScore(): void {
    const me = this.player;
    if (this.mode === 'duel') {
      const w = this.teamWins[me.team] ?? 0;
      const l = this.teamWins[1 - me.team] ?? 0;
      this.hud.score(w + l > 0 ? `${w} : ${l}` : '');
      return;
    }
    const alive = this.fighters.filter((f) => f.mode !== 'dead');
    if (isTeamMode(this.mode)) {
      const mine = alive.filter((f) => f.team === me.team).length;
      this.hud.score(`${mine} : ${alive.length - mine}`);
    } else this.hud.score(`${alive.length} übrig`);
  }

  /* ---------- Senden an die Gäste ---------- */

  private send(ch: string, data: unknown): void {
    if (this.net && this.role === 'host') this.net.send(ch, data);
  }

  private blood(p: Vector3, d: Vector3, power = 1): void {
    this.fx.bloodAt(p, d, power);
    if (power >= 1.3 && Vector3.Distance(this.camera.position, p) < 3.6) this.hud.screenBlood?.(Math.min(1, power / 2.5) * this.fx.goreMul);
    this.send('ev', { k: 'blood', p: [p.x, p.y, p.z], d: [d.x, d.y, d.z], pw: power });
  }

  private sparks(p: Vector3): void {
    this.fx.sparksAt(p);
    this.send('ev', { k: 'sparks', p: [p.x, p.y, p.z] });
  }

  /** Farbe eines Textes aus Sicht des eigenen Kämpfers */
  private kindFor(subject: Fighter, good: boolean | null, other: Fighter | null, big: boolean): FloatKind {
    if (good === null) return '';
    const me = this.player;
    const friend = (f: Fighter | null) => !!f && (f === me || (f.team === me.team && this.mode !== 'duel'));
    const pos: FloatKind = big ? 'big' : 'good';
    if (friend(subject)) return good ? pos : 'bad';
    if (friend(other)) return good ? 'bad' : pos;
    return '';
  }

  /** Schwebender Text: subject = um wen es geht, good = gut für ihn */
  private float(w: Vector3, text: string, subject: Fighter, good: boolean | null, other: Fighter | null = null, big = false): void {
    this.hud.floatText(w, text, this.kindFor(subject, good, other, big));
    this.send('ev', { k: 'float', p: [w.x, w.y, w.z], t: text, s: this.idx(subject), o: other ? this.idx(other) : -1, g: good, b: big });
  }

  private setShake(v: number): void {
    this.shake = v;
    this.send('ev', { k: 'shake', v });
  }

  private setHitStop(v: number): void {
    this.hitStop = v;
    this.send('ev', { k: 'stop', v });
  }

  private impulse(f: Fighter, v: Vector3): void {
    if (this.role === 'host' && this.isRemote(f)) this.send('ev', { k: 'push', w: this.idx(f), v: [v.x, v.z] });
    else f.vel.addInPlace(v);
  }

  /** Bildschirm-Rückmeldung je nach Beteiligung */
  private hitFx(A: Fighter, D: Fighter, kind: HitFx): void {
    this.applyHitFx(A, D, kind);
    this.send('ev', { k: 'hfx', a: this.idx(A), d: this.idx(D), x: kind });
  }

  private applyHitFx(A: Fighter, D: Fighter, kind: HitFx): void {
    const me = this.player;
    let f: 'hurt' | 'parry' | 'strike' | null = null;
    if (kind === 'parry') f = D === me ? 'parry' : null;
    else if (D === me) f = 'hurt';
    else if (A === me && kind === 'big') f = 'strike';
    if (!f) return;
    this.hud.flash?.(f);
    this.fovKick = Math.max(this.fovKick, f === 'strike' ? 0.09 : f === 'hurt' ? 0.06 : 0.04);
  }

  /** Ton lokal abspielen und bei den Gästen auch */
  private sfx(n: 'clash' | 'block' | 'hit' | 'whoosh' | 'fall' | 'horn' | 'growl' | 'bellow' | 'bite' | 'rumble' | 'spikes', h = false): void {
    (this.sound[n] as (h: boolean) => void).call(this.sound, h);
    this.send('ev', { k: 'sfx', n, h });
  }

  private deed(d: Deed, f: Fighter): void {
    const o = this.opp(f) ?? f;
    this.spec.note(d, f, o);
    // Herausforderung: das Publikum jubelt doppelt
    if (this.now < this.challengeUntil) this.spec.note(d, f, o);
  }

  private netFighter(f: Fighter): NetFighter {
    const a = f.attack;
    return {
      p: [f.pos.x, f.pos.z],
      h: f.g.heading,
      ly: f.g.legYaw,
      sp: f.mode === 'free' ? Math.hypot(f.vel.x, f.vel.z) : 0,
      bw: f.backwards,
      m: f.mode,
      bl: f.blocking,
      hp: f.g.hp,
      st: f.g.stamina,
      ex: f.exhausted,
      fv: Math.round(f.favor),
      sc: Math.max(0, Math.round((f.specialReadyAt - this.now) * 10) / 10),
      t: f.target ? this.idx(f.target) : -1,
      at: a && this.now < a.impactAt ? { d: a.dir, hv: a.heavy, ii: a.impactAt - this.now, wu: a.impactAt - a.start } : null,
    };
  }

  /** Gastgeber: Eingabe eines Gasts ausführen */
  private handleRemote(f: Fighter, a: NetAction): void {
    if (f.mode === 'dead' || this.spec.inCeremony) return;
    switch (a.type) {
      case 'light':
      case 'heavy':
        f.startAttack(a.type === 'heavy');
        break;
      case 'block':
        f.setBlock(a.on);
        break;
      case 'cheer':
        this.doCheer(f);
        break;
      case 'bash':
        f.bash();
        break;
      case 'roll':
        f.setBlock(false);
        f.roll(new Vector3(a.v[0], 0, a.v[1]));
        break;
      case 'special':
        this.special(f);
        break;
      case 'target':
        this.cycleTarget(f);
        break;
    }
  }

  /* ---------- Gast ---------- */

  private guestVerdict: Verdict = 'missio';

  /** Gast: Ereignis vom Gastgeber */
  private onEvent(e: Record<string, unknown>): void {
    const v3 = (a: unknown) => {
      const n = a as number[];
      return new Vector3(n[0], n[1], n[2]);
    };
    switch (e.k) {
      case 'blood': {
        const pw = (e.pw as number) ?? 1;
        const bp = v3(e.p);
        this.fx.bloodAt(bp, v3(e.d), pw);
        if (pw >= 1.3 && Vector3.Distance(this.camera.position, bp) < 3.6) this.hud.screenBlood?.(Math.min(1, pw / 2.5) * this.fx.goreMul);
        break;
      }
      case 'sever': {
        const f = this.byIdx(e.w as number);
        this.gore.sever(f.g, e.part as SeverPart, v3(e.d), (e.pw as number) ?? 1);
        if (Vector3.Distance(this.camera.position, f.pos) < 5) this.hud.screenBlood?.(1);
        break;
      }
      case 'wound': {
        const f = this.byIdx(e.w as number);
        const c = v3(e.p);
        const bone = f.g.nodes.get(c.y > f.pos.y + f.g.chestHeight + 0.1 ? 'spine_03' : 'spine_02');
        if (bone) this.fx.wound(f.g.id, bone, c, e.s as number);
        break;
      }
      case 'wblood':
        this.byIdx(e.w as number).g.setWeaponBlood(e.v as number);
        break;
      case 'sparks':
        this.fx.sparksAt(v3(e.p));
        break;
      case 'float': {
        const o = e.o as number;
        this.hud.floatText(v3(e.p), e.t as string, this.kindFor(this.byIdx(e.s as number), e.g as boolean | null, o >= 0 ? this.byIdx(o) : null, !!e.b));
        break;
      }
      case 'hfx':
        this.applyHitFx(this.byIdx(e.a as number), this.byIdx(e.d as number), e.x as HitFx);
        break;
      case 'shake':
        this.shake = e.v as number;
        break;
      case 'stop':
        this.hitStop = e.v as number;
        break;
      case 'push': {
        if (e.w !== this.meIdx) break;
        const v = e.v as number[];
        this.player.vel.addInPlace(new Vector3(v[0], 0, v[1]));
        break;
      }
      case 'msg':
        if (e.w === undefined || e.w === this.meIdx) this.hud.hint(e.t as string, 1.4);
        break;
      case 'round': {
        const s = e.s as number[];
        this.teamWins = s;
        // Tötungen und Paraden zählt der Gastgeber
        (e.ks as [number, number][] | undefined)?.forEach(([k, p], i) => {
          const f = this.fighters[i];
          if (f) {
            f.kills = k;
            f.parries = p;
          }
        });
        this.updateScore();
        const won = e.wt === this.player.team;
        if (e.m) {
          this.matchOver = true;
          this.pendingResult = this.makeResult(won);
          if (this.mode !== 'duel') this.hud.hint(won ? 'Sieg! Die Arena gehört euch.' : 'Niederlage …', 3);
        } else this.hud.hint(won ? 'Sieg! Der Gegner liegt im Sand.' : 'Du bist gefallen …', 3.5);
        break;
      }
      case 'dead':
        this.updateScore();
        if (e.w === this.meIdx) this.hud.hint('Du bist gefallen – schau zu, wie dein Team kämpft', 3);
        break;
      case 'trap':
        this.life.onTrap(e.i as number, e.s as 'idle');
        break;
      case 'trapb':
        this.life.onTrapBlood(e.i as number);
        break;
      case 'rematch':
        this.resetMatch();
        this.onRematch?.();
        break;
      case 'proj': {
        const f3 = e.f as number[];
        const t3 = e.t as number[];
        this.throwProjectile(e.kind as 'javelin' | 'net', new Vector3(f3[0], f3[1], f3[2]), new Vector3(t3[0], t3[1], t3[2]), null);
        break;
      }
      case 'net': {
        const pp = e.p as number[];
        this.netOn(new Vector3(pp[0], 0, pp[1]), e.d as number);
        break;
      }
      case 'pool': {
        const pp = e.p as number[];
        this.fx.pool(new Vector3(pp[0], 0, pp[1]), (e.s as number) ?? 1);
        break;
      }
      case 'sfx':
        (this.sound[e.n as 'clash'] as (h: boolean) => void).call(this.sound, !!e.h);
        break;
      case 'cer':
        this.spec.onRemote(e);
        if (e.ph === 'verdict') this.guestVerdict = e.v as Verdict;
        if (e.ph === 'fall') this.slowmo = 1.4;
        break;
      case 'done':
        if (this.pendingResult) this.onMatchEnd?.({ ...this.pendingResult, verdict: (e.v as Verdict) ?? this.guestVerdict });
        this.pendingResult = null;
        break;
      case 'next':
        this.gore.clear(this.fighters.map((f) => f.g));
        this.fx.clearWounds();
        this.hud.hint('Nächste Runde – kämpft!', 2);
        break;
    }
  }

  /** Gast: Schnappschuss empfangen */
  private onSnap(d: { f: NetFighter[]; x?: number }): void {
    if (typeof d.x === 'number') this.spec.setRemoteExcite(d.x);
    this.snaps.push({ f: d.f, recv: performance.now() });
    if (this.snaps.length > 3) this.snaps.shift();
    d.f.forEach((n, i) => {
      const f = this.fighters[i];
      if (!f) return;
      f.g.hp = n.hp;
      f.g.stamina = n.st;
      f.favor = n.fv ?? 50;
      f.target = n.t >= 0 ? (this.fighters[n.t] ?? null) : null;
      if (n.at) this.remoteAtk.set(f, this.now + n.at.ii);
      if (f === this.player) {
        f.specialReadyAt = this.now + (n.sc ?? 0);
        if (this.spec.inCeremony) {
          // Während der Zeremonie bestimmt der Gastgeber auch die eigene Figur
          f.pos.x = n.p[0];
          f.pos.z = n.p[1];
          f.g.setHeading(n.h);
        }
        f.exhaustedUntil = n.ex ? this.now + 0.2 : 0;
        if (this.now >= this.guestRollUntil) f.mode = n.m as Fighter['mode'];
      } else {
        f.mode = n.m as Fighter['mode'];
        f.blockWanted = n.bl;
        if ((n.m === 'block') !== f.blocking) f.mode = n.m as Fighter['mode'];
      }
    });
    const tgt = this.player.target;
    const ti = tgt ? this.idx(tgt) : -1;
    const ta = ti >= 0 ? d.f[ti]?.at : null;
    this.foeAttackLocal = ta && tgt?.target === this.player ? { d: ta.d, hv: ta.hv, impactAt: this.now + ta.ii, wu: ta.wu } : null;
  }

  /** Gast: andere Kämpfer zwischen den letzten zwei Schnappschüssen glätten */
  private interpolateOthers(): void {
    if (this.snaps.length === 0) return;
    const b = this.snaps[this.snaps.length - 1];
    const a = this.snaps.length > 1 ? this.snaps[this.snaps.length - 2] : b;
    const span = Math.max(1, b.recv - a.recv);
    const t = Math.min(1, (performance.now() - b.recv) / span);
    this.fighters.forEach((f, i) => {
      if (f === this.player) return;
      const A = a.f[i];
      const B = b.f[i];
      if (!A || !B) return;
      f.pos.x = A.p[0] + (B.p[0] - A.p[0]) * t;
      f.pos.z = A.p[1] + (B.p[1] - A.p[1]) * t;
      f.g.setHeading(A.h + angleDiff(A.h, B.h) * t);
      f.g.legYaw = A.ly + (B.ly - A.ly) * t;
      f.g.animator.setSpeed(B.sp, B.bw);
    });
  }

  /** Gast: Eingabe ans Gastgeber-Handy */
  private sendGuestAction(a: Action): void {
    if (!this.net) return;
    const p = this.player;
    if (p.mode === 'dead' && a.type !== 'lock') return;
    switch (a.type) {
      case 'block':
        this.net.send('act', a);
        break;
      case 'roll': {
        let dir = this.stickWorld();
        const fw = new Vector3(Math.sin(p.g.heading), 0, Math.cos(p.g.heading));
        const right = new Vector3(fw.z, 0, -fw.x);
        if (a.dir === 'left') dir = right.scale(-1);
        else if (a.dir === 'right') dir = right;
        else if (a.dir === 'forward') dir = fw;
        else if (a.dir === 'back' || dir.length() < 0.25) dir = fw.scale(-1);
        dir.normalize();
        if ((p.mode !== 'free' && p.mode !== 'block') || p.exhausted) return;
        // Ausweichen sofort selbst bewegen, der Gastgeber prüft Unverwundbarkeit
        const dur = p.g.animator.durationOf('roll', COMBAT.roll.speed);
        p.mode = 'roll';
        p.rollDir = dir;
        p.rollUntil = this.now + dur * 0.55;
        this.guestRollUntil = this.now + dur * 0.78;
        p.g.setHeading(Math.atan2(dir.x, dir.z));
        this.net.send('act', { type: 'roll', v: [dir.x, dir.z] });
        break;
      }
      case 'light':
      case 'heavy':
        if (p.focus && p.canAct) p.faceTarget();
        this.net.send('act', a);
        break;
      case 'bash':
      case 'cheer':
      case 'special':
        this.net.send('act', a);
        break;
      case 'lock':
        if (this.locked && this.enemies(p).length > 1) this.net.send('act', { type: 'target' });
        else {
          this.locked = !this.locked;
          this.manualUnlock = !this.locked;
          this.hud.setLocked(this.locked);
        }
        break;
    }
  }

  /** Gast: Bildaufbau ohne eigene Kampfregeln */
  private updateGuest(dt: number): void {
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      this.scene.animationTimeScale = this.slowmo > 0 ? 0.35 : 1;
    }
    this.now += dt;
    this.spec.update(dt);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.scene.animationTimeScale = this.hitStop > 0 ? 0.06 : 1;
    }
    this.autoLock();
    const acts = this.input.takeActions();
    if (!this.spec.inCeremony) for (const a of acts) this.sendGuestAction(a);
    this.interpolateOthers();
    this.life.update(dt);
    this.updateFocus();
    const p = this.player;
    if (this.now >= this.guestRollUntil && p.mode === 'roll') p.mode = 'free';
    if (!this.spec.inCeremony && p.mode !== 'dead') {
      this.movePlayer(dt);
      this.integrate(p, dt);
    }
    for (const f of this.fighters) f.g.animator.update(dt);
    // Eingabe an den Gastgeber (30-mal pro Sekunde)
    this.inTimer += dt;
    if (this.inTimer >= 1 / 30 && this.net) {
      this.inTimer = 0;
      this.net.send('in', { p: [p.pos.x, p.pos.z], h: p.g.heading, ly: p.g.legYaw, v: [p.vel.x, p.vel.z], bw: p.backwards });
    }
    this.fx.update(dt);
    this.gore.update(dt);
    this.bleed(dt);
    this.updateProjectiles(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  /** Gastgeber: Positionen der Gäste übernehmen (mit Plausibilitätsprüfung) und Schnappschüsse senden */
  private updateHostNet(dt: number): void {
    for (const [f, r] of this.remoteIn) {
      if (this.spec.inCeremony || f.mode === 'dead') continue;
      const dx = r.p[0] - f.pos.x;
      const dz = r.p[1] - f.pos.z;
      const d = Math.hypot(dx, dz);
      const max = 8 * Math.max(dt, 0.05) + 0.3;
      const k = d > max ? max / d : 1;
      f.pos.x += dx * k;
      f.pos.z += dz * k;
      if (f.mode !== 'roll') f.g.setHeading(r.h);
      f.g.legYaw = r.ly;
      f.vel.set(r.v[0], 0, r.v[1]);
      f.backwards = r.bw;
      f.g.animator.setSpeed(f.mode === 'free' ? Math.hypot(r.v[0], r.v[1]) : 0, r.bw);
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 0.05 && this.net) {
      this.snapTimer = 0;
      this.net.send('snap', { f: this.fighters.map((f) => this.netFighter(f)), x: Math.round(this.spec.excite * 100) / 100, bs: this.life.snap() });
    }
  }

  /* ---------- Ereignisse der Kämpfer ---------- */

  attackStart(f: Fighter, a: ActiveAttack): void {
    // Das Ziel (falls KI) bekommt den Angriff mit, wie ein Mensch es sehen würde
    const v = f.target;
    if (v) this.ais.get(v)?.onFoeAttack(a, this.now, f);
    const wait = Math.max(0, a.impactAt - this.now - 0.16);
    window.setTimeout(() => {
      if (f.attack === a) this.sfx('whoosh', a.heavy);
    }, wait * 1000);
  }

  message(f: Fighter, text: string): void {
    if (f === this.player) this.hud.hint(text, 1.2);
    else if (this.role === 'host' && this.isRemote(f)) this.send('ev', { k: 'msg', t: text, w: this.idx(f) });
  }

  private chest(f: Fighter): Vector3 {
    return f.pos.add(new Vector3(0, f.g.chestHeight + 0.35, 0));
  }

  private inFront(a: Fighter, b: Fighter, maxAngle: number): boolean {
    const d = b.pos.subtract(a.pos);
    return Math.abs(angleDiff(a.g.heading, Math.atan2(d.x, d.z))) < maxAngle;
  }

  /** Wen trifft ein Schlag? Bevorzugt das Ziel, sonst den nächsten Gegner im Schlagbereich */
  private victim(A: Fighter, reach: number, angle: number): Fighter | null {
    const ok = (D: Fighter) => D.mode !== 'dead' && D.team !== A.team && Vector3.Distance(A.pos, D.pos) <= reach && this.inFront(A, D, angle);
    if (A.target && ok(A.target)) return A.target;
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const D of this.fighters) {
      if (D === A || !ok(D)) continue;
      const d = Vector3.Distance(A.pos, D.pos);
      if (d < bd) {
        bd = d;
        best = D;
      }
    }
    return best;
  }

  /** Der Treffer-Moment eines Angriffs */
  impact(A: Fighter, a: ActiveAttack): void {
    this.resolve(A, a, false, null);
  }

  private grace: { A: Fighter; a: ActiveAttack; at: number; D: Fighter }[] = [];

  /** Parade, Block oder Treffer. Wer zu spät blockt, bekommt eine kurze Gnadenfrist. */
  private resolve(A: Fighter, a: ActiveAttack, afterGrace: boolean, fixed: Fighter | null): void {
    if (A.attack !== a || A.mode !== 'attack') return;
    let D = fixed ?? this.victim(A, A.kit.reach, COMBAT.maxAngle);
    if (!fixed) {
      // Ein Tier näher als der getroffene Gegner (und kein bewusst gewähltes Ziel)? Dann trifft es das Tier.
      const B = this.life.beastFor(A, A.kit.reach, COMBAT.maxAngle);
      if (B && (!D || (D !== A.target && Vector3.Distance(B.pos, A.pos) < Vector3.Distance(D.pos, A.pos)) || (A.focus && A.focus === B.pos))) {
        this.hitBeast(A, a, B);
        return;
      }
    }
    if (!D || D.mode === 'dead') {
      if (A === this.player && !afterGrace) this.sfx('whoosh', false);
      return;
    }
    const contact = Vector3.Lerp(A.pos, D.pos, 0.65);
    contact.y = D.g.chestHeight + (a.dir === 'top' ? 0.25 : 0);
    const push = D.pos.subtract(A.pos).normalize();

    if (this.now < D.invulnUntil) {
      this.float(this.chest(D), 'Ausgewichen', D, true, A);
      this.deed('dodge', D);
      return;
    }
    let facing = this.inFront(D, A, COMBAT.blockAngle);
    // Hakenschlag: greift um den Schild herum (Parade bleibt möglich)
    if (this.now < A.hookUntil) {
      A.hookUntil = 0;
      a.hooked = true;
    }
    const hooked = !!a.hooked;
    const parryWin = COMBAT.parryWindow + D.stats.parryBonus;

    // Parade: Block frisch gedrückt, kurz bevor der Schlag ankommt
    if (D.blocking && facing && this.now - D.blockStart <= parryWin) {
      D.parrySucceeded();
      A.drain(COMBAT.parried.stamina);
      A.stagger(COMBAT.parried.staggerTime, 'knockback', 1.1);
      this.impulse(A, push.scale(-2.8));
      this.sparks(contact);
      this.sparks(contact);
      this.setHitStop(0.16);
      this.setShake(0.35);
      this.hitFx(A, D, 'parry');
      this.float(this.chest(D), 'Parade!', D, true, A);
      if (D === this.player) this.hud.hint('Gegenangriff!', 0.8);
      this.sfx('clash', true);
      this.deed('parry', D);
      return;
    }

    if (hooked && D.blocking && facing) {
      facing = false;
      this.float(this.chest(D), 'Um den Schild!', A, true, D, true);
    }
    // Block
    if (D.blocking && facing) {
      const mul = this.mul(A, a, false);
      if (a.heavy || D.exhausted) {
        // Wuchtschlag (oder erschöpft): die Deckung bricht
        const chip = Math.round(a.def.damage * mul * COMBAT.heavyChip);
        this.sparks(contact);
        this.float(this.chest(D), 'Deckung bricht!', A, true, D, true);
        this.setHitStop(0.12);
        this.setShake(0.35);
        this.sfx('block', true);
        this.deed('heavy', A);
        D.drain(COMBAT.guardBreak.stamina);
        if (D.takeHit(chip, 'hit_chest', true)) return this.kill(D, push, a, A);
        D.guardBreak(COMBAT.guardBreak.stagger);
        this.impulse(D, push.scale(2.2));
        return;
      }
      this.sparks(contact);
      D.blockReact(a.def.damage * mul * COMBAT.blockStaminaFactor, false);
      this.impulse(D, push.scale(0.9));
      this.setShake(0.12);
      this.setHitStop(0.05);
      this.float(this.chest(D), 'Geblockt', D, true, A);
      if (D.kit.hasShield && Math.random() < 0.7) this.sfx('block', false);
      else this.sfx('clash');
      this.deed('block', D);
      return;
    }

    // Knapp zu spät? Kurz warten, ob der Block noch rechtzeitig kommt
    if (!afterGrace && (D.mode === 'free' || D.mode === 'block')) {
      this.grace.push({ A, a, at: this.now + COMBAT.blockGrace, D });
      return;
    }

    // Treffer mit Trefferzone und Rüstung
    let zoneKey: 'top' | 'side' | 'arm' | 'leg' = a.dir === 'top' ? 'top' : 'side';
    if (zoneKey === 'side') {
      const r = Math.random();
      if (r < 0.14) zoneKey = 'arm';
      else if (r < 0.28) zoneKey = 'leg';
    }
    const zone = COMBAT.zones[zoneKey] as { name: string; mult: number; anim: string; debuff?: string };
    const ar = D.kit.armor;
    const armor = zoneKey === 'top' ? ar.head : zoneKey === 'arm' ? ar.arm : zoneKey === 'leg' ? ar.leg : ar.body;
    const weak = this.now < A.weakUntil ? 0.75 : 1;
    const dmg = Math.round(a.def.damage * this.mul(A, a, zoneKey === 'top') * zone.mult * (1 - armor) * weak);
    if (zone.debuff === 'weak') D.weakUntil = this.now + 3;
    if (zone.debuff === 'slow') D.slowUntil = this.now + 3;
    const big = a.heavy || a.combo === 3 || a.power > 1.2;
    this.blood(contact, push, big ? 1.6 : 1);
    if (big) this.blood(contact.add(new Vector3(0, 0.15, 0)), push.add(new Vector3(0, 0.4, 0)), 1.2);
    this.wound(D, contact, big ? 0.11 : 0.07);
    this.bloodyWeapon(A, big ? 0.22 : 0.12);
    this.setShake(big ? 0.5 : 0.26);
    this.setHitStop(big ? 0.13 : 0.07);
    this.hitFx(A, D, big ? 'big' : 'hit');
    this.float(this.chest(D), `${zone.name} −${dmg}`, A, true, D, big);
    this.sfx('hit', big);
    this.deed(zoneKey === 'top' ? 'head' : a.heavy ? 'heavy' : 'hit', A);
    if (D.takeHit(dmg, big ? 'knockback' : zone.anim, big)) return this.kill(D, push, a, A);
    this.impulse(D, push.scale(big ? 3.2 : 1.6));
  }

  /** Schadensfaktor aus den Attributen des Angreifers */
  private mul(A: Fighter, a: ActiveAttack, head: boolean): number {
    const ch = this.now < this.challengeUntil ? 1.3 : 1;
    return (a.heavy ? A.stats.heavyMul : A.stats.lightMul) * (head ? A.stats.headMul : 1) * a.power * ch;
  }

  /** Treffer durch Tier oder Falle (Block, Parade und Ausweichen gelten auch hier) */
  envHit(D: Fighter, dmg: number, from: Vector3, kind: EnvHitKind): EnvHitResult {
    if (D.mode === 'dead') return 'dodge';
    const push = D.pos.subtract(from);
    push.y = 0;
    if (push.length() < 1e-3) push.set(Math.sin(D.g.heading + Math.PI), 0, Math.cos(D.g.heading + Math.PI));
    push.normalize();
    const contact = D.pos.add(push.scale(-0.35));
    contact.y = kind === 'spikes' ? 0.6 : D.g.chestHeight - (kind === 'bite' ? 0.35 : 0.1);
    if (this.now < D.invulnUntil) {
      this.float(this.chest(D), 'Ausgewichen', D, true);
      this.deed('dodge', D);
      this.spec.kick(0.2);
      return 'dodge';
    }
    const toSrc = from.subtract(D.pos);
    const facing = Math.abs(angleDiff(D.g.heading, Math.atan2(toSrc.x, toSrc.z))) < COMBAT.blockAngle;
    if (kind !== 'spikes' && D.blocking && facing) {
      if (kind !== 'charge' && this.now - D.blockStart <= COMBAT.parryWindow + D.stats.parryBonus) {
        D.parrySucceeded();
        this.sparks(contact);
        this.setHitStop(0.12);
        this.setShake(0.3);
        this.float(this.chest(D), 'Parade!', D, true);
        this.sfx('clash', true);
        this.deed('parry', D);
        return 'parry';
      }
      if (kind === 'charge') {
        this.sparks(contact);
        this.float(this.chest(D), 'Umgerannt!', D, false);
        this.sfx('block', true);
        this.setShake(0.55);
        D.drain(40);
        if (D.takeHit(Math.round(dmg * 0.3), 'knockback', true)) {
          this.kill(D, push, null, null);
          return 'hit';
        }
        D.guardBreak(1.1);
        this.impulse(D, push.scale(5.5));
        return 'block';
      }
      D.blockReact(dmg * 1.3, false);
      this.sparks(contact);
      this.sfx('block', false);
      this.float(this.chest(D), 'Geblockt', D, true);
      this.impulse(D, push.scale(1.2));
      this.deed('block', D);
      return 'block';
    }
    const big = kind === 'charge' || kind === 'spikes';
    const label = kind === 'bite' ? 'Biss' : kind === 'charge' ? 'Hörner' : kind === 'horn' ? 'Stoß' : 'Spieße';
    this.blood(contact, kind === 'spikes' ? new Vector3(0, 1, 0) : push, big ? 2 : 1.2);
    this.wound(D, contact, big ? 0.12 : 0.08);
    this.setShake(big ? 0.55 : 0.28);
    this.setHitStop(big ? 0.12 : 0.06);
    this.applyHitFx(D, D, big ? 'big' : 'hit');
    this.send('ev', { k: 'hfx', a: this.idx(D), d: this.idx(D), x: big ? 'big' : 'hit' });
    this.float(this.chest(D), `${label} −${dmg}`, D, false, null, big);
    this.sfx('hit', big);
    if (D.takeHit(dmg, big ? 'knockback' : 'hit_chest', big)) {
      this.kill(D, kind === 'spikes' ? new Vector3(0, 1, 0) : push, null, null);
      return 'hit';
    }
    if (kind === 'spikes') D.slowUntil = this.now + 3;
    this.impulse(D, push.scale(kind === 'charge' ? 6 : kind === 'spikes' ? 0.5 : 1.4));
    return 'hit';
  }

  /** Schlag eines Kämpfers gegen ein Tier */
  private hitBeast(A: Fighter, a: ActiveAttack, b: (typeof this.life.beasts)[number]): void {
    const dir = b.pos.subtract(A.pos);
    dir.y = 0;
    dir.normalize();
    const big = a.heavy || a.combo === 3;
    const dmg = Math.round(a.def.damage * this.mul(A, a, false) * (b.mode === 'stun' ? 1.5 : 1));
    const p = b.pos.add(new Vector3(0, BEAST[b.kind].height * 0.65, 0)).subtract(dir.scale(BEAST[b.kind].radius * 0.4));
    this.blood(p, dir, big ? 1.8 : 1.2);
    this.bloodyWeapon(A, big ? 0.2 : 0.1);
    this.setShake(big ? 0.4 : 0.2);
    this.setHitStop(big ? 0.1 : 0.05);
    this.sfx('hit', big);
    this.float(p.add(new Vector3(0, 0.4, 0)), `${BEAST[b.kind].name} −${dmg}`, A, true, null, big);
    this.deed(big ? 'heavy' : 'hit', A);
    if (this.life.damage(b, dmg, dir, big, A)) this.deed('kill', A);
  }

  bashImpact(A: Fighter): void {
    if (A.mode !== 'bash') return;
    const D = this.victim(A, COMBAT.bash.range, 1.0) ?? this.opp(A);
    if (!D || D.mode === 'dead') return;
    const dist = Vector3.Distance(A.pos, D.pos);
    if (dist > COMBAT.bash.range || !this.inFront(A, D, 1.0) || this.now < D.invulnUntil) {
      A.modeUntil += COMBAT.bash.missLock;
      this.float(this.chest(D), 'Daneben', A, false, D);
      return;
    }
    if (D.mode === 'attack' && D.attack && this.now < D.attack.impactAt && !D.blocking) {
      this.float(this.chest(D), 'Zu langsam', A, false, D);
      return;
    }
    if (D.mode === 'bash') {
      this.float(this.chest(D), 'Konter', D, null);
      this.sparks(this.chest(D));
      return;
    }
    const push = D.pos.subtract(A.pos).normalize();
    const wasBlocking = D.blocking;
    // Gegen Blocker besonders stark: Deckung bricht
    D.guardBreak(wasBlocking ? COMBAT.bash.staggerTime : COMBAT.bash.staggerTime * 0.55);
    D.drain(COMBAT.bash.targetStamina * A.stats.bashMul * (wasBlocking ? 1.3 : 0.7));
    this.impulse(D, push.scale(wasBlocking ? 4.2 : 3));
    this.setShake(0.3);
    this.setHitStop(0.08);
    this.float(this.chest(D), wasBlocking ? 'Deckung gebrochen!' : 'Gestoßen', A, true, D);
    this.sfx('block', true);
    this.deed('bash', A);
  }

  /** Ein Kämpfer fällt. killer kann fehlen (Wurfspeer ohne Besitzer o. Ä.) */
  kill(D: Fighter, push: Vector3, a: ActiveAttack | null = null, killer: Fighter | null = null): void {
    if (D.mode === 'dead') return;
    const duel = this.mode === 'duel';
    const finalBlow = duel && !this.roundOver && (this.teamWins[1 - D.team] ?? 0) + 1 >= WINS_NEEDED;
    this.blood(this.chest(D), push, 2.2);
    this.goreKill(D, push, a, finalBlow);
    D.die();
    D.setBlock(false);
    if (killer) killer.kills++;
    this.impulse(D, push.scale(1.5));
    this.setHitStop(0.25);
    window.setTimeout(() => this.sfx('fall'), 450);
    window.setTimeout(() => this.bloodPool(D), 1200);
    if (killer) this.deed('kill', killer);
    else this.spec.kick(1);
    this.send('ev', { k: 'dead', w: this.idx(D) });
    this.updateTargets(true);
    if (duel) this.duelKill(D);
    else this.groupKill(D);
  }

  private duelKill(D: Fighter): void {
    if (this.roundOver) return;
    this.roundOver = true;
    this.life.retreat();
    const winner = this.fighters.find((f) => f !== D && f.mode !== 'dead') ?? this.opp(D) ?? this.player;
    const wt = winner.team;
    this.teamWins[wt] = (this.teamWins[wt] ?? 0) + 1;
    const won = wt === this.player.team;
    this.hud.hint(won ? 'Sieg! Der Gegner liegt im Sand.' : 'Du bist gefallen …', 3.5);
    this.updateScore();
    const over = this.teamWins[wt] >= WINS_NEEDED;
    this.send('ev', { k: 'round', wt, s: this.teamWins, m: over, ks: this.fighters.map((f) => [f.kills, f.parries]) });
    if (over) {
      this.matchOver = true;
      this.pendingResult = this.makeResult(won);
      this.slowmo = 1.4;
      this.spec.start(winner, D);
    } else window.setTimeout(() => this.newRound(), 4500);
  }

  /** Gruppenkampf: vorbei, wenn nur noch ein Team steht */
  private groupKill(D: Fighter): void {
    this.updateScore();
    if (D === this.player) this.hud.hint('Du bist gefallen – schau zu', 3);
    const alive = new Set(this.fighters.filter((f) => f.mode !== 'dead').map((f) => f.team));
    if (alive.size > 1 || this.matchOver) return;
    this.matchOver = true;
    this.life.retreat();
    const wt = alive.size === 1 ? [...alive][0] : -1;
    if (wt >= 0) this.teamWins[wt] = 1;
    const won = wt === this.player.team;
    this.slowmo = 1.3;
    this.spec.kick(1);
    this.arena.crowd.wave();
    this.sound.roar(1, 3);
    this.hud.hint(won ? 'Sieg! Die Arena gehört euch.' : 'Niederlage …', 3);
    this.pendingResult = this.makeResult(won);
    this.send('ev', { k: 'round', wt, s: this.teamWins, m: true, ks: this.fighters.map((f) => [f.kills, f.parries]) });
    this.later(3.2, () => this.ceremonyDone('missio'));
  }

  /** Ergebnis aus Sicht des eigenen Kämpfers */
  private makeResult(won: boolean): Omit<MatchResult, 'verdict'> {
    const me = this.player;
    const foes = this.fighters.filter((f) => f.team !== me.team);
    const lvl = foes.length ? Math.round(foes.reduce((s, f) => s + f.info.level, 0) / foes.length) : 1;
    const name = foes.length === 1 ? foes[0].info.name : this.mode === 'duel' ? (foes[0]?.info.name ?? 'Gegner') : `${foes.length} Gegner`;
    return {
      won,
      mode: this.mode,
      wins: this.teamWins[me.team] ?? 0,
      losses: Math.max(0, ...this.teamWins.filter((_, t) => t !== me.team)),
      foe: { name, level: lvl },
      enemies: foes.length,
      kills: me.kills,
      parries: me.parries,
      pvp: this.role !== 'solo' || this.fighters.some((f) => this.isRemote(f)),
    };
  }

  /* ---------- Blut und Zerstückelung ---------- */

  /** Körperteil abtrennen (auch beim Gast) */
  sever(f: Fighter, part: SeverPart, dir: Vector3, power = 1): void {
    if (!this.gore.sever(f.g, part, dir, power)) return;
    this.sfx('hit', true);
    this.setShake(0.6);
    if (Vector3.Distance(this.camera.position, f.pos) < 5) this.hud.screenBlood?.(1);
    this.send('ev', { k: 'sever', w: this.idx(f), part, d: [dir.x, dir.y, dir.z], pw: power });
  }

  /** Wunde am Körper an der Trefferstelle */
  private wound(f: Fighter, contact: Vector3, size: number): void {
    const bone = f.g.nodes.get(contact.y > f.pos.y + f.g.chestHeight + 0.1 ? 'spine_03' : 'spine_02') ?? f.g.nodes.get('spine_02');
    if (!bone) return;
    this.fx.wound(f.g.id, bone, contact, size);
    this.send('ev', { k: 'wound', w: this.idx(f), p: [contact.x, contact.y, contact.z], s: size });
  }

  /** Blut an der Waffe des Angreifers */
  private bloodyWeapon(f: Fighter, add: number): void {
    const k = Math.min(1, (this.weaponBlood.get(f) ?? 0) + add * this.fx.goreMul);
    this.weaponBlood.set(f, k);
    f.g.setWeaponBlood(k);
    this.send('ev', { k: 'wblood', w: this.idx(f), v: k });
  }

  /** Blutung bei wenig Leben: Tropfen, Flecken im Sand */
  private bleed(dt: number): void {
    for (const f of this.fighters) {
      if (f.mode === 'dead' && f.g.severedParts === 0) continue;
      const hpk = f.g.hp / f.stats.hpMax;
      const rate = f.mode === 'dead' ? 3 : hpk < 0.5 ? (0.5 - hpk) * 14 : 0;
      if (rate > 0 && Math.random() < rate * dt) {
        this.fx.drip(f.pos.add(new Vector3((Math.random() - 0.5) * 0.3, f.g.chestHeight * (0.4 + Math.random() * 0.6), (Math.random() - 0.5) * 0.3)), 3);
      }
    }
  }

  /** Beim tödlichen Treffer: was fliegt weg? */
  private goreKill(D: Fighter, push: Vector3, a: ActiveAttack | null, final: boolean): void {
    if (this.gore.level !== 'full') return;
    const big = !!a && (a.heavy || a.combo === 3 || a.power > 1.2);
    if (Math.random() > (big ? 0.7 : 0.3)) return;
    const r = Math.random();
    // Im letzten Duell bleibt der Kopf dran – der Kaiser entscheidet noch
    let part: SeverPart = r < 0.42 && !final ? 'head' : r < 0.67 ? 'armR' : r < 0.8 ? 'armL' : Math.random() < 0.5 ? 'legL' : 'legR';
    if (final && part === 'head') part = 'armR';
    this.sever(D, part, push, big ? 1.4 : 1);
    if (big && Math.random() < 0.3) {
      const second: SeverPart = part === 'armR' ? 'armL' : 'armR';
      this.later(0.12, () => this.sever(D, second, push, 1.1));
    }
  }

  /** Blutlache unter einem Körper (auch beim Gast) */
  private bloodPool(f: Fighter): void {
    const p = f.pos.add(new Vector3(Math.sin(f.g.heading) * -0.6, 0, Math.cos(f.g.heading) * -0.6));
    this.fx.pool(p);
    this.send('ev', { k: 'pool', p: [p.x, p.z] });
  }

  /* ---------- Sonderfähigkeiten ---------- */

  private challengeUntil = 0;
  private timers: { at: number; fn: () => void }[] = [];
  private projectiles: { mesh: Mesh; from: Vector3; to: Vector3; t: number; dur: number; kind: 'javelin' | 'net'; owner: Fighter | null; spin: number }[] = [];

  /** In Spielzeit verzögert ausführen (läuft mit Zeitlupe und Pause) */
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.now + sec, fn });
  }

  private runTimers(): void {
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.now);
    this.timers = this.timers.filter((t) => t.at > this.now);
    for (const t of due) t.fn();
  }

  /** Sonderfähigkeit der Klasse */
  special(f: Fighter): void {
    if (this.role === 'guest') return;
    if (!f.canAct || f.mode === 'dead' || this.now < f.specialReadyAt || this.spec.inCeremony) return;
    const def = CLASSES[f.cls].special;
    const D = this.opp(f);
    if (!D) return;
    if (f.mode === 'block') f.setBlock(false);
    f.specialReadyAt = this.now + def.cooldown;
    this.float(this.chest(f), def.name + '!', f, true);
    switch (def.id) {
      case 'ram': {
        f.faceTarget();
        const fw = new Vector3(Math.sin(f.g.heading), 0, Math.cos(f.g.heading));
        f.interruptAttack();
        f.mode = 'special';
        f.modeUntil = this.now + 0.85;
        f.dashDir = fw;
        f.dashUntil = this.now + 0.55;
        f.lastAction = f.g.animator.play('shield_dash', { speed: 1.2, fadeIn: 0.06 });
        let done = false;
        const check = () => {
          if (done || f.mode !== 'special') return;
          const V = this.victim(f, 1.6, 1.1);
          if (V && this.now >= V.invulnUntil) {
            done = true;
            f.dashUntil = 0;
            const push = V.pos.subtract(f.pos).normalize();
            V.guardBreak(1.0);
            V.drain(25);
            this.impulse(V, push.scale(5));
            this.setShake(0.5);
            this.setHitStop(0.12);
            this.hitFx(f, V, 'big');
            this.sfx('block', true);
            this.float(this.chest(V), 'Umgerannt!', f, true, V, true);
            this.deed('bash', f);
          }
        };
        for (let i = 1; i <= 7; i++) this.later(i * 0.085, check);
        break;
      }
      case 'pursuit':
        f.buffUntil = this.now + 4;
        this.spec.kick(0.3);
        break;
      case 'hook':
        f.hookUntil = this.now + 5;
        if (f === this.player) this.hud.hint('Hakenschlag bereit: der nächste Schlag geht um den Schild', 2);
        break;
      case 'javelin':
      case 'net': {
        f.faceTarget();
        f.interruptAttack();
        f.mode = 'special';
        f.modeUntil = this.now + 0.9;
        f.lastAction = f.g.animator.play('throw', { speed: 1.25, fadeIn: 0.06 });
        this.later(0.33, () => {
          if (f.mode === 'dead' || D.mode === 'dead') return;
          const from = f.pos.add(new Vector3(0, 1.6, 0));
          const to = D.pos.add(new Vector3(0, def.id === 'net' ? 1.0 : 1.25, 0));
          this.throwProjectile(def.id as 'javelin' | 'net', from, to, f);
        });
        break;
      }
      case 'challenge':
        this.challengeUntil = this.now + 6;
        this.spec.kick(0.8);
        this.arena.crowd.wave();
        if (f === this.player || D === this.player) this.hud.hint('Herausforderung! 6 Sekunden mehr Schaden für alle', 2.2);
        break;
    }
  }

  /** Wurfspeer oder Netz fliegt (auch beim Gast sichtbar) */
  private throwProjectile(kind: 'javelin' | 'net', from: Vector3, to: Vector3, owner: Fighter | null): void {
    const dist = Vector3.Distance(from, to);
    const dur = Math.max(0.25, dist / (kind === 'net' ? 13 : 22));
    let mesh: Mesh;
    if (kind === 'net') {
      mesh = buildNet(this.scene, this.player.g.mat);
      mesh.scaling.setAll(0.4);
    } else {
      mesh = MeshBuilder.CreateCylinder('javelin', { height: 1.6, diameterTop: 0.01, diameterBottom: 0.03, tessellation: 6 }, this.scene);
      mesh.material = this.player.g.mat.wood;
    }
    mesh.position.copyFrom(from);
    this.projectiles.push({ mesh, from, to, t: 0, dur, kind, owner, spin: 0 });
    this.sfx('whoosh', true);
    if (owner) this.send('ev', { k: 'proj', kind, f: [from.x, from.y, from.z], t: [to.x, to.y, to.z] });
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const pos = Vector3.Lerp(p.from, p.to, k);
      pos.y += Math.sin(k * Math.PI) * (p.kind === 'net' ? 0.8 : 0.5);
      if (p.kind === 'net') {
        p.mesh.scaling.setAll(0.4 + k * 0.8);
        p.mesh.rotation.x = Math.PI / 2 - 0.4;
        p.mesh.rotation.y += dt * 8;
      } else {
        const dir = p.to.subtract(p.from).normalize();
        p.mesh.rotation.x = Math.PI / 2 - 0.2 + k * 0.4;
        p.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      }
      p.mesh.position.copyFrom(pos);
      if (k >= 1) this.projectileArrives(p);
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);
  }

  private projectileArrives(p: (typeof this.projectiles)[number]): void {
    window.setTimeout(() => p.mesh.dispose(), p.kind === 'net' ? 100 : 400);
    const A = p.owner;
    if (!A || this.role === 'guest') return;
    // Getroffen wird, wer am Zielpunkt steht (auch ein anderer Gegner)
    let D: Fighter | null = null;
    let bd = 1.4;
    for (const f of this.fighters) {
      if (f.team === A.team || f.mode === 'dead') continue;
      const d = Vector3.Distance(f.pos.add(new Vector3(0, 1.1, 0)), p.to);
      if (d < bd) {
        bd = d;
        D = f;
      }
    }
    const aimed = A.target ?? this.opp(A);
    if (!D || this.now < D.invulnUntil) {
      if (aimed) {
        this.float(this.chest(aimed), 'Daneben', aimed, true, A);
        this.deed('dodge', aimed);
      }
      return;
    }
    if (p.kind === 'javelin') {
      if (D.blocking && this.inFront(D, A, COMBAT.blockAngle)) {
        D.blockReact(14, true);
        this.sparks(this.chest(D));
        this.sfx('block', true);
        this.float(this.chest(D), 'Abgewehrt', D, true, A);
        return;
      }
      const dmg = Math.round(18 * A.kit.damage * A.stats.lightMul * (1 - D.kit.armor.body));
      this.blood(this.chest(D), D.pos.subtract(A.pos).normalize());
      this.sfx('hit', true);
      this.hitFx(A, D, 'big');
      this.float(this.chest(D), `Speer −${dmg}`, A, true, D, true);
      this.deed('heavy', A);
      if (D.takeHit(dmg, 'hit_chest', true)) this.kill(D, D.pos.subtract(A.pos).normalize(), null, A);
      return;
    }
    // Netz
    if (D.cls === 'secutor' && Math.random() < 0.4) {
      this.float(this.chest(D), 'Netz rutscht ab', D, true, A);
      return;
    }
    D.setBlock(false);
    D.stagger(1.6, 'hit_chest', 0.5);
    D.guardBrokenUntil = this.now + 1.8;
    this.float(this.chest(D), 'Gefangen!', A, true, D, true);
    this.deed('heavy', A);
    this.spec.kick(0.6);
    this.netOn(D.pos.clone(), 1.6);
    this.send('ev', { k: 'net', p: [D.pos.x, D.pos.z], d: 1.6 });
  }

  /** Netz liegt über dem Gefangenen */
  private netOn(at: Vector3, sec: number): void {
    const n = buildNet(this.scene, this.player.g.mat);
    n.position.set(at.x, 1.0, at.z);
    n.rotation.x = Math.PI / 2 - 0.25;
    n.scaling.setAll(0.75);
    window.setTimeout(() => n.dispose(), sec * 1000);
  }

  /** Waffenspur nur im Schwung */
  private updateTrails(): void {
    for (const f of this.fighters) {
      const tip = f.g.tip;
      if (!tip) continue;
      let t = this.trails.get(f);
      if (!t) {
        if (!this.trailMat) {
          const m = new StandardMaterial('trailMat', this.scene);
          m.emissiveColor = new Color3(1, 0.93, 0.8);
          m.diffuseColor = Color3.Black();
          m.specularColor = Color3.Black();
          m.disableLighting = true;
          m.alpha = 0.22;
          m.backFaceCulling = false;
          this.trailMat = m;
        }
        t = new TrailMesh('trail', tip, this.scene, 0.05, 16, true);
        t.material = this.trailMat;
        t.isPickable = false;
        this.trails.set(f, t);
      }
      let impactAt: number | undefined;
      if (this.role === 'guest') impactAt = this.remoteAtk.get(f);
      else if (f.mode === 'attack' && f.attack) impactAt = f.attack.impactAt;
      t.isVisible = impactAt !== undefined && this.now > impactAt - 0.22 && this.now < impactAt + 0.12;
    }
  }

  /* ---------- Duell-Ende ---------- */

  /** Todesstoß nach „Iugula!“ */
  private finisher(w: Fighter, l: Fighter): void {
    w.mode = 'free';
    w.target = l;
    w.faceTarget();
    w.lastAction = w.g.animator.play('heavy', {
      range: [1.9, 3.1],
      speed: 0.9,
      fadeIn: 0.1,
      events: [
        {
          at: 0.42,
          fn: () => {
            const p = l.pos.add(new Vector3(0, l.g.chestHeight, 0));
            const dir = l.pos.subtract(w.pos).normalize();
            for (let i = 0; i < 3; i++) this.blood(p.add(new Vector3(0, i * 0.12, 0)), dir, 2.5);
            // Iugula: der Kopf fliegt
            if (this.gore.level === 'full') this.sever(l, 'head', dir.add(new Vector3(0, 0.3, 0)), 1.3);
            else this.wound(l, p, 0.14);
            this.bloodyWeapon(w, 0.5);
            this.sfx('hit', true);
            this.setShake(0.5);
            this.setHitStop(0.18);
            l.mode = 'dead';
            l.g.animator.play('death', { fadeIn: 0.05, loop: true });
            window.setTimeout(() => l.g.animator.pause('death'), l.g.animator.durationOf('death') * 900);
            window.setTimeout(() => this.sfx('fall'), 500);
            window.setTimeout(() => this.bloodPool(l), 900);
          },
        },
      ],
    });
  }

  private ceremonyDone(v: Verdict): void {
    this.send('ev', { k: 'done', v });
    if (this.pendingResult) this.onMatchEnd?.({ ...this.pendingResult, verdict: v });
    this.pendingResult = null;
  }

  private doCheer(f: Fighter): void {
    if (f.mode !== 'free' || this.spec.inCeremony) return;
    const o = this.opp(f);
    const d = o ? Vector3.Distance(f.pos, o.pos) : 99;
    if (d > 2.6) f.lastAction = f.g.animator.play('cheer', { speed: 1.3 });
    this.spec.cheer(f);
  }

  private newRound(): void {
    this.gore.clear(this.fighters.map((f) => f.g));
    this.fx.clearWounds();
    for (const f of this.fighters) {
      if (f.mode === 'dead') f.revive();
      else f.refill();
    }
    this.roundOver = false;
    this.life.reset();
    this.updateTargets(true);
    for (const a of this.ais.values()) a.reset(this.now);
    this.spec.resetRound();
    this.hud.hint('Nächste Runde – kämpft!', 2);
    this.send('ev', { k: 'next' });
  }

  /* ---------- Eingaben ---------- */

  private camForward(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private stickWorld(): Vector3 {
    const m = this.input.move;
    const f = this.camForward();
    const r = new Vector3(f.z, 0, -f.x);
    return f.scale(m.y).add(r.scale(m.x));
  }

  private handle(a: Action): void {
    const p = this.player;
    if (p.mode === 'dead') return;
    switch (a.type) {
      case 'light':
      case 'heavy':
        p.startAttack(a.type === 'heavy');
        break;
      case 'block':
        p.setBlock(a.on);
        break;
      case 'bash':
        p.bash();
        break;
      case 'special':
        this.special(p);
        break;
      case 'roll': {
        let dir = this.stickWorld();
        const fw = new Vector3(Math.sin(p.g.heading), 0, Math.cos(p.g.heading));
        const right = new Vector3(fw.z, 0, -fw.x);
        if (a.dir === 'left') dir = right.scale(-1);
        else if (a.dir === 'right') dir = right;
        else if (a.dir === 'forward') dir = fw;
        else if (a.dir === 'back' || dir.length() < 0.25) dir = fw.scale(-1);
        p.setBlock(false);
        p.roll(dir);
        break;
      }
      case 'lock':
        if (this.locked && this.enemies(p).length > 1) this.cycleTarget(p);
        else {
          this.locked = !this.locked;
          this.manualUnlock = !this.locked;
          this.hud.setLocked(this.locked);
        }
        break;
      case 'cheer':
        this.doCheer(p);
        break;
    }
  }

  /** Automatisch aufschalten, wenn ein Gegner nah ist */
  private autoLock(): void {
    const t = this.player.target;
    const dist = t ? Vector3.Distance(this.player.pos, t.pos) : 99;
    if (!this.locked && !this.manualUnlock && t && dist < this.lockRange && t.mode !== 'dead') {
      this.locked = true;
      this.hud.setLocked(true);
    }
    if (this.manualUnlock && dist > this.lockRange + 4) this.manualUnlock = false;
    this.input.locked = this.locked;
  }

  /* ---------- Hauptschleife ---------- */

  private lastFoeLabel = '';

  update(rawDt: number, daylight: number, freeze = false): void {
    if (this.role === 'guest') {
      this.updateGuest(Math.min(rawDt, 0.05));
      this.arena.update(Math.min(rawDt, 0.05), daylight);
      return;
    }
    let dt = Math.min(rawDt, 0.05);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      const slow = this.hitStop > 0 ? 0.06 : 1;
      this.scene.animationTimeScale = slow;
      dt *= slow;
    } else if (this.slowmo > 0) {
      this.slowmo -= dt;
      const slow = this.slowmo > 0 ? 0.35 : 1;
      this.scene.animationTimeScale = slow;
      dt *= slow;
    }
    this.now += dt;
    for (const f of this.fighters) f.tick(this.now, dt);
    this.updateTargets();
    this.autoLock();

    const ceremony = this.spec.inCeremony;
    const acts = this.input.takeActions();
    if (!ceremony) for (const a of acts) this.handle(a);
    // Gnadenfrist abarbeiten
    const due = this.grace.filter((g) => g.at <= this.now);
    this.grace = this.grace.filter((g) => g.at > this.now);
    for (const g of due) this.resolve(g.A, g.a, true, g.D);
    this.updateFocus();
    if (!freeze && !ceremony) for (const [f, ai] of this.ais) this.aiMoves.set(f, ai.update(this.now));
    this.spec.update(dt);
    this.life.update(dt);

    if (ceremony) this.moveCeremony(dt);
    else {
      if (this.player.owner === 'local') this.movePlayer(dt);
      for (const f of this.ais.keys()) this.moveAi(f, dt, freeze);
    }
    if (this.role === 'host') this.updateHostNet(dt);
    for (const f of this.fighters) {
      if (!(this.role === 'host' && this.isRemote(f) && !ceremony)) this.integrate(f, dt);
      f.g.animator.update(dt);
    }
    this.arena.update(dt, daylight);
    this.fx.update(dt);
    this.runTimers();
    this.gore.update(dt);
    this.bleed(dt);
    this.updateProjectiles(dt);
    if (!freeze) this.updateCamera(dt);
    this.updateHud();
  }

  private pct(f: Fighter, k: 'hp' | 'st'): number {
    return k === 'hp' ? (100 * f.g.hp) / f.stats.hpMax : (100 * f.g.stamina) / f.stats.staminaMax;
  }

  private updateSpecialHud(): void {
    const p = this.player;
    const def = CLASSES[p.cls].special;
    this.hud.special?.(def.name, Math.max(0, p.specialReadyAt - this.now), def.cooldown);
  }

  private updateHud(): void {
    const p = this.player;
    const foe = this.foe;
    this.updateSpecialHud();
    this.hud.favor(p.favor, foe.favor);
    this.hud.setBars(this.pct(p, 'hp'), this.pct(p, 'st'), p.exhausted);
    const label = `${foe.info.name} · Stufe ${foe.info.level}`;
    if (label !== this.lastFoeLabel) {
      this.lastFoeLabel = label;
      this.hud.foeName(label);
      this.updateScore();
    }
    this.updateMarks();
    if (!this.locked || foe.mode === 'dead' || foe === p) {
      this.hud.guard(null);
      return;
    }
    let incoming = false;
    let heavy = false;
    let impactIn: number | null = null;
    let windup = 1;
    if (this.role === 'guest') {
      const fa = this.foeAttackLocal;
      incoming = !!fa && this.now < fa.impactAt;
      heavy = !!fa?.hv;
      impactIn = fa && incoming && this.blockAssist !== 'off' ? fa.impactAt - this.now : null;
      windup = fa?.wu ?? 1;
    } else {
      // Angriffe auf mich: vom Ziel oder von jedem anderen Gegner, der mich anvisiert
      let fa: ActiveAttack | null = null;
      for (const o of this.enemies(p)) {
        if (o.target !== p || !o.attack || this.now >= o.attack.impactAt) continue;
        if (!fa || o.attack.impactAt < fa.impactAt) fa = o.attack;
      }
      incoming = !!fa;
      heavy = !!fa?.heavy;
      impactIn = fa && this.blockAssist !== 'off' ? fa.impactAt - this.now : null;
      windup = fa ? fa.impactAt - fa.start : 1;
    }
    this.hud.guard({
      anchor: foe.pos.add(new Vector3(0, foe.g.chestHeight - 0.05, 0)),
      blocking: p.blocking,
      foeBlocking: foe.blocking,
      incoming,
      heavy,
      impactIn,
      windup,
      parryWindow: COMBAT.parryWindow + p.stats.parryBonus,
      foeHp: this.pct(foe, 'hp'),
      foeSt: this.pct(foe, 'st'),
    });
  }

  /** Namen und Leben über allen anderen Kämpfern */
  private updateMarks(): void {
    if (!this.hud.marks) return;
    if (this.spec.inCeremony) {
      this.hud.marks([]);
      return;
    }
    const me = this.player;
    const list: Mark[] = [];
    for (const b of this.life.visible) {
      const s = this.hud.project(b.pos.add(new Vector3(0, BEAST[b.kind].height + 0.45, 0)));
      if (s) list.push({ x: s.x, y: s.y, hp: (100 * b.hp) / BEAST[b.kind].hp, ally: false, name: BEAST[b.kind].name });
    }
    for (const f of this.fighters) {
      if (this.fighters.length <= 2) break;
      if (f === me || f.mode === 'dead' || (this.locked && f === this.foe)) continue;
      const s = this.hud.project(f.pos.add(new Vector3(0, f.g.chestHeight + 0.75, 0)));
      if (!s) continue;
      list.push({ x: s.x, y: s.y, hp: this.pct(f, 'hp'), ally: f.team === me.team, name: f.info.name });
    }
    this.hud.marks(list);
  }

  /* ---------- Bewegung ---------- */

  private maxSpeed(f: Fighter, locked: boolean): number {
    let s = (locked ? 2.8 : 6.0) * f.stats.moveMul * f.kit.move;
    if (this.now < f.buffUntil) s *= 1.4;
    if (this.now < f.slowUntil) s *= 0.6;
    if (f.exhausted) s *= 0.7;
    return s;
  }

  private steer(f: Fighter, wish: Vector3, mag: number, locked: boolean, dt: number): void {
    const g = f.g;
    let target = 0;
    let dir = wish.length() > 1e-3 ? wish.normalize() : Vector3.Zero();
    if (f.mode === 'free') {
      target = mag * this.maxSpeed(f, locked);
    } else if (f.mode === 'block') {
      target = mag * this.maxSpeed(f, locked) * COMBAT.blockMove;
    } else if (f.mode === 'attack' && f.attack && f.target) {
      // Beim Ausholen leicht auf den Gegner zugehen, damit der Schlag sitzt
      const d = f.target.pos.subtract(f.pos);
      d.y = 0;
      if (this.now < f.attack.impactAt && d.length() > 1.7 && d.length() < f.kit.reach + 1.2) {
        dir = d.normalize();
        target = 1.4;
      }
    }
    f.speed += (target - f.speed) * Math.min(1, dt * 9);

    // Blickrichtung
    if (f.mode !== 'roll' && f.mode !== 'dead') {
      if (locked && f.focus && f.mode !== 'free') {
        const d = f.focus.subtract(f.pos);
        g.setHeading(g.heading + angleDiff(g.heading, Math.atan2(d.x, d.z)) * Math.min(1, dt * 12));
      } else if (locked && f.focus && mag < 0.05) {
        const d = f.focus.subtract(f.pos);
        g.setHeading(g.heading + angleDiff(g.heading, Math.atan2(d.x, d.z)) * Math.min(1, dt * 8));
      } else if (locked && f.target && f.target.mode !== 'dead') {
        const d = f.target.pos.subtract(f.pos);
        const want = Math.atan2(d.x, d.z);
        g.setHeading(g.heading + angleDiff(g.heading, want) * Math.min(1, dt * 12));
      } else if (mag > 0.05 && f.mode === 'free') {
        const want = Math.atan2(wish.x, wish.z);
        g.setHeading(g.heading + angleDiff(g.heading, want) * Math.min(1, dt * 10));
      }
    }
    if (f.mode === 'roll' && this.now < f.rollUntil) {
      f.vel.copyFrom(f.rollDir.scale(f.rollSpeed));
    } else if (f.mode === 'special' && this.now < f.dashUntil) {
      f.vel.copyFrom(f.dashDir.scale(6.5));
    } else if (f.mode === 'hit' || f.mode === 'stagger' || f.mode === 'dead' || f.mode === 'roll' || f.mode === 'bash' || f.mode === 'special' || (f.mode === 'block' && COMBAT.blockMove === 0)) {
      f.vel.scaleInPlace(Math.max(0, 1 - dt * 5));
    } else {
      f.vel.x += (dir.x * f.speed - f.vel.x) * Math.min(1, dt * 10);
      f.vel.z += (dir.z * f.speed - f.vel.z) * Math.min(1, dt * 10);
    }

    // Beine in Laufrichtung, Oberkörper zum Gegner (nur aufgeschaltet und frei)
    const v = Math.hypot(f.vel.x, f.vel.z);
    let legTarget = 0;
    let backwards = false;
    if (locked && f.mode === 'free' && v > 0.25) {
      const rel = angleDiff(g.heading, Math.atan2(f.vel.x, f.vel.z));
      // Hysterese, damit die Beine bei 90° nicht zwischen vorwärts und rückwärts springen
      const limit = f.backwards ? 1.75 : 2.05;
      backwards = Math.abs(rel) > limit;
      if (!backwards) legTarget = Math.max(-1.45, Math.min(1.45, rel));
      else legTarget = Math.max(-1.45, Math.min(1.45, rel - Math.sign(rel) * Math.PI));
    }
    f.backwards = backwards;
    g.legYaw += (legTarget - g.legYaw) * Math.min(1, dt * 8);
    g.animator.setSpeed(f.mode === 'free' ? v : 0, backwards);
  }

  private movePlayer(dt: number): void {
    if (this.player.mode === 'dead') return;
    const wish = this.stickWorld();
    const mag = Math.min(1, Math.hypot(this.input.move.x, this.input.move.y));
    this.steer(this.player, wish, mag, this.locked, dt);
  }

  /** Zeremonie: der Sieger geht beim Todesurteil zum Verlierer, sonst stehen alle */
  private moveCeremony(dt: number): void {
    const c = this.spec.cer;
    for (const f of this.fighters) {
      if (c && c.phase === 'walk' && f === c.winner) {
        const d = c.loser.pos.subtract(f.pos);
        d.y = 0;
        const far = d.length() > 1.75;
        if (f.mode !== 'free') f.mode = 'free';
        this.steer(f, far ? d.normalize() : Vector3.Zero(), far ? 0.55 : 0, true, dt);
      } else if (f.mode === 'free') {
        this.steer(f, Vector3.Zero(), 0, true, dt);
      } else {
        f.vel.scaleInPlace(Math.max(0, 1 - dt * 5));
      }
    }
  }

  private moveAi(f: Fighter, dt: number, freeze: boolean): void {
    let m = freeze ? { dir: Vector3.Zero(), speed: 0 } : (this.aiMoves.get(f) ?? { dir: Vector3.Zero(), speed: 0 });
    const flee = freeze ? null : this.life.danger(f.pos);
    if (flee) {
      if (f.mode === 'block') f.setBlock(false);
      m = { dir: flee, speed: 5 };
    }
    this.steer(f, m.dir, Math.min(1, m.speed / this.maxSpeed(f, true)), true, dt);
  }

  private integrate(f: Fighter, dt: number): void {
    const pos = f.pos;
    pos.x += f.vel.x * dt;
    pos.z += f.vel.z * dt;
    const pa = this.arena.play;
    const k = (pos.x / pa.a) ** 2 + (pos.z / pa.b) ** 2;
    if (k > 1) {
      const s = 1 / Math.sqrt(k);
      pos.x *= s;
      pos.z *= s;
    }
    const push = (ox: number, oz: number, rr: number) => {
      const dx = pos.x - ox;
      const dz = pos.z - oz;
      const l = Math.hypot(dx, dz);
      const min = rr + 0.38;
      if (l < min && l > 1e-4) {
        pos.x = ox + (dx / l) * min;
        pos.z = oz + (dz / l) * min;
      }
    };
    for (const o of this.arena.obstacles) push(o.x, o.z, o.r);
    if (f.mode === 'dead') return;
    for (const b of this.life.beasts) if (b.alive) push(b.pos.x, b.pos.z, BEAST[b.kind].radius - 0.05);
    for (const other of this.fighters) {
      if (other !== f && other.mode !== 'dead') push(other.pos.x, other.pos.z, 0.42);
    }
  }

  /* ---------- Kamera ---------- */

  private cerCam = 0;
  private cine = false;
  private specCam = 0;

  private updateCamera(dt: number): void {
    if (this.cine !== this.spec.inCeremony) {
      this.cine = this.spec.inCeremony;
      this.hud.cinematic(this.cine);
    }
    const d = this.input.takeCamDelta();
    const p = this.player;
    const foe = this.foe;
    const target = p.pos.add(new Vector3(0, 1.5, 0));
    let camPos: Vector3;
    let look: Vector3;
    const cer = this.spec.cer;
    if (cer && (cer.phase === 'strike' || (cer.phase === 'end' && cer.verdict === 'iugula'))) {
      // Todesstoß: tief und nah von der Seite
      this.cerCam += dt;
      const w = cer.winner.pos;
      const l = cer.loser.pos;
      const mid = Vector3.Lerp(w, l, 0.5);
      const dd = l.subtract(w);
      dd.y = 0;
      const side = new Vector3(dd.z, 0, -dd.x).normalize();
      camPos = mid.add(side.scale(3.1)).add(dd.normalize().scale(-0.6)).add(new Vector3(0, 0.95, 0));
      look = mid.add(new Vector3(0, 0.75, 0));
    } else if (this.spec.inCeremony && cer) {
      // Kinoperspektive: Kaiserloge im Hintergrund, langsame Fahrt
      this.cerCam += dt;
      const mid = Vector3.Lerp(cer.winner.pos, cer.loser.pos, 0.5);
      const toEmp = this.arena.crowd.emperor.subtract(mid);
      toEmp.y = 0;
      const base = Math.atan2(toEmp.x, toEmp.z) + Math.PI + 0.42 + this.cerCam * 0.05;
      camPos = mid.add(new Vector3(Math.sin(base) * 6.4, 1.35 + this.cerCam * 0.02, Math.cos(base) * 6.4));
      look = Vector3.Lerp(mid.add(new Vector3(0, 1.0, 0)), this.arena.crowd.emperor, 0.2);
      this.yaw = base + Math.PI;
    } else if (p.mode === 'dead' && this.mode !== 'duel') {
      // Zuschauen: langsame Fahrt um die Kämpfenden
      this.specCam += dt;
      const alive = this.fighters.filter((f) => f.mode !== 'dead');
      const c = alive.length ? alive.reduce((s, f) => s.add(f.pos), Vector3.Zero()).scale(1 / alive.length) : Vector3.Zero();
      const a = this.specCam * 0.15;
      camPos = c.add(new Vector3(Math.sin(a) * 8.5, 4.2, Math.cos(a) * 8.5));
      look = c.add(new Vector3(0, 1.1, 0));
    } else if (this.locked && foe.mode !== 'dead' && foe !== p) {
      this.cerCam = 0;
      // Hinter dem Spieler, Blick auf beide Kämpfer
      const toFoe = foe.pos.subtract(p.pos);
      toFoe.y = 0;
      const want = Math.atan2(toFoe.x, toFoe.z);
      this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 6);
      const fw = this.camForward();
      const right = new Vector3(fw.z, 0, -fw.x);
      const back = this.fighters.length > 2 ? 3.6 : 3.0;
      camPos = target.subtract(fw.scale(back)).add(new Vector3(0, this.fighters.length > 2 ? 1.1 : 0.8, 0)).add(right.scale(1.45));
      const mid = Vector3.Lerp(p.pos, foe.pos, 0.72);
      look = mid.add(new Vector3(0, 1.1, 0));
    } else {
      if (d.x !== 0 || d.y !== 0) this.lastDrag = this.now;
      this.yaw += d.x * 0.0058;
      this.pitch = Math.min(0.85, Math.max(0.05, this.pitch + d.y * 0.004));
      const mag = Math.hypot(this.input.move.x, this.input.move.y);
      if (this.now - this.lastDrag > 1.2 && mag > 0.3 && p.mode === 'free' && this.input.move.y > -0.3) {
        this.yaw += angleDiff(this.yaw, p.g.heading) * Math.min(1, dt * 0.9 * mag);
      }
      const fw = this.camForward();
      const right = new Vector3(fw.z, 0, -fw.x);
      const cp = Math.cos(this.pitch);
      camPos = target
        .subtract(fw.scale(cp * 4.2))
        .add(new Vector3(0, Math.sin(this.pitch) * 4.2, 0))
        .add(right.scale(0.45));
      look = target.add(right.scale(0.45));
    }
    const wa = this.arena.wall;
    const kc = (camPos.x / (wa.a - 0.4)) ** 2 + (camPos.z / (wa.b - 0.4)) ** 2;
    if (kc > 1) {
      const s = 1 / Math.sqrt(kc);
      camPos.x *= s;
      camPos.z *= s;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * 0.12;
      camPos.addInPlace(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.fovKick = Math.max(0, this.fovKick - dt * 0.35);
    this.camera.fov = this.baseFov - this.fovKick;
    this.updateTrails();
    this.camera.position.copyFrom(Vector3.Lerp(this.camera.position, camPos, Math.min(1, dt * 10)));
    this.camLook = Vector3.Lerp(this.camLook, look, Math.min(1, dt * 10));
    this.camera.setTarget(this.camLook);
  }

  /** Für Screenshots: feste Kameraposition */
  debugCamera(pos: Vector3, target: Vector3): void {
    this.camera.position.copyFrom(pos);
    this.camera.setTarget(target);
  }
}
