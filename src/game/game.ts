import { Color3, FreeCamera, Scene, StandardMaterial, TrailMesh, Vector3 } from '@babylonjs/core';
import type { Arena } from '../arena/capua';
import type { Gladiator } from '../gladiators/gladiator';
import type { Action, TouchInput } from '../input/touch';
import type { AnimCmd } from '../gladiators/gladiator';
import type { Transport } from '../net/transport';
import { AiController } from './ai';
import { COMBAT, Fighter, type Kit, type ActiveAttack, type Dir, type FighterEvents } from './fighter';
import { Fx } from './fx';
import type { FighterInfo, Stats } from './hero';
import type { Sound } from '../audio/sound';
import { CLASSES, type ClassId } from '../data/classes';
import { buildNet } from '../gladiators/gear';
import { MeshBuilder, type Mesh } from '@babylonjs/core';
import { Spectacle, type Deed, type Verdict } from './spectacle';

const TAU = Math.PI * 2;

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export interface HudHooks {
  setBars(hp: number, st: number, exhausted: boolean): void;
  hint(text: string, seconds?: number): void;
  floatText(world: Vector3, text: string, kind?: 'good' | 'bad' | 'big' | ''): void;
  guard(info: GuardInfo | null): void;
  score(player: number, foe: number): void;
  setLocked(on: boolean): void;
  foeName(text: string): void;
  favor(mine: number, foe: number): void;
  vote(p: number | null, label?: string): void;
  thumb(v: 'missio' | 'iugula' | null): void;
  cinematic(on: boolean): void;
  flash?(kind: 'hurt' | 'parry' | 'strike'): void;
  special?(name: string | null, left: number, total: number): void;
}

export const WINS_NEEDED = 2;

export interface MatchResult {
  won: boolean;
  wins: number;
  losses: number;
  foe: FighterInfo;
  parries: number;
  pvp: boolean;
  verdict: Verdict;
}

export interface NetSetup {
  /** 0 = Gastgeber, 1 = Gast */
  stats: [Stats, Stats];
  info: [FighterInfo, FighterInfo];
  weather?: string;
  time?: number;
  arena?: 'capua' | 'colosseum';
  cls?: [ClassId, ClassId];
  kits?: [Kit, Kit];
  tiers?: [[number, number, number, number, number], [number, number, number, number, number]];
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
  at: { d: Dir; hv: boolean; ii: number; wu: number } | null;
}

interface Snap {
  f: [NetFighter, NetFighter]; // 0 = Gastgeber, 1 = Gast
  recv: number;
}

type NetAction = Exclude<Action, { type: 'roll' } | { type: 'lock' }> | { type: 'roll'; v: [number, number] };

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

/**
 * Phase 1: Richtungskampf gegen einen KI-Gegner im Ludus von Capua.
 */
export class Game implements FighterEvents {
  readonly player: Fighter;
  readonly foe: Fighter;
  readonly ai: AiController;
  private fx: Fx;
  private yaw = 0;
  private pitch = 0.32;
  private lastDrag = 0;
  private shake = 0;
  now = 0;
  private hitStop = 0;
  private locked = false;
  private manualUnlock = false;
  private roundOver = false;
  private wins = 0;
  private losses = 0;
  private aiMove = { dir: Vector3.Zero(), speed: 0 };
  private camLook = new Vector3(0, 1.5, 0);

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private arena: Arena,
    playerG: Gladiator,
    foeG: Gladiator,
    private readonly input: TouchInput,
    private readonly hud: HudHooks,
    difficulty: number,
    readonly sound: Sound,
  ) {
    this.player = new Fighter(playerG, 'Du', this);
    this.foe = new Fighter(foeG, 'Gegner', this);
    this.player.target = this.foe;
    this.foe.target = this.player;
    this.ai = new AiController(this.foe, this.player, difficulty);
    this.ai.special = () => this.special(this.foe);
    this.fx = new Fx(scene);
    this.spec = new Spectacle(() => this.arena.crowd, sound, {
      now: () => this.now,
      isAuthority: () => this.role !== 'guest',
      player: () => this.player,
      foe: () => this.foe,
      hint: (t, sec) => this.hud.hint(t, sec),
      float: (f, t, good) => this.float(this.chest(f), t, (f === this.player) === good ? 'good' : 'bad'),
      send: (ev) => this.send('ev', ev),
      vote: (p, label) => this.hud.vote(p, label),
      thumb: (v) => this.hud.thumb(v),
      heal: (f, hp) => {
        f.g.hp = Math.min(f.stats.hpMax, f.g.hp + hp);
        f.g.stamina = f.stats.staminaMax;
        this.float(this.chest(f), `Geschenk des Volkes +${hp}`, f === this.player ? 'good' : 'bad');
        if (f === this.player) this.hud.hint('Das Publikum liebt dich: Wein und Brot fliegen in die Arena!', 2.5);
      },
      pelt: (f) => {
        f.stagger(0.6, 'hit_head', 1.2);
        f.drain(15);
        this.float(this.chest(f), 'Faules Obst!', f === this.player ? 'bad' : 'good');
        if (f === this.player) this.hud.hint('Das Publikum bewirft dich – zeig mehr Mut!', 2.5);
      },
      finisher: (w, l) => this.finisher(w, l),
      done: (v) => this.ceremonyDone(v),
    });
    this.resetPositions();
    hud.score(0, 0);
  }

  readonly spec: Spectacle;
  private trails = new Map<Fighter, TrailMesh>();
  private trailMat: StandardMaterial | null = null;
  private remoteAtk = new Map<Fighter, number>();
  private fovKick = 0;
  private baseFov = 0.8;
  private lockRange = COMBAT.lockRange;

  /** Andere Arena (nach dem Umbau der Szene) */
  setArena(a: Arena): void {
    this.arena = a;
    this.resetMatch();
  }

  get arenaKind(): Arena['kind'] {
    return this.arena.kind;
  }

  /** Wetterregeln für beide Kämpfer */
  setWeatherRules(r: { regenMul: number; rollCostMul: number; lockRange: number }): void {
    this.lockRange = r.lockRange;
    for (const f of [this.player, this.foe]) f.weather = { regenMul: r.regenMul, rollCostMul: r.rollCostMul };
  }
  private slowmo = 0;
  private pendingResult: Omit<MatchResult, 'verdict'> | null = null;

  /** Ton lokal abspielen und beim Gast auch */
  private sfx(n: 'clash' | 'block' | 'hit' | 'whoosh' | 'fall' | 'horn', h = false): void {
    (this.sound[n] as (h: boolean) => void).call(this.sound, h);
    this.send('ev', { k: 'sfx', n, h });
  }

  private deed(d: Deed, f: Fighter): void {
    this.spec.note(d, f, f === this.player ? this.foe : this.player);
    // Herausforderung: das Publikum jubelt doppelt
    if (this.now < this.challengeUntil) this.spec.note(d, f, f === this.player ? this.foe : this.player);
  }

  private resetPositions(): void {
    this.player.g.root.position.set(0, 0, -3.2);
    this.player.g.setHeading(0);
    this.foe.g.root.position.set(0, 0, 3.2);
    this.foe.g.setHeading(Math.PI);
    this.yaw = 0;
  }

  setDifficulty(i: number): void {
    this.ai.setLevel(i);
  }


  /* ---------- Netzwerk ---------- */

  role: Role = 'solo';
  private net: Transport | null = null;
  private snapTimer = 0;
  private inTimer = 0;
  private snaps: Snap[] = [];
  private remoteGuest: { p: [number, number]; h: number; ly: number; v: [number, number]; bw: boolean } | null = null;
  private guestRollUntil = 0;
  private foeAttackLocal: { d: Dir; hv: boolean; impactAt: number; wu: number } | null = null;
  onNetEnd: ((reason: string) => void) | null = null;

  /** Wechselt die Rolle. Gastgeber: der Gegner wird vom Gast gesteuert. Gast: das eigene Handy zeigt nur an. */
  startNet(role: Role, net: Transport, setup: NetSetup): void {
    this.role = role;
    this.net = net;
    // Vor dem Rollentausch: player = Gastgeber-Figur, foe = Gast-Figur
    this.player.stats = setup.stats[0];
    this.player.info = setup.info[0];
    this.foe.stats = setup.stats[1];
    this.foe.info = setup.info[1];
    if (setup.cls && setup.kits && setup.tiers) {
      this.setClass(this.player, setup.cls[0], setup.kits[0], setup.tiers[0]);
      this.setClass(this.foe, setup.cls[1], setup.kits[1], setup.tiers[1]);
    }
    if (role === 'guest') {
      // Aus Sicht des Gasts ist er selbst der zweite Kämpfer: Rollen tauschen
      const me = this.foe;
      const other = this.player;
      (this as { player: Fighter }).player = me;
      (this as { foe: Fighter }).foe = other;
      net.on('snap', (d) => this.onSnap(d as { f: [NetFighter, NetFighter]; x?: number }));
      net.on('anim', (d) => {
        const m = d as { w: 0 | 1; cmd: AnimCmd };
        // w = 0: Gastgeber-Figur (hier Gegner), 1: Gast-Figur (hier ich)
        (m.w === 0 ? this.foe : this.player).g.animator.apply(m.cmd);
      });
      net.on('ev', (d) => this.onEvent(d as Record<string, unknown>));
      // Reste eines früheren Trainingskampfs aufräumen
      for (const f of [this.player, this.foe]) {
        if (f.mode === 'dead') {
          f.g.animator.resume('death');
          f.mode = 'free';
        }
      }
    } else if (role === 'host') {
      this.player.g.animator.listener = (cmd) => net.send('anim', { w: 0, cmd });
      this.foe.g.animator.listener = (cmd) => net.send('anim', { w: 1, cmd });
      net.on('in', (d) => {
        this.remoteGuest = d as { p: [number, number]; h: number; ly: number; v: [number, number]; bw: boolean };
      });
      net.on('act', (d) => this.handleRemote(d as NetAction));
    }
    if (role === 'host') this.rematch();
    else this.resetMatch();
  }

  /** Netzspiel beenden (Verbindung weg): zurück zum Training */
  endNet(reason: string): void {
    if (this.role === 'host') {
      this.player.g.animator.listener = null;
      this.foe.g.animator.listener = null;
      this.role = 'solo';
      this.net = null;
      if (this.soloFoe) {
        this.foe.stats = this.soloFoe.stats;
        this.foe.info = this.soloFoe.info;
      }
      this.hud.hint(reason + ' – weiter gegen die KI', 3);
      this.rematch();
    } else if (this.role === 'guest') {
      this.onNetEnd?.(reason);
    }
  }

  private soloFoe: { stats: Stats; info: FighterInfo } | null = null;
  onMatchEnd: ((r: MatchResult) => void) | null = null;
  onRematch: (() => void) | null = null;
  matchOver = false;

  /** Training: eigene Werte und KI-Gegner festlegen */
  setupSolo(me: Stats, meInfo: FighterInfo, foe: Stats, foeInfo: FighterInfo, aiLevel: number): void {
    this.player.stats = me;
    this.player.info = meInfo;
    this.foe.stats = foe;
    this.foe.info = foeInfo;
    this.soloFoe = { stats: foe, info: foeInfo };
    this.ai.setLevel(aiLevel);
  }

  /** Neuer Kampf: alle wieder auf die Beine, Stand 0:0 */
  rematch(): void {
    if (this.role !== 'guest') {
      for (const f of [this.player, this.foe]) if (f.mode === 'dead' || f.mode === 'stagger') f.standUp();
    }
    this.roundOver = false;
    this.sfx('horn');
    this.resetMatch();
    this.send('ev', { k: 'rematch' });
  }

  resetMatch(): void {
    this.wins = 0;
    this.losses = 0;
    this.matchOver = false;
    this.slowmo = 0;
    this.scene.animationTimeScale = 1;
    this.spec.resetMatch();
    this.fx.clearPools();
    this.hud.score(0, 0);
    this.hud.foeName(`${this.foe.info.name} · Stufe ${this.foe.info.level}`);
    for (const f of [this.player, this.foe]) {
      if (this.role !== 'guest') f.refill();
      f.parries = 0;
      f.damageTaken = 0;
      f.vel.setAll(0);
    }
    if (this.role !== 'guest') this.resetPositions();
    else {
      this.player.g.root.position.set(0, 0, 3.2);
      this.player.g.setHeading(Math.PI);
      this.yaw = Math.PI;
    }
    this.ai.reset(this.now);
  }

  private send(ch: string, data: unknown): void {
    if (this.net && this.role === 'host') this.net.send(ch, data);
  }

  private blood(p: Vector3, d: Vector3): void {
    this.fx.bloodAt(p, d);
    this.send('ev', { k: 'blood', p: [p.x, p.y, p.z], d: [d.x, d.y, d.z] });
  }

  private sparks(p: Vector3): void {
    this.fx.sparksAt(p);
    this.send('ev', { k: 'sparks', p: [p.x, p.y, p.z] });
  }

  private float(w: Vector3, text: string, kind: 'good' | 'bad' | 'big' | '' = ''): void {
    this.hud.floatText(w, text, kind);
    // Beim Gast ist gut und schlecht vertauscht
    const swap = kind === 'good' || kind === 'big' ? 'bad' : kind === 'bad' ? 'good' : '';
    this.send('ev', { k: 'float', p: [w.x, w.y, w.z], t: text, kind: swap });
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
    if (this.role === 'host' && f === this.foe) this.send('ev', { k: 'push', v: [v.x, v.z] });
    else f.vel.addInPlace(v);
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
      at: a && this.now < a.impactAt ? { d: a.dir, hv: a.heavy, ii: a.impactAt - this.now, wu: a.impactAt - a.start } : null,
    };
  }

  /** Gastgeber: Eingabe des Gasts ausführen */
  private handleRemote(a: NetAction): void {
    const f = this.foe;
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
    }
  }

  /** Gast: Ereignis vom Gastgeber */
  private onEvent(e: Record<string, unknown>): void {
    const v3 = (a: unknown) => {
      const n = a as number[];
      return new Vector3(n[0], n[1], n[2]);
    };
    switch (e.k) {
      case 'blood':
        this.fx.bloodAt(v3(e.p), v3(e.d));
        break;
      case 'sparks':
        this.fx.sparksAt(v3(e.p));
        break;
      case 'float':
        this.hud.floatText(v3(e.p), e.t as string, e.kind as 'good' | 'bad' | '');
        break;
      case 'shake':
        this.shake = e.v as number;
        break;
      case 'stop':
        this.hitStop = e.v as number;
        break;
      case 'push': {
        const v = e.v as number[];
        this.player.vel.addInPlace(new Vector3(v[0], 0, v[1]));
        break;
      }
      case 'msg':
        this.hud.hint(e.t as string, 1.4);
        break;
      case 'round': {
        const s = e.s as [number, number];
        this.wins = s[1];
        this.losses = s[0];
        this.hud.score(this.wins, this.losses);
        if (e.m) {
          this.matchOver = true;
          const par = e.p as [number, number];
          this.pendingResult = { won: e.w === 'guest', wins: this.wins, losses: this.losses, foe: this.foe.info, parries: par[1], pvp: true };
        } else this.hud.hint(e.w === 'guest' ? 'Sieg! Der Gegner liegt im Sand.' : 'Du bist gefallen …', 3.5);
        break;
      }
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
      case 'flash':
        if (e.f !== 'none') {
          this.hud.flash?.(e.f as 'hurt' | 'parry' | 'strike');
          this.fovKick = 0.06;
        }
        break;
      case 'pool': {
        const pp = e.p as number[];
        this.fx.pool(new Vector3(pp[0], 0, pp[1]));
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
        this.hud.hint('Nächste Runde – kämpft!', 2);
        break;
    }
  }

  /** Gast: Schnappschuss empfangen */
  private guestVerdict: Verdict = 'missio';

  private onSnap(d: { f: [NetFighter, NetFighter]; x?: number }): void {
    if (typeof d.x === 'number') this.spec.setRemoteExcite(d.x);
    this.snaps.push({ f: d.f, recv: performance.now() });
    if (this.snaps.length > 3) this.snaps.shift();
    const host = d.f[0];
    const me = d.f[1];
    // Eigener Zustand: Leben, Ausdauer, Modus kommen vom Gastgeber
    const p = this.player;
    p.g.hp = me.hp;
    p.g.stamina = me.st;
    p.favor = me.fv ?? 50;
    p.specialReadyAt = this.now + (me.sc ?? 0);
    if (this.spec.inCeremony) {
      // Während der Zeremonie bestimmt der Gastgeber auch die eigene Figur
      p.pos.x = me.p[0];
      p.pos.z = me.p[1];
      p.g.setHeading(me.h);
    }
    p.exhaustedUntil = me.ex ? this.now + 0.2 : 0;
    if (this.now >= this.guestRollUntil) p.mode = me.m as Fighter['mode'];
    const f = this.foe;
    f.g.hp = host.hp;
    f.g.stamina = host.st;
    f.favor = host.fv ?? 50;
    f.mode = host.m as Fighter['mode'];
    this.foeAttackLocal = host.at ? { d: host.at.d, hv: host.at.hv, impactAt: this.now + host.at.ii, wu: host.at.wu } : null;
    if (host.at) this.remoteAtk.set(f, this.now + host.at.ii);
    if (me.at) this.remoteAtk.set(p, this.now + me.at.ii);
  }

  /** Gast: Gegner zwischen den letzten zwei Schnappschüssen glätten */
  private interpolateFoe(): void {
    if (this.snaps.length === 0) return;
    const b = this.snaps[this.snaps.length - 1];
    const a = this.snaps.length > 1 ? this.snaps[this.snaps.length - 2] : b;
    const span = Math.max(1, b.recv - a.recv);
    const t = Math.min(1, (performance.now() - b.recv) / span);
    const A = a.f[0];
    const B = b.f[0];
    const f = this.foe;
    f.pos.x = A.p[0] + (B.p[0] - A.p[0]) * t;
    f.pos.z = A.p[1] + (B.p[1] - A.p[1]) * t;
    f.g.setHeading(A.h + angleDiff(A.h, B.h) * t);
    f.g.legYaw = A.ly + (B.ly - A.ly) * t;
    f.g.animator.setSpeed(B.sp, B.bw);
  }

  /** Gast: Eingabe ans Gastgeber-Handy */
  private sendGuestAction(a: Action): void {
    if (!this.net) return;
    const p = this.player;
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
      case 'bash':
      case 'cheer':
      case 'special':
        this.net.send('act', a);
        break;
      case 'lock':
        this.locked = !this.locked;
        this.manualUnlock = !this.locked;
        this.hud.setLocked(this.locked);
        break;
      default:
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
    const dist = Vector3.Distance(this.player.pos, this.foe.pos);
    if (!this.locked && !this.manualUnlock && dist < this.lockRange) {
      this.locked = true;
      this.hud.setLocked(true);
    }
    this.input.locked = this.locked;
    const acts = this.input.takeActions();
    if (!this.spec.inCeremony) for (const a of acts) this.sendGuestAction(a);
    this.interpolateFoe();
    if (this.now >= this.guestRollUntil && this.player.mode === 'roll') this.player.mode = 'free';
    if (!this.spec.inCeremony) {
      this.movePlayer(dt);
      this.integrate(this.player, dt);
    }
    for (const f of [this.player, this.foe]) f.g.animator.update(dt);
    // Eingabe an den Gastgeber (30-mal pro Sekunde)
    this.inTimer += dt;
    if (this.inTimer >= 1 / 30 && this.net) {
      this.inTimer = 0;
      const p = this.player;
      this.net.send('in', { p: [p.pos.x, p.pos.z], h: p.g.heading, ly: p.g.legYaw, v: [p.vel.x, p.vel.z], bw: p.backwards });
    }
    this.fx.update(dt);
    this.updateProjectiles(dt);
    this.updateCamera(dt);
    this.hud.favor(this.player.favor, this.foe.favor);
    this.updateSpecialHud();
    // HUD: Angriff des Gegners aus dem Schnappschuss
    this.hud.setBars(this.pct(this.player, 'hp'), this.pct(this.player, 'st'), this.player.exhausted);
    const fa = this.foeAttackLocal;
    if (!this.locked || this.foe.mode === 'dead') this.hud.guard(null);
    else
      this.hud.guard({
        anchor: this.foe.pos.add(new Vector3(0, this.foe.g.chestHeight - 0.05, 0)),
        blocking: this.player.blocking,
        foeBlocking: this.foe.blocking,
        incoming: !!fa && this.now < fa.impactAt,
        heavy: !!fa?.hv,
        impactIn: fa && this.now < fa.impactAt && this.blockAssist !== 'off' ? fa.impactAt - this.now : null,
        windup: fa?.wu ?? 1,
        parryWindow: COMBAT.parryWindow + this.player.stats.parryBonus,
        foeHp: this.pct(this.foe, 'hp'),
        foeSt: this.pct(this.foe, 'st'),
      });
  }

  /** Gastgeber: Position des Gasts übernehmen (mit Plausibilitätsprüfung) und Schnappschüsse senden */
  private updateHostNet(dt: number): void {
    const r = this.remoteGuest;
    const f = this.foe;
    if (r && !this.spec.inCeremony) {
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
      this.net.send('snap', { f: [this.netFighter(this.player), this.netFighter(this.foe)], x: Math.round(this.spec.excite * 100) / 100 });
    }
  }

  /* ---------- Ereignisse der Kämpfer ---------- */

  attackStart(f: Fighter, a: ActiveAttack): void {
    if (f === this.player && this.role === 'solo') this.ai.onFoeAttack(a, this.now);
    const wait = Math.max(0, a.impactAt - this.now - 0.16);
    window.setTimeout(() => {
      if (f.attack === a) this.sfx('whoosh', a.heavy);
    }, wait * 1000);
  }

  message(f: Fighter, text: string): void {
    if (f === this.player) this.hud.hint(text, 1.2);
    else if (this.role === 'host') this.send('ev', { k: 'msg', t: text });
  }

  private chest(f: Fighter): Vector3 {
    return f.pos.add(new Vector3(0, f.g.chestHeight + 0.35, 0));
  }

  private inFront(a: Fighter, b: Fighter, maxAngle: number): boolean {
    const d = b.pos.subtract(a.pos);
    return Math.abs(angleDiff(a.g.heading, Math.atan2(d.x, d.z))) < maxAngle;
  }

  /** Der Treffer-Moment eines Angriffs */
  impact(A: Fighter, a: ActiveAttack): void {
    this.resolve(A, a, false);
  }

  private grace: { A: Fighter; a: ActiveAttack; at: number }[] = [];
  blockAssist: 'off' | 'show' | 'auto' = 'show';

  /** Parade, Block oder Treffer. Wer zu spät blockt, bekommt eine kurze Gnadenfrist. */
  private resolve(A: Fighter, a: ActiveAttack, afterGrace: boolean): void {
    const D = A === this.player ? this.foe : this.player;
    if (A.attack !== a || A.mode !== 'attack' || D.mode === 'dead') return;
    const dist = Vector3.Distance(A.pos, D.pos);
    if (dist > A.kit.reach || !this.inFront(A, D, COMBAT.maxAngle)) {
      if (A === this.player) this.sfx('whoosh', false);
      return;
    }
    const contact = Vector3.Lerp(A.pos, D.pos, 0.65);
    contact.y = D.g.chestHeight + (a.dir === 'top' ? 0.25 : 0);
    const push = D.pos.subtract(A.pos).normalize();
    const youHit = A === this.player;

    if (this.now < D.invulnUntil) {
      this.float(this.chest(D), 'Ausgewichen', youHit ? 'bad' : 'good');
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
      this.flash(D === this.player ? 'parry' : 'none');
      this.float(this.chest(D), 'Parade!', youHit ? 'bad' : 'good');
      if (D === this.player) this.hud.hint('Gegenangriff!', 0.8);
      this.sfx('clash', true);
      this.deed('parry', D);
      return;
    }

    if (hooked && D.blocking && facing) {
      facing = false;
      this.float(this.chest(D), 'Um den Schild!', youHit ? 'big' : 'bad');
    }
    // Block
    if (D.blocking && facing) {
      const mul = this.mul(A, a, false);
      if (a.heavy || D.exhausted) {
        // Wuchtschlag (oder erschöpft): die Deckung bricht
        const chip = Math.round(a.def.damage * mul * COMBAT.heavyChip);
        this.sparks(contact);
        this.float(this.chest(D), 'Deckung bricht!', youHit ? 'big' : 'bad');
        this.setHitStop(0.12);
        this.setShake(0.35);
        this.sfx('block', true);
        this.deed('heavy', A);
        D.drain(COMBAT.guardBreak.stamina);
        if (D.takeHit(chip, 'hit_chest', true)) return this.kill(D, push);
        D.guardBreak(COMBAT.guardBreak.stagger);
        this.impulse(D, push.scale(2.2));
        return;
      }
      this.sparks(contact);
      D.blockReact(a.def.damage * mul * COMBAT.blockStaminaFactor, false);
      this.impulse(D, push.scale(0.9));
      this.setShake(0.12);
      this.setHitStop(0.05);
      this.float(this.chest(D), 'Geblockt', youHit ? '' : 'good');
      if (D.kit.hasShield && Math.random() < 0.7) this.sfx('block', false);
      else this.sfx('clash');
      this.deed('block', D);
      return;
    }

    // Knapp zu spät? Kurz warten, ob der Block noch rechtzeitig kommt
    if (!afterGrace && (D.mode === 'free' || D.mode === 'block')) {
      this.grace.push({ A, a, at: this.now + COMBAT.blockGrace });
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
    this.blood(contact, push);
    if (big) this.blood(contact.add(new Vector3(0, 0.15, 0)), push);
    this.setShake(big ? 0.5 : 0.26);
    this.setHitStop(big ? 0.13 : 0.07);
    if (D === this.player) this.flash('hurt');
    else this.flash(big ? 'strike' : 'none');
    this.float(this.chest(D), `${zone.name} −${dmg}`, youHit ? (big ? 'big' : 'good') : 'bad');
    this.sfx('hit', big);
    this.deed(zoneKey === 'top' ? 'head' : a.heavy ? 'heavy' : 'hit', A);
    if (D.takeHit(dmg, big ? 'knockback' : zone.anim, big)) return this.kill(D, push);
    this.impulse(D, push.scale(big ? 3.2 : 1.6));
  }

  /** Schadensfaktor aus den Attributen des Angreifers */
  private mul(A: Fighter, a: ActiveAttack, head: boolean): number {
    const ch = this.now < this.challengeUntil ? 1.3 : 1;
    return (a.heavy ? A.stats.heavyMul : A.stats.lightMul) * (head ? A.stats.headMul : 1) * a.power * ch;
  }

  bashImpact(A: Fighter): void {
    const D = A === this.player ? this.foe : this.player;
    if (A.mode !== 'bash' || D.mode === 'dead') return;
    const dist = Vector3.Distance(A.pos, D.pos);
    const youBash = A === this.player;
    if (dist > COMBAT.bash.range || !this.inFront(A, D, 1.0) || this.now < D.invulnUntil) {
      A.modeUntil += COMBAT.bash.missLock;
      if (youBash) this.float(this.chest(D), 'Daneben', 'bad');
      return;
    }
    if (D.mode === 'attack' && D.attack && this.now < D.attack.impactAt && !D.blocking) {
      if (youBash) this.float(this.chest(D), 'Zu langsam', 'bad');
      return;
    }
    if (D.mode === 'bash') {
      this.float(this.chest(D), 'Konter', '');
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
    this.float(this.chest(D), wasBlocking ? 'Deckung gebrochen!' : 'Gestoßen', youBash ? 'good' : 'bad');
    this.sfx('block', true);
    this.deed('bash', A);
  }

  private kill(D: Fighter, push: Vector3): void {
    D.die();
    this.impulse(D, push.scale(1.5));
    this.setHitStop(0.25);
    window.setTimeout(() => this.sfx('fall'), 450);
    window.setTimeout(() => this.bloodPool(D), 1200);
    if (this.roundOver) return;
    this.roundOver = true;
    this.deed('kill', D === this.player ? this.foe : this.player);
    if (D === this.foe) {
      this.wins++;
      this.hud.hint('Sieg! Der Gegner liegt im Sand.', 3.5);
    } else {
      this.losses++;
      this.hud.hint('Du bist gefallen …', 3.5);
    }
    this.hud.score(this.wins, this.losses);
    const over = this.wins >= WINS_NEEDED || this.losses >= WINS_NEEDED;
    this.send('ev', { k: 'round', w: D === this.foe ? 'host' : 'guest', s: [this.wins, this.losses], m: over, p: [this.player.parries, this.foe.parries] });
    if (over) {
      this.matchOver = true;
      this.pendingResult = { won: D === this.foe, wins: this.wins, losses: this.losses, foe: this.foe.info, parries: this.player.parries, pvp: this.role === 'host' };
      this.slowmo = 1.4;
      this.spec.start(D === this.foe ? this.player : this.foe, D);
    } else window.setTimeout(() => this.newRound(), 4500);
  }

  private challengeUntil = 0;
  private timers: { at: number; fn: () => void }[] = [];

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
  private projectiles: { mesh: Mesh; from: Vector3; to: Vector3; t: number; dur: number; kind: 'javelin' | 'net'; owner: Fighter | null; spin: number }[] = [];

  /** Klasse eines Kämpfers setzen: Werte, Aussehen, Sonderfähigkeit */
  setClass(f: Fighter, cls: ClassId, kit = CLASSES[cls].kit, tiers: [number, number, number, number, number] = [1, 1, 1, 1, 1]): void {
    f.cls = cls;
    f.kit = kit;
    f.g.equip({ cls, tiers });
    this.ai.specialKind = CLASSES[this.foe.cls].special.id;
  }

  /** Sonderfähigkeit der Klasse */
  special(f: Fighter): void {
    if (this.role === 'guest' && f === this.player) return;
    if (!f.canAct || f.mode === 'dead' || this.now < f.specialReadyAt || this.spec.inCeremony) return;
    const def = CLASSES[f.cls].special;
    const D = f === this.player ? this.foe : this.player;
    if (f.mode === 'block') f.setBlock(false);
    f.specialReadyAt = this.now + def.cooldown;
    const mine = f === this.player;
    this.float(this.chest(f), def.name + '!', mine ? 'good' : 'bad');
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
          const dist = Vector3.Distance(f.pos, D.pos);
          if (dist < 1.6 && this.inFront(f, D, 1.1) && D.mode !== 'dead' && this.now >= D.invulnUntil) {
            done = true;
            f.dashUntil = 0;
            const push = D.pos.subtract(f.pos).normalize();
            D.guardBreak(1.0);
            D.drain(25);
            this.impulse(D, push.scale(5));
            this.setShake(0.5);
            this.setHitStop(0.12);
            this.flash(D === this.player ? 'hurt' : 'strike');
            this.sfx('block', true);
            this.float(this.chest(D), 'Umgerannt!', mine ? 'big' : 'bad');
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
        if (mine) this.hud.hint('Hakenschlag bereit: der nächste Schlag geht um den Schild', 2);
        break;
      case 'javelin':
      case 'net': {
        f.faceTarget();
        f.interruptAttack();
        f.mode = 'special';
        f.modeUntil = this.now + 0.9;
        f.lastAction = f.g.animator.play('throw', { speed: 1.25, fadeIn: 0.06 });
        this.later(0.33, () => {
          if (f.mode === 'dead') return;
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
        if (mine || D === this.player) this.hud.hint('Herausforderung! 6 Sekunden mehr Schaden für beide', 2.2);
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
    const D = A === this.player ? this.foe : this.player;
    const mine = A === this.player;
    if (D.mode === 'dead') return;
    if (Vector3.Distance(D.pos.add(new Vector3(0, 1.1, 0)), p.to) > 1.4 || this.now < D.invulnUntil) {
      this.float(this.chest(D), 'Daneben', mine ? 'bad' : 'good');
      this.deed('dodge', D);
      return;
    }
    if (p.kind === 'javelin') {
      if (D.blocking && this.inFront(D, A, COMBAT.blockAngle)) {
        D.blockReact(14, true);
        this.sparks(this.chest(D));
        this.sfx('block', true);
        this.float(this.chest(D), 'Abgewehrt', mine ? '' : 'good');
        return;
      }
      const dmg = Math.round(18 * A.kit.damage * A.stats.lightMul * (1 - D.kit.armor.body));
      this.blood(this.chest(D), D.pos.subtract(A.pos).normalize());
      this.sfx('hit', true);
      this.flash(D === this.player ? 'hurt' : 'strike');
      this.float(this.chest(D), `Speer −${dmg}`, mine ? 'big' : 'bad');
      this.deed('heavy', A);
      if (D.takeHit(dmg, 'hit_chest', true)) this.kill(D, D.pos.subtract(A.pos).normalize());
      return;
    }
    // Netz
    if (D.cls === 'secutor' && Math.random() < 0.4) {
      this.float(this.chest(D), 'Netz rutscht ab', mine ? 'bad' : 'good');
      return;
    }
    D.setBlock(false);
    D.stagger(1.6, 'hit_chest', 0.5);
    D.guardBrokenUntil = this.now + 1.8;
    this.float(this.chest(D), 'Gefangen!', mine ? 'big' : 'bad');
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

  /** Bildschirm-Rückmeldung */
  private flash(kind: 'hurt' | 'parry' | 'strike' | 'none'): void {
    if (kind === 'none') return;
    this.hud.flash?.(kind);
    this.fovKick = Math.max(this.fovKick, kind === 'strike' ? 0.09 : kind === 'hurt' ? 0.06 : 0.04);
    this.send('ev', { k: 'flash', f: kind === 'hurt' ? 'strike' : kind === 'strike' ? 'hurt' : kind });
  }

  /** Waffenspur nur im Schwung */
  private updateTrails(): void {
    for (const f of [this.player, this.foe]) {
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

  /** Todesstoß nach „Iugula!“ */
  private finisher(w: Fighter, l: Fighter): void {
    w.mode = 'free';
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
            for (let i = 0; i < 3; i++) this.blood(p.add(new Vector3(0, i * 0.12, 0)), dir);
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

  /** Blutlache unter einem Körper (auch beim Gast) */
  private bloodPool(f: Fighter): void {
    const p = f.pos.add(new Vector3(Math.sin(f.g.heading) * -0.6, 0, Math.cos(f.g.heading) * -0.6));
    this.fx.pool(p);
    this.send('ev', { k: 'pool', p: [p.x, p.z] });
  }

  private ceremonyDone(v: Verdict): void {
    this.send('ev', { k: 'done', v });
    if (this.pendingResult) this.onMatchEnd?.({ ...this.pendingResult, verdict: v });
    this.pendingResult = null;
  }

  private doCheer(f: Fighter): void {
    if (f.mode !== 'free' || this.spec.inCeremony) return;
    const d = Vector3.Distance(f.pos, (f === this.player ? this.foe : this.player).pos);
    if (d > 2.6) f.lastAction = f.g.animator.play('cheer', { speed: 1.3 });
    this.spec.cheer(f);
  }

  private newRound(): void {
    for (const f of [this.player, this.foe]) {
      if (f.mode === 'dead') f.revive();
      else f.refill();
    }
    this.roundOver = false;
    this.ai.reset(this.now);
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
        this.locked = !this.locked;
        this.manualUnlock = !this.locked;
        this.hud.setLocked(this.locked);
        break;
      case 'cheer':
        this.doCheer(p);
        break;
    }
  }

  /* ---------- Hauptschleife ---------- */

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
    for (const f of [this.player, this.foe]) f.tick(this.now, dt);

    // Automatisch aufschalten, wenn der Gegner nah ist
    const dist = Vector3.Distance(this.player.pos, this.foe.pos);
    if (!this.locked && !this.manualUnlock && dist < this.lockRange && this.foe.mode !== 'dead') {
      this.locked = true;
      this.hud.setLocked(true);
    }
    if (this.manualUnlock && dist > this.lockRange + 4) this.manualUnlock = false;
    this.input.locked = this.locked;

    const ceremony = this.spec.inCeremony;
    const acts = this.input.takeActions();
    if (!ceremony) for (const a of acts) this.handle(a);
    // Gnadenfrist abarbeiten
    const due = this.grace.filter((g) => g.at <= this.now);
    this.grace = this.grace.filter((g) => g.at > this.now);
    for (const g of due) this.resolve(g.A, g.a, true);
    if (!freeze && this.role === 'solo' && !ceremony) this.aiMove = this.ai.update(this.now);
    this.spec.update(dt);

    if (ceremony) this.moveCeremony(dt);
    else {
      this.movePlayer(dt);
      if (this.role !== 'host') this.moveFoe(dt, freeze);
    }
    if (this.role === 'host') this.updateHostNet(dt);
    for (const f of [this.player, this.foe]) {
      if (!(this.role === 'host' && f === this.foe && !ceremony)) this.integrate(f, dt);
      f.g.animator.update(dt);
    }
    this.arena.update(dt, daylight);
    this.fx.update(dt);
    this.runTimers();
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
    this.updateSpecialHud();
    this.hud.favor(p.favor, this.foe.favor);
    this.hud.setBars(this.pct(p, 'hp'), this.pct(p, 'st'), p.exhausted);
    if (!this.locked || this.foe.mode === 'dead') {
      this.hud.guard(null);
      return;
    }
    const fa = this.foe.attack;
    this.hud.guard({
      anchor: this.foe.pos.add(new Vector3(0, this.foe.g.chestHeight - 0.05, 0)),
      blocking: p.blocking,
      foeBlocking: this.foe.blocking,
      incoming: !!fa && this.now < fa.impactAt,
      heavy: !!fa?.heavy,
      impactIn: fa && this.now < fa.impactAt && this.blockAssist !== 'off' ? fa.impactAt - this.now : null,
      windup: fa ? fa.impactAt - fa.start : 1,
      parryWindow: COMBAT.parryWindow + p.stats.parryBonus,
      foeHp: this.pct(this.foe, 'hp'),
      foeSt: this.pct(this.foe, 'st'),
    });
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
      if (this.now < f.attack.impactAt && d.length() > 1.7) {
        dir = d.normalize();
        target = 1.4;
      }
    }
    f.speed += (target - f.speed) * Math.min(1, dt * 9);

    // Blickrichtung
    if (f.mode !== 'roll' && f.mode !== 'dead') {
      if (locked && f.target && f.target.mode !== 'dead') {
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
    const wish = this.stickWorld();
    const mag = Math.min(1, Math.hypot(this.input.move.x, this.input.move.y));
    this.steer(this.player, wish, mag, this.locked, dt);
  }

  /** Zeremonie: der Sieger geht beim Todesurteil zum Verlierer, sonst stehen beide */
  private moveCeremony(dt: number): void {
    const c = this.spec.cer;
    for (const f of [this.player, this.foe]) {
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

  private moveFoe(dt: number, freeze: boolean): void {
    const m = freeze ? { dir: Vector3.Zero(), speed: 0 } : this.aiMove;
    this.steer(this.foe, m.dir, Math.min(1, m.speed / this.maxSpeed(this.foe, true)), true, dt);
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
    const other = f === this.player ? this.foe : this.player;
    if (other.mode !== 'dead' && f.mode !== 'dead') push(other.pos.x, other.pos.z, 0.42);
  }

  /* ---------- Kamera ---------- */

  private updateCamera(dt: number): void {
    if (this.cine !== this.spec.inCeremony) {
      this.cine = this.spec.inCeremony;
      this.hud.cinematic(this.cine);
    }
    const d = this.input.takeCamDelta();
    const p = this.player;
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
      const d = l.subtract(w);
      d.y = 0;
      const side = new Vector3(d.z, 0, -d.x).normalize();
      camPos = mid.add(side.scale(3.1)).add(d.normalize().scale(-0.6)).add(new Vector3(0, 0.95, 0));
      look = mid.add(new Vector3(0, 0.75, 0));
    } else if (this.spec.inCeremony) {
      // Kinoperspektive: Kaiserloge im Hintergrund, langsame Fahrt
      this.cerCam += dt;
      const mid = Vector3.Lerp(p.pos, this.foe.pos, 0.5);
      const toEmp = this.arena.crowd.emperor.subtract(mid);
      toEmp.y = 0;
      const base = Math.atan2(toEmp.x, toEmp.z) + Math.PI + 0.42 + this.cerCam * 0.05;
      camPos = mid.add(new Vector3(Math.sin(base) * 6.4, 1.35 + this.cerCam * 0.02, Math.cos(base) * 6.4));
      look = Vector3.Lerp(mid.add(new Vector3(0, 1.0, 0)), this.arena.crowd.emperor, 0.2);
      this.yaw = base + Math.PI;
    } else if (this.locked && this.foe.mode !== 'dead') {
      this.cerCam = 0;
      // Hinter dem Spieler, Blick auf beide Kämpfer
      const toFoe = this.foe.pos.subtract(p.pos);
      toFoe.y = 0;
      const want = Math.atan2(toFoe.x, toFoe.z);
      this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 6);
      const fw = this.camForward();
      const right = new Vector3(fw.z, 0, -fw.x);
      camPos = target.subtract(fw.scale(3.0)).add(new Vector3(0, 0.8, 0)).add(right.scale(1.45));
      const mid = Vector3.Lerp(p.pos, this.foe.pos, 0.72);
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

  private cerCam = 0;
  private cine = false;

  /** Für Screenshots: feste Kameraposition */
  debugCamera(pos: Vector3, target: Vector3): void {
    this.camera.position.copyFrom(pos);
    this.camera.setTarget(target);
  }

  get playerFighter(): Gladiator {
    return this.player.g;
  }

  get dummyFighter(): Gladiator {
    return this.foe.g;
  }
}
