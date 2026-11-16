import { Color3, DynamicTexture, Mesh, MeshBuilder, PBRMaterial, Vector3, type Scene } from '@babylonjs/core';
import type { Arena } from '../arena/capua';
import type { AssetContainer } from '@babylonjs/core';
import { Beast, BEAST, loadBeasts, MODE_CODES, type BeastKind, type BeastMode } from './beasts';
import type { Fighter } from './fighter';
import { VENATIO_WAVES, type MatchMode } from './match';

export type EnvHitKind = 'bite' | 'charge' | 'horn' | 'spikes';
export type EnvHitResult = 'dodge' | 'parry' | 'block' | 'hit';

/** Was das Arenaleben vom Spiel braucht */
export interface LifeHost {
  now(): number;
  authority(): boolean;
  fighters(): Fighter[];
  mode(): MatchMode;
  /** Kampf ruht (Zeremonie, Rundenende) */
  calm(): boolean;
  envHit(D: Fighter, dmg: number, from: Vector3, kind: EnvHitKind): EnvHitResult;
  beastAttack(D: Fighter, impactAt: number): void;
  blood(p: Vector3, d: Vector3, power: number): void;
  pool(p: Vector3, scale: number): void;
  sfx(n: 'growl' | 'bellow' | 'bite' | 'rumble' | 'spikes' | 'fall' | 'block' | 'horn'): void;
  shake(v: number): void;
  announce(text: string): void;
  float(p: Vector3, text: string): void;
  kick(v: number): void;
  send(ev: Record<string, unknown>): void;
  /** Venatio: alle Wellen überstanden */
  venatioWon(): void;
  /** Venatio: neue Welle (für die Anzeige) */
  wave(n: number): void;
}

type TrapState = 'idle' | 'warn' | 'up' | 'down' | 'rest';

interface Trap {
  pos: Vector3;
  r: number;
  plate: Mesh;
  spikes: Mesh;
  state: TrapState;
  t: number;
  bloody: boolean;
}

/** Netz-Darstellung eines Tiers: id, Art, x, z, Richtung, Modus, Leben in % */
type NetBeast = [number, number, number, number, number, number, number];

const TRAP_WARN = 0.75;
const TRAP_RISE = 0.1;
const TRAP_HOLD = 1.3;
const TRAP_SINK = 0.5;
const TRAP_REST = 6;
const SPIKE_LOW = -1.0;

/**
 * Arenaleben: Spießfallen im Boden, Ereignisse des Spielleiters und Tierhetze (Venatio).
 * Gastgeber und Training rechnen, Gäste zeigen nur an.
 */
export class ArenaLife {
  enabled = true;
  caster: ((m: Mesh) => void) | null = null;
  beasts: Beast[] = [];
  traps: Trap[] = [];
  private plateMat: PBRMaterial | null = null;
  private grate: DynamicTexture | null = null;
  private warnMat: PBRMaterial | null = null;
  private spikeMat: PBRMaterial | null = null;
  private bloodyMat: PBRMaterial | null = null;
  private nextEvent = 20;
  /** Stärke der Tiere (Venatio-Stufe) */
  power = 1;
  wave = 0;
  private waveAt = 0;
  private spawning = 0;
  private play = { a: 15, b: 15 };

  constructor(
    private readonly scene: Scene,
    private readonly host: LifeHost,
  ) {}

  /* ---------- Aufbau ---------- */

  /** Fallen passend zur Arena anlegen */
  setArena(a: Arena): void {
    for (const t of this.traps) {
      t.plate.dispose();
      t.spikes.dispose();
    }
    this.traps = [];
    this.play = a.play;
    const spots: [number, number][] = [];
    const ra = a.play.a * 0.46;
    const rb = a.play.b * 0.46;
    for (const ang of [45, 135, 225, 315]) {
      const r = (ang * Math.PI) / 180;
      spots.push([Math.sin(r) * ra, Math.cos(r) * rb]);
    }
    if (a.kind === 'colosseum') spots.push([a.play.a * 0.66, 0], [-a.play.a * 0.66, 0]);
    for (const [x, z] of spots) this.traps.push(this.buildTrap(new Vector3(x, 0, z)));
  }

  private mats(): void {
    if (this.plateMat) return;
    const tex = new DynamicTexture('trapGrate', { width: 256, height: 256 }, this.scene, true);
    this.grate = tex;
    const pm = new PBRMaterial('trapPlate', this.scene);
    pm.albedoTexture = tex;
    pm.metallic = 0.35;
    pm.roughness = 0.7;
    pm.emissiveColor = new Color3(0, 0, 0);
    this.plateMat = pm;
    // Leuchtende Fassung für Platten, die gleich auslösen (gleiche Textur, kein Klon)
    const wm = new PBRMaterial('trapPlateWarn', this.scene);
    wm.albedoTexture = tex;
    wm.metallic = 0.35;
    wm.roughness = 0.7;
    wm.emissiveColor = new Color3(0.5, 0.1, 0.02);
    this.warnMat = wm;
    const sm = new PBRMaterial('trapSpike', this.scene);
    sm.albedoColor = new Color3(0.42, 0.4, 0.38);
    sm.metallic = 0.9;
    sm.roughness = 0.35;
    this.spikeMat = sm;
    const bm = new PBRMaterial('trapSpikeBlood', this.scene);
    bm.albedoColor = new Color3(0.32, 0.03, 0.02);
    bm.metallic = 0.6;
    bm.roughness = 0.25;
    this.bloodyMat = bm;
  }

  private painted = false;

  /** Gitter der Falle zeichnen (erst im laufenden Spiel, beim Aufbau geht der Inhalt sonst verloren) */
  private paintGrate(tex: DynamicTexture): void {
    this.painted = true;
    const c = tex.getContext() as CanvasRenderingContext2D;
    c.fillStyle = '#8a7a66';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(${110 + Math.random() * 60},${55 + Math.random() * 30},25,${0.25 + Math.random() * 0.3})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 8, 3 + Math.random() * 8);
    }
    c.fillStyle = '#0b0806';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        c.beginPath();
        c.arc(16 + x * 32 + (y % 2) * 8, 16 + y * 32, 6, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.strokeStyle = '#4a3a2c';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(128, 128, 122, 0, Math.PI * 2);
    c.stroke();
    tex.update(false);
  }

  private buildTrap(pos: Vector3): Trap {
    this.mats();
    const r = 1.15;
    const plate = MeshBuilder.CreateCylinder('trapPlate', { diameter: r * 2, height: 0.05, tessellation: 32 }, this.scene);
    plate.position.set(pos.x, 0.02, pos.z);
    plate.material = this.plateMat;
    plate.receiveShadows = true;
    plate.isPickable = false;
    const parts: Mesh[] = [];
    for (let i = 0; i < 19; i++) {
      const ring = i === 0 ? 0 : i < 7 ? 0.42 : 0.82;
      const n = i === 0 ? 1 : i < 7 ? 6 : 12;
      const k = i === 0 ? 0 : i < 7 ? i - 1 : i - 7;
      const a = (k / n) * Math.PI * 2 + (i < 7 ? 0 : 0.26);
      const h = 0.85 + Math.random() * 0.25;
      const cone = MeshBuilder.CreateCylinder('spike', { height: h, diameterTop: 0, diameterBottom: 0.075, tessellation: 6 }, this.scene);
      cone.position.set(Math.sin(a) * ring * r, h / 2, Math.cos(a) * ring * r);
      cone.rotation.set((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.12);
      parts.push(cone);
    }
    const spikes = Mesh.MergeMeshes(parts, true)!;
    spikes.material = this.spikeMat;
    spikes.position.set(pos.x, SPIKE_LOW, pos.z);
    spikes.isPickable = false;
    spikes.setEnabled(false);
    this.caster?.(spikes);
    return { pos, r, plate, spikes, state: 'idle', t: 0, bloody: false };
  }

  /* ---------- Ablauf ---------- */

  /** Neue Runde oder neuer Kampf: Tiere weg, Fallen zurück */
  reset(): void {
    for (const b of this.beasts) b.dispose();
    this.beasts = [];
    for (const t of this.traps) this.setTrap(t, 'idle', true);
    this.nextEvent = this.host.now() + 16 + Math.random() * 8;
    this.wave = 0;
    this.waveAt = this.host.now() + 3;
    this.spawning = 0;
  }

  /** Kampf vorbei: Tiere laufen hinaus */
  retreat(): void {
    for (const b of this.beasts) if (b.alive) this.setMode(b, 'leave', 99);
  }

  update(dt: number): void {
    const now = this.host.now();
    if (this.host.authority() && this.host.mode() === 'venatio' && !this.host.calm()) this.waves(now);
    if (this.grate && !this.painted) this.paintGrate(this.grate);
    if (this.host.authority()) {
      if (this.enabled && !this.host.calm()) this.director(now);
      for (const t of this.traps) this.tickTrap(t, now, dt);
      for (const b of this.beasts) this.think(b, now, dt);
    } else {
      for (const t of this.traps) this.animTrap(t, now);
      for (const b of this.beasts) this.replica(b, dt);
    }
    this.beasts = this.beasts.filter((b) => b.mode !== 'gone');
  }

  /* ---------- Spielleiter ---------- */

  private director(now: number): void {
    // Wer auf eine scharfe Platte tritt, löst sie aus
    for (const t of this.traps) {
      if (t.state !== 'idle') continue;
      for (const f of this.host.fighters()) {
        if (f.mode === 'dead') continue;
        if (Math.hypot(f.pos.x - t.pos.x, f.pos.z - t.pos.z) < t.r * 0.8) {
          this.arm(t);
          break;
        }
      }
    }
    if (this.host.mode() === 'venatio') {
      // In der Venatio schickt der Spielleiter nur die Fallen, die Tiere kommen in Wellen
      if (now >= this.nextEvent) {
        this.nextEvent = now + 20 + Math.random() * 10;
        for (const t of this.traps) if (t.state === 'idle' && Math.random() < 0.5) this.arm(t);
      }
      return;
    }
    if (now < this.nextEvent) return;
    const group = this.host.mode() !== 'duel';
    this.nextEvent = now + (group ? 18 : 24) + Math.random() * 12;
    const alive = this.beasts.filter((b) => b.alive).length;
    const r = Math.random();
    if (alive < (group ? 4 : 2) && r < 0.4) {
      const n = group ? 3 : 2;
      this.host.announce('Venatio! Die Tore öffnen sich – Wölfe!');
      this.spawn('wolf', n);
    } else if (alive < (group ? 4 : 2) && r < 0.7) {
      this.host.announce('Ein Stier stürmt in die Arena! Ausweichen!');
      this.spawn('bull', 1);
    } else {
      this.host.announce('Die Fallen erwachen!');
      for (const t of this.traps) if (t.state === 'idle' && Math.random() < 0.75) this.arm(t);
    }
    this.host.sfx('horn');
    this.host.kick(0.6);
  }

  /** Venatio: nächste Welle, wenn alle Tiere tot sind */
  private waves(now: number): void {
    if (this.spawning > 0) return;
    if (this.beasts.some((b) => b.alive && b.mode !== 'leave')) {
      this.waveAt = now + 4;
      return;
    }
    if (now < this.waveAt) return;
    if (this.wave >= VENATIO_WAVES) {
      this.waveAt = Infinity;
      this.host.venatioWon();
      return;
    }
    this.wave++;
    this.host.wave(this.wave);
    const extra = Math.max(0, this.host.fighters().length - 2);
    const plan: [BeastKind, number][][] = [
      [['wolf', 2]],
      [['wolf', 3]],
      [['bull', 1], ['wolf', 2]],
      [['wolf', 4]],
      [['bull', 2], ['wolf', 2]],
    ];
    const w = plan[Math.min(plan.length - 1, this.wave - 1)];
    const names = w.map(([k, n]) => `${n} ${k === 'wolf' ? (n === 1 ? 'Wolf' : 'Wölfe') : n === 1 ? 'Stier' : 'Stiere'}`).join(' und ');
    this.host.announce(this.wave === VENATIO_WAVES ? `Letzte Welle: ${names}!` : `Welle ${this.wave} von ${VENATIO_WAVES}: ${names}`);
    this.host.sfx('horn');
    w.forEach(([k, n], i) => this.spawn(k, n + (k === 'wolf' ? extra : 0), i % 2 === 0 ? 1 : -1));
    this.waveAt = now + 6;
  }

  /** Tiere durch ein Tor am Rand hereinlassen */
  spawn(kind: BeastKind, n: number, gate = 0): void {
    if (!this.host.authority()) return;
    this.spawning++;
    void loadBeasts(this.scene).then((m) => {
      this.spawning--;
      if (this.host.calm()) return;
      const side = gate || (Math.random() < 0.5 ? 1 : -1);
      for (let i = 0; i < n; i++) {
        const b = new Beast(kind, this.scene, m.get(kind)!, this.caster);
        b.hpMax = b.hp = Math.round(BEAST[kind].hp * this.power);
        b.dmgMul = Math.sqrt(this.power);
        const ang = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (i - (n - 1) / 2) * 0.12;
        b.pos.set(Math.sin(ang) * this.play.a * 0.97, 0, Math.cos(ang) * this.play.b * 0.97);
        b.setHeading(ang + Math.PI);
        this.setMode(b, 'enter', 1.0 + i * 0.2);
        b.nextAttack = this.host.now() + 1.5 + Math.random();
        this.beasts.push(b);
      }
      this.host.sfx(kind === 'bull' ? 'bellow' : 'growl');
    });
  }

  /* ---------- Fallen ---------- */

  arm(t: Trap): void {
    if (t.state !== 'idle') return;
    this.setTrap(t, 'warn');
    this.host.sfx('rumble');
  }

  private setTrap(t: Trap, s: TrapState, quiet = false): void {
    t.state = s;
    t.t = this.host.now();
    if (s === 'idle') {
      t.spikes.setEnabled(false);
      t.spikes.position.y = SPIKE_LOW;
      if (t.bloody) {
        t.bloody = false;
        t.spikes.material = this.spikeMat;
      }
    }
    if (!quiet && this.host.authority()) this.host.send({ k: 'trap', i: this.traps.indexOf(t), s });
  }

  /** Gast: Zustand einer Falle vom Gastgeber */
  onTrap(i: number, s: TrapState): void {
    const t = this.traps[i];
    if (!t) return;
    t.state = s;
    t.t = this.host.now();
    if (s === 'warn') this.host.sfx('rumble');
    if (s === 'up') {
      this.host.sfx('spikes');
      this.host.shake(0.25);
    }
    if (s === 'idle') this.setTrap(t, 'idle', true);
  }

  /** Bild der Falle (beide Seiten) */
  private animTrap(t: Trap, now: number): void {
    const e = now - t.t;
    if (t.state === 'warn') {
      const k = 0.5 + 0.5 * Math.sin(e * 28);
      t.plate.material = this.warnMat;
      this.warnMat!.emissiveColor.set(0.38 * k, 0.04 * k, 0.01 * k);
      t.spikes.setEnabled(true);
      t.spikes.position.y = SPIKE_LOW + 0.12 * Math.min(1, e / TRAP_WARN);
    } else if (t.plate.material !== this.plateMat) t.plate.material = this.plateMat;
    if (t.state === 'up') {
      t.spikes.setEnabled(true);
      t.spikes.position.y = SPIKE_LOW + (0 - SPIKE_LOW) * Math.min(1, e / TRAP_RISE);
    } else if (t.state === 'down') {
      t.spikes.position.y = SPIKE_LOW * Math.min(1, e / TRAP_SINK);
    }
  }

  private tickTrap(t: Trap, now: number, _dt: number): void {
    this.animTrap(t, now);
    const e = now - t.t;
    if (t.state === 'warn' && e >= TRAP_WARN) {
      this.setTrap(t, 'up');
      this.host.sfx('spikes');
      this.host.shake(0.25);
      // Wer jetzt noch drauf steht, wird aufgespießt
      for (const f of this.host.fighters()) {
        if (f.mode === 'dead') continue;
        if (Math.hypot(f.pos.x - t.pos.x, f.pos.z - t.pos.z) < t.r + 0.25) {
          const res = this.host.envHit(f, 30, t.pos, 'spikes');
          if (res === 'hit') this.bloody(t, f.pos);
        }
      }
      for (const b of this.beasts) {
        if (!b.alive || b.mode === 'leave') continue;
        if (Math.hypot(b.pos.x - t.pos.x, b.pos.z - t.pos.z) < t.r + BEAST[b.kind].radius * 0.5) {
          this.damage(b, 70, b.pos.subtract(t.pos), true, null);
          this.bloody(t, b.pos);
        }
      }
    } else if (t.state === 'up' && e >= TRAP_RISE + TRAP_HOLD) this.setTrap(t, 'down');
    else if (t.state === 'down' && e >= TRAP_SINK) this.setTrap(t, 'rest');
    else if (t.state === 'rest' && e >= TRAP_REST) this.setTrap(t, 'idle');
  }

  private bloody(t: Trap, at: Vector3): void {
    if (!t.bloody) {
      t.bloody = true;
      t.spikes.material = this.bloodyMat;
      this.host.send({ k: 'trapb', i: this.traps.indexOf(t) });
    }
    for (let i = 0; i < 3; i++) this.host.blood(at.add(new Vector3(0, 0.4 + i * 0.3, 0)), new Vector3((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6), 2);
  }

  /** Gast: Spieße sind blutig */
  onTrapBlood(i: number): void {
    const t = this.traps[i];
    if (!t) return;
    t.bloody = true;
    t.spikes.material = this.bloodyMat;
  }

  /** Gefahr für eine KI: Fluchtrichtung weg von einer gleich auslösenden Falle */
  danger(p: Vector3): Vector3 | null {
    for (const t of this.traps) {
      if (t.state !== 'warn') continue;
      const d = p.subtract(t.pos);
      d.y = 0;
      const l = d.length();
      if (l < t.r + 0.6) return l > 0.05 ? d.scale(1 / l) : new Vector3(1, 0, 0);
    }
    return null;
  }

  /* ---------- Tiere: Verhalten (Gastgeber) ---------- */

  private setMode(b: Beast, m: BeastMode, dur: number): void {
    b.mode = m;
    b.modeUntil = this.host.now() + dur;
  }

  private pickTarget(b: Beast, now: number): void {
    if (b.target && b.target.mode !== 'dead' && now < b.nextRetarget) return;
    b.nextRetarget = now + 3 + Math.random() * 3;
    let best: Fighter | null = null;
    let bs = Infinity;
    for (const f of this.host.fighters()) {
      if (f.mode === 'dead') continue;
      const s = Vector3.Distance(f.pos, b.pos) * (0.7 + Math.random() * 0.6);
      if (s < bs) {
        bs = s;
        best = f;
      }
    }
    b.target = best;
  }

  private face(b: Beast, to: Vector3, dt: number, rate = 8): void {
    const d = to.subtract(b.pos);
    if (Math.hypot(d.x, d.z) < 1e-3) return;
    const want = Math.atan2(d.x, d.z);
    let diff = (want - b.heading) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    b.setHeading(b.heading + diff * Math.min(1, dt * rate));
  }

  private think(b: Beast, now: number, dt: number): void {
    if (b.mode === 'gone') return;
    const S = BEAST[b.kind];
    let wish = Vector3.Zero();
    let speed = 0;
    if (b.mode === 'dead') {
      b.vel.scaleInPlace(Math.max(0, 1 - dt * 6));
      this.integrate(b, dt);
      // Kadaver nach einer Weile im Sand versinken lassen
      if (now > b.modeUntil) {
        b.pos.y -= dt * 0.25;
        if (now > b.modeUntil + 6) b.dispose();
      }
      return;
    }
    if (this.host.calm() && b.mode !== 'leave') this.setMode(b, 'leave', 99);
    if (b.mode === 'leave') {
      // Zum nächsten Rand laufen und verschwinden
      const ang = Math.atan2(b.pos.x, b.pos.z);
      const edge = new Vector3(Math.sin(ang) * this.play.a, 0, Math.cos(ang) * this.play.b);
      wish = edge.subtract(b.pos);
      speed = S.run * 0.8;
      const k = (b.pos.x / this.play.a) ** 2 + (b.pos.z / this.play.b) ** 2;
      if (k > 0.9) {
        b.dispose();
        return;
      }
    } else if (b.mode === 'enter') {
      wish = b.pos.scale(-1);
      speed = S.run * 0.85;
      if (now >= b.modeUntil) this.setMode(b, 'hunt', 0);
    } else if (b.mode === 'hit' || b.mode === 'stun') {
      if (now >= b.modeUntil) this.setMode(b, 'hunt', 0);
    } else {
      this.pickTarget(b, now);
      const T = b.target;
      if (!T) {
        b.vel.scaleInPlace(Math.max(0, 1 - dt * 4));
      } else if (b.kind === 'wolf') {
        const r = this.wolf(b, T, now, dt);
        wish = r.wish;
        speed = r.speed;
      } else {
        const r = this.bull(b, T, now, dt);
        wish = r.wish;
        speed = r.speed;
      }
    }
    // Abstand zu anderen Tieren
    for (const o of this.beasts) {
      if (o === b || !o.alive) continue;
      const d = b.pos.subtract(o.pos);
      d.y = 0;
      const l = d.length();
      if (l < 1.6 && l > 1e-3) wish.addInPlace(d.scale((1.6 - l) / l));
    }
    if (b.mode === 'charge') {
      b.vel.copyFrom(b.chargeDir.scale(S.run));
    } else {
      const l = wish.length();
      const dir = l > 1e-3 ? wish.scale(1 / l) : Vector3.Zero();
      b.vel.x += (dir.x * speed - b.vel.x) * Math.min(1, dt * 6);
      b.vel.z += (dir.z * speed - b.vel.z) * Math.min(1, dt * 6);
      if (speed > 0.3 && b.mode !== 'windup') this.face(b, b.pos.add(dir), dt, 7);
    }
    this.integrate(b, dt);
    this.animate(b);
  }

  private wolf(b: Beast, T: Fighter, now: number, dt: number): { wish: Vector3; speed: number } {
    const S = BEAST.wolf;
    const to = T.pos.subtract(b.pos);
    to.y = 0;
    const dist = to.length();
    const fwd = dist > 1e-3 ? to.scale(1 / dist) : new Vector3(0, 0, 1);
    const side = new Vector3(fwd.z, 0, -fwd.x);
    if (b.mode === 'windup') {
      this.face(b, T.pos, dt, 10);
      if (!b.struck && now >= b.impactAt) {
        b.struck = true;
        // Sprung nach vorn
        b.vel.addInPlace(fwd.scale(3.5));
        const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(to.x, to.z) - b.heading), Math.cos(Math.atan2(to.x, to.z) - b.heading)));
        if (dist < S.reach + 0.4 && ang < 1.1) {
          this.host.sfx('bite');
          const res = this.host.envHit(T, Math.round(S.dmg * b.dmgMul), b.pos, 'bite');
          if (res === 'parry') {
            this.setMode(b, 'hit', 1.1);
            b.vel.copyFrom(fwd.scale(-3));
            b.play('hit', false, 1.1);
            return { wish: Vector3.Zero(), speed: 0 };
          }
        }
        b.backoffUntil = now + 0.6 + Math.random() * 0.5;
      }
      if (now >= b.modeUntil) {
        this.setMode(b, 'hunt', 0);
        b.nextAttack = now + S.cd[0] + Math.random() * (S.cd[1] - S.cd[0]);
      }
      return { wish: Vector3.Zero(), speed: 0 };
    }
    if (now < b.backoffUntil) return { wish: fwd.scale(-1).add(side.scale(b.strafe)), speed: 3.2 };
    if (dist > S.reach + 0.1) {
      // Im Bogen heranpirschen
      const circle = dist < 4 ? side.scale(b.strafe * 0.6) : Vector3.Zero();
      return { wish: fwd.add(circle), speed: dist > 4 ? S.run : 3.6 };
    }
    if (now >= b.nextAttack && T.mode !== 'dead') {
      this.setMode(b, 'windup', S.windup + 0.45);
      b.impactAt = now + S.windup;
      b.struck = false;
      b.play('attack', false, 1.15);
      this.host.beastAttack(T, b.impactAt);
      if (Math.random() < 0.4) this.host.sfx('growl');
      return { wish: Vector3.Zero(), speed: 0 };
    }
    if (Math.random() < dt * 0.4) b.strafe *= -1;
    return { wish: side.scale(b.strafe), speed: 1.6 };
  }

  private bull(b: Beast, T: Fighter, now: number, dt: number): { wish: Vector3; speed: number } {
    const S = BEAST.bull;
    const to = T.pos.subtract(b.pos);
    to.y = 0;
    const dist = to.length();
    const fwd = dist > 1e-3 ? to.scale(1 / dist) : new Vector3(0, 0, 1);
    if (b.mode === 'windup') {
      if (b.struck) {
        // Kopfstoß aus der Nähe
        this.face(b, T.pos, dt, 6);
        if (now >= b.impactAt && b.struck) {
          b.struck = false;
          b.impactAt = Infinity;
          if (dist < S.reach + 0.5) {
            this.host.sfx('bite');
            this.host.envHit(T, Math.round(18 * b.dmgMul), b.pos, 'horn');
          }
        }
        if (now >= b.modeUntil) {
          this.setMode(b, 'hunt', 0);
          b.nextAttack = now + 1.4 + Math.random();
        }
        return { wish: Vector3.Zero(), speed: 0 };
      }
      // Scharren: dann Anlauf in die gemerkte Richtung
      this.face(b, T.pos, dt, 4);
      if (now >= b.modeUntil) {
        b.chargeDir = new Vector3(Math.sin(b.heading), 0, Math.cos(b.heading));
        b.chargeHit.clear();
        this.setMode(b, 'charge', 2.0);
        this.host.sfx('bellow');
      }
      return { wish: Vector3.Zero(), speed: 0 };
    }
    if (b.mode === 'charge') {
      for (const f of this.host.fighters()) {
        if (f.mode === 'dead' || b.chargeHit.has(f)) continue;
        const d = f.pos.subtract(b.pos);
        d.y = 0;
        const along = Vector3.Dot(d, b.chargeDir);
        const across = Math.abs(d.x * b.chargeDir.z - d.z * b.chargeDir.x);
        if (along > -0.2 && along < 1.6 && across < 0.95) {
          b.chargeHit.add(f);
          this.host.envHit(f, Math.round(S.dmg * b.dmgMul), b.pos.subtract(b.chargeDir), 'charge');
        }
      }
      const ahead = b.pos.add(b.chargeDir.scale(1.2));
      const k = (ahead.x / this.play.a) ** 2 + (ahead.z / this.play.b) ** 2;
      if (k > 0.97) {
        // Gegen die Mauer: benommen, verwundbar
        this.setMode(b, 'stun', 2.2);
        b.vel.setAll(0);
        b.play('hit', false, 0.7);
        this.host.sfx('block');
        this.host.shake(0.35);
        this.host.float(b.pos.add(new Vector3(0, BEAST.bull.height + 0.3, 0)), 'Benommen!');
      } else if (now >= b.modeUntil) {
        this.setMode(b, 'hunt', 0);
        b.nextAttack = now + S.cd[0] + Math.random() * (S.cd[1] - S.cd[0]);
      }
      return { wish: Vector3.Zero(), speed: 0 };
    }
    if (now >= b.nextAttack && T.mode !== 'dead') {
      if (dist > 3.6 && dist < 16) {
        this.setMode(b, 'windup', 1.0);
        b.struck = false;
        b.play('paw', true, 1.4);
        this.host.beastAttack(T, now + 1.3);
        return { wish: Vector3.Zero(), speed: 0 };
      }
      if (dist < S.reach + 0.3) {
        this.setMode(b, 'windup', 1.1);
        b.struck = true;
        b.impactAt = now + S.windup;
        b.play('attack', false, 1.1);
        this.host.beastAttack(T, b.impactAt);
        return { wish: Vector3.Zero(), speed: 0 };
      }
    }
    // Zurückweichen für Anlauf oder langsam herantrotten
    if (dist < 3.4 && now + 0.5 < b.nextAttack) return { wish: fwd.scale(-1), speed: S.walk };
    return { wish: fwd, speed: dist > 7 ? S.walk * 1.6 : S.walk };
  }

  private integrate(b: Beast, dt: number): void {
    const p = b.pos;
    p.x += b.vel.x * dt;
    p.z += b.vel.z * dt;
    if (b.mode !== 'leave') {
      const k = (p.x / this.play.a) ** 2 + (p.z / this.play.b) ** 2;
      if (k > 1) {
        const s = 1 / Math.sqrt(k);
        p.x *= s;
        p.z *= s;
      }
    }
    if (!b.alive) return;
    const R = BEAST[b.kind].radius;
    for (const f of this.host.fighters()) {
      if (f.mode === 'dead') continue;
      const dx = p.x - f.pos.x;
      const dz = p.z - f.pos.z;
      const l = Math.hypot(dx, dz);
      const min = R + 0.35;
      if (l < min && l > 1e-4) {
        p.x = f.pos.x + (dx / l) * min;
        p.z = f.pos.z + (dz / l) * min;
      }
    }
  }

  /** Bewegung passend zum Zustand */
  private animate(b: Beast): void {
    const v = Math.hypot(b.vel.x, b.vel.z);
    switch (b.mode) {
      case 'windup':
      case 'hit':
      case 'stun':
        return; // eigene Bewegung läuft schon
      case 'dead':
        return;
      case 'charge':
        b.play('run', true, 1.5);
        return;
      default:
        if (v > 3.2) b.play('run', true, Math.max(0.7, v / BEAST[b.kind].run));
        else if (v > 0.35) b.play('walk', true, Math.max(0.6, v / BEAST[b.kind].walk));
        else b.play('idle');
    }
  }

  /* ---------- Treffer an Tieren ---------- */

  /** Nächstes lebendes Tier in Schlagweite vor einem Kämpfer */
  beastFor(A: Fighter, reach: number, angle: number): Beast | null {
    let best: Beast | null = null;
    let bd = Infinity;
    for (const b of this.beasts) {
      if (!b.alive || b.mode === 'leave') continue;
      const d = b.pos.subtract(A.pos);
      d.y = 0;
      const dist = d.length() - BEAST[b.kind].radius * 0.6;
      if (dist > reach) continue;
      let a = Math.atan2(d.x, d.z) - A.g.heading;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > angle) continue;
      if (dist < bd) {
        bd = dist;
        best = b;
      }
    }
    return best;
  }

  /** Nächstes bedrohliches Tier (für Blickrichtung und KI) */
  nearest(p: Vector3, range: number): Beast | null {
    let best: Beast | null = null;
    let bd = range;
    for (const b of this.beasts) {
      if (!b.alive || b.mode === 'leave' || b.mode === 'enter') continue;
      const d = Vector3.Distance(b.pos, p) - BEAST[b.kind].radius * 0.5;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Schaden an einem Tier. Gibt true zurück, wenn es stirbt. */
  damage(b: Beast, dmg: number, dir: Vector3, heavy: boolean, by: Fighter | null): boolean {
    if (!b.alive) return false;
    b.hp -= dmg;
    const d = dir.clone();
    d.y = 0;
    if (d.length() > 1e-3) d.normalize();
    if (b.hp <= 0) {
      b.hp = 0;
      this.setMode(b, 'dead', 25);
      b.vel.copyFrom(d.scale(2));
      b.play('death', false, 1);
      this.host.sfx('fall');
      this.host.kick(by ? 0.7 : 0.4);
      const at = b.pos.clone();
      window.setTimeout(() => this.host.pool(at, b.kind === 'bull' ? 1.6 : 1), 900);
      this.host.float(b.pos.add(new Vector3(0, BEAST[b.kind].height + 0.4, 0)), `${BEAST[b.kind].name} erlegt!`);
      return true;
    }
    if (b.kind === 'wolf' || heavy || b.mode === 'stun') {
      if (b.mode !== 'stun') this.setMode(b, 'hit', b.kind === 'wolf' ? 0.45 : 0.35);
      b.play('hit', false, 1.2);
      b.vel.addInPlace(d.scale(b.kind === 'wolf' ? 3 : 1));
    }
    if (b.kind === 'wolf' && b.target !== by && by && Math.random() < 0.6) b.target = by;
    return false;
  }

  /* ---------- Netz ---------- */

  /** Gastgeber: Tiere für den Schnappschuss */
  snap(): NetBeast[] {
    return this.beasts.map((b) => [
      b.id,
      b.kind === 'wolf' ? 0 : 1,
      Math.round(b.pos.x * 100) / 100,
      Math.round(b.pos.z * 100) / 100,
      Math.round(b.heading * 100) / 100,
      MODE_CODES.indexOf(b.mode),
      Math.round((100 * b.hp) / b.hpMax),
    ]);
  }

  /** Gast: Tiere aus dem Schnappschuss übernehmen */
  applySnap(list: NetBeast[] | undefined): void {
    if (!list) return;
    if (!this.cached) {
      if (list.length) this.preload();
      return;
    }
    const seen = new Set<number>();
    for (const [id, k, x, z, h, m, hp] of list) {
      seen.add(id);
      let b = this.beasts.find((o) => o.id === id);
      if (!b) {
        const kind: BeastKind = k === 0 ? 'wolf' : 'bull';
        b = new Beast(kind, this.scene, this.cached.get(kind)!, this.caster, id);
        b.pos.set(x, 0, z);
        this.beasts.push(b);
      }
      b.netPos = new Vector3(x, 0, z);
      b.setHeading(h);
      const mode = MODE_CODES[m] ?? 'hunt';
      if (mode !== b.mode) this.replicaMode(b, mode);
      b.hp = (hp / 100) * b.hpMax;
    }
    for (const b of this.beasts) if (!seen.has(b.id)) b.dispose();
  }

  private cached: Map<BeastKind, AssetContainer> | null = null;

  /** Gast: Modelle vorab laden (wenn das Arenaleben an ist) */
  preload(): void {
    void loadBeasts(this.scene).then((m) => (this.cached = m));
  }

  private replicaMode(b: Beast, m: BeastMode): void {
    const prev = b.mode;
    b.mode = m;
    if (m === 'dead') b.play('death', false);
    else if (m === 'hit' || m === 'stun') b.play('hit', false, m === 'stun' ? 0.7 : 1.2);
    else if (m === 'windup') b.play(b.kind === 'bull' && prev !== 'hunt' ? 'paw' : 'attack', b.kind === 'bull', 1.15);
  }

  private replica(b: Beast, dt: number): void {
    if (!b.netPos) return;
    const before = b.pos.clone();
    b.pos.x += (b.netPos.x - b.pos.x) * Math.min(1, dt * 12);
    b.pos.z += (b.netPos.z - b.pos.z) * Math.min(1, dt * 12);
    const v = Vector3.Distance(before, b.pos) / Math.max(dt, 1e-3);
    b.vel.set((b.pos.x - before.x) / Math.max(dt, 1e-3), 0, (b.pos.z - before.z) / Math.max(dt, 1e-3));
    if (b.mode === 'hunt' || b.mode === 'enter' || b.mode === 'leave' || b.mode === 'charge') {
      if (v > 3.2) b.play('run', true, Math.max(0.7, v / BEAST[b.kind].run));
      else if (v > 0.35) b.play('walk', true, Math.max(0.6, v / BEAST[b.kind].walk));
      else b.play('idle');
    }
  }

  /** Fürs Anzeigen von Namen und Leben */
  get visible(): Beast[] {
    return this.beasts.filter((b) => b.alive && b.mode !== 'leave');
  }
}

export { BEAST };
