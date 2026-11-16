import { Vector3 } from '@babylonjs/core';
import type { Gladiator } from '../gladiators/gladiator';
import C from '../data/combat.json';
import { derive, zeroAttrs, type FighterInfo, type Stats } from './hero';
import type { ClassId } from '../data/classes';

/** Seite, von der ein Schlag kommt – nur noch für Animation und Trefferzone */
export type Dir = 'top' | 'left' | 'right';
export type Mode = 'free' | 'attack' | 'block' | 'bash' | 'roll' | 'stagger' | 'hit' | 'dead' | 'special';

export interface AttackDef {
  anim: string;
  range?: number[];
  speed: number;
  impact: number;
  damage: number;
  stamina: number;
  recovery: number;
  heavy: boolean;
  windup: number;
}

export interface ActiveAttack {
  key: string;
  def: AttackDef;
  dir: Dir;
  heavy: boolean;
  start: number;
  impactAt: number;
  end: number;
  actionId: number;
  /** Schadensfaktor (Kombo-Abschluss, Gegenangriff) */
  power: number;
  combo: number;
  /** Hakenschlag: um den Schild herum */
  hooked?: boolean;
}

/** Ausrüstung und Klasse wirken über dieses Paket auf den Kampf */
export interface Kit {
  /** Reichweite der Waffe in Metern */
  reach: number;
  /** Schadensfaktor der Waffe */
  damage: number;
  /** Tempo der Angriffe (größer = schneller) */
  speed: number;
  /** Ausdauerkosten beim Blocken (kleiner = besserer Schild) */
  blockCost: number;
  /** Rüstung 0..1 an Kopf, Rumpf, Armen, Beinen */
  armor: { head: number; body: number; arm: number; leg: number };
  /** Bewegungstempo */
  move: number;
  /** Ausweichrolle: Tempo und Kosten */
  roll: number;
  hasShield: boolean;
}

export const DEFAULT_KIT: Kit = {
  reach: 2.35,
  damage: 1,
  speed: 1,
  blockCost: 1,
  armor: { head: 0.3, body: 0, arm: 0.35, leg: 0.35 },
  move: 1,
  roll: 1,
  hasShield: true,
};

export const COMBAT = C;

/** Spiegelt die Seite (aus Sicht des Gegenübers) – für Anzeigen */
export function blockSideFor(attackDir: Dir): Dir {
  return attackDir === 'left' ? 'right' : attackDir === 'right' ? 'left' : 'top';
}

export interface FighterEvents {
  attackStart(f: Fighter, a: ActiveAttack): void;
  impact(f: Fighter, a: ActiveAttack): void;
  bashImpact(f: Fighter): void;
  message(f: Fighter, text: string): void;
}

/** Haltepose für den Schildblock: Schild vor dem Körper */
const BLOCK_POSE = { anim: 'shield_bash', at: 0.2 };
const WEAPON_BLOCK_POSE = { anim: 'block', at: 0.1 };

/** Ein Kämpfer: Zustand, Ausdauer, Aktionen. Die Regeln beim Aufeinandertreffen stehen in Game. */
export class Fighter {
  mode: Mode = 'free';
  attack: ActiveAttack | null = null;
  modeUntil = 0;
  exhaustedUntil = 0;
  staminaDelay = 0;
  invulnUntil = 0;
  weakUntil = 0;
  slowUntil = 0;
  guardBrokenUntil = 0;
  vel = Vector3.Zero();
  speed = 0;
  target: Fighter | null = null;
  rollDir = Vector3.Zero();
  rollUntil = 0;
  backwards = false;
  lastAction = 0;
  stats: Stats = derive(zeroAttrs());
  info: FighterInfo = { name: 'Gladiator', level: 1 };
  kit: Kit = DEFAULT_KIT;
  parries = 0;
  favor = 50;
  damageTaken = 0;
  /** Wetter: Erholung und Kosten fürs Ausweichen */
  weather = { regenMul: 1, rollCostMul: 1 };
  /** Block */
  blockStart = 0;
  blockWanted = false;
  private blockAction = 0;
  /** Kombo */
  combo = 0;
  lastAttackEnd = -10;
  riposteUntil = 0;
  /** Schlag-Richtung für Anzeigen (letzter Angriff) */
  guard: Dir = 'top';
  /** Klasse und Sonderfähigkeit */
  cls: ClassId = 'murmillo';
  specialReadyAt = 0;
  dashUntil = 0;
  dashDir = Vector3.Zero();
  buffUntil = 0;
  hookUntil = 0;

  constructor(
    readonly g: Gladiator,
    readonly name: string,
    private readonly ev: FighterEvents,
  ) {}

  get pos(): Vector3 {
    return this.g.position;
  }

  get exhausted(): boolean {
    return this.now < this.exhaustedUntil;
  }

  get blocking(): boolean {
    return this.mode === 'block';
  }

  now = 0;

  get canAct(): boolean {
    if (this.mode === 'free' || this.mode === 'block') return true;
    // Kombo: nach der Erholungsphase darf der nächste Angriff starten
    if (this.mode === 'attack' && this.attack) {
      const t = (this.now - this.attack.start) / (this.attack.end - this.attack.start);
      return t >= this.attack.def.recovery;
    }
    return false;
  }

  tick(now: number, dt: number): void {
    this.now = now;
    if (this.mode !== 'dead' && this.mode !== 'free' && this.mode !== 'attack' && this.mode !== 'block' && now >= this.modeUntil) {
      this.mode = 'free';
    }
    if (this.mode === 'attack' && this.attack && now >= this.attack.end) {
      this.mode = 'free';
      this.lastAttackEnd = now;
      this.attack = null;
    }
    // Block automatisch wieder aufnehmen, wenn die Taste noch gehalten wird
    if (this.mode === 'free' && this.blockWanted) this.enterBlock(false);
    // Ausdauer (beim Blocken langsamer)
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.mode !== 'dead') {
      let rate = (this.exhausted ? this.stats.staminaRegen * 1.3 : this.stats.staminaRegen) * this.weather.regenMul;
      if (this.mode === 'block') rate *= 0.4;
      if (now < this.buffUntil) rate *= 2;
      this.g.stamina = Math.min(this.stats.staminaMax, this.g.stamina + rate * dt);
    }
  }

  private spend(v: number): boolean {
    this.g.stamina = Math.max(0, this.g.stamina - v);
    this.staminaDelay = COMBAT.staminaDelay;
    if (this.g.stamina <= 0 && !this.exhausted) {
      this.exhaustedUntil = this.now + COMBAT.exhaustTime;
      this.ev.message(this, 'Erschöpft!');
    }
    return true;
  }

  /** Ausdauer durch fremde Einwirkung verlieren (Parade, Schildstoß, Block) */
  drain(v: number): void {
    this.spend(v);
  }

  faceTarget(): void {
    if (!this.target || this.target.mode === 'dead') return;
    const d = this.target.pos.subtract(this.pos);
    this.g.setHeading(Math.atan2(d.x, d.z));
  }

  /* ---------- Block ---------- */

  /** Block-Taste gedrückt oder losgelassen */
  setBlock(on: boolean): void {
    this.blockWanted = on;
    if (on) {
      if (this.mode === 'free') this.enterBlock(true);
    } else if (this.mode === 'block') {
      this.leaveBlock();
    }
  }

  private enterBlock(fresh: boolean): void {
    if (this.now < this.guardBrokenUntil) return;
    this.mode = 'block';
    // Parade nur bei frischem Druck – wer den Block einfach hält, pariert nicht
    this.blockStart = fresh ? this.now : -10;
    this.faceTarget();
    this.holdBlockPose(0.08);
  }

  private holdBlockPose(fadeIn: number): void {
    const p = this.kit.hasShield ? BLOCK_POSE : WEAPON_BLOCK_POSE;
    this.blockAction = this.g.animator.play(p.anim, { range: [p.at, p.at + 0.005], speed: 0.001, loop: true, fadeIn, fadeOut: 0.12 });
    this.lastAction = this.blockAction;
  }

  private leaveBlock(): void {
    this.g.animator.cancel(this.blockAction, 0.14);
    this.mode = 'free';
  }

  /** Treffer im Block abgefangen: kurzes Zurückfedern, dann wieder Haltepose */
  blockReact(cost: number, heavy: boolean): void {
    this.spend(cost * this.kit.blockCost);
    const p = this.kit.hasShield ? BLOCK_POSE : WEAPON_BLOCK_POSE;
    const id = this.g.animator.play(p.anim, {
      range: [Math.max(0, p.at - 0.14), p.at + 0.06],
      speed: heavy ? 0.7 : 1.1,
      fadeIn: 0.03,
      fadeOut: 0.06,
      onEnd: () => {
        if (this.mode === 'block') this.holdBlockPose(0.06);
      },
    });
    this.blockAction = id;
    this.lastAction = id;
  }

  /** Gelungene Parade: sofort handlungsfähig, kurzer Gegenangriff mit Bonus */
  parrySucceeded(): void {
    this.parries++;
    this.riposteUntil = this.now + COMBAT.riposte.window;
    this.blockStart = -10;
  }

  /** Deckung gebrochen (Wuchtschlag, Schildstoß, erschöpft) */
  guardBreak(time: number): void {
    this.blockWanted = false;
    this.guardBrokenUntil = this.now + time + 0.3;
    this.stagger(time, 'shield_break');
  }

  /* ---------- Angriff ---------- */

  startAttack(heavy: boolean): boolean {
    if (!this.canAct) return false;
    const now = this.now;
    // Kombo fortsetzen, wenn der letzte leichte Schlag gerade erst vorbei ist
    const chaining = !heavy && (this.mode === 'attack' || now - this.lastAttackEnd < COMBAT.combo.window) && this.combo > 0 && this.combo < 3;
    const idx = heavy ? 0 : chaining ? this.combo : 0;
    const key = heavy ? (Math.random() < 0.5 ? 'heavy_top' : 'heavy_left') : COMBAT.combo.order[idx];
    const def = (COMBAT.attacks as unknown as Record<string, AttackDef>)[key];
    if (this.g.stamina < def.stamina * 0.5) {
      this.ev.message(this, 'Keine Ausdauer!');
      return false;
    }
    if (this.mode === 'block') this.g.animator.cancel(this.blockAction, 0.08);
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.1);
    this.spend(def.stamina);
    const riposte = now < this.riposteUntil;
    this.riposteUntil = 0;
    this.faceTarget();
    const dir: Dir = key.endsWith('left') ? 'left' : key.endsWith('right') ? 'right' : 'top';
    this.guard = dir;
    // Zwei Phasen: lesbares Ausholen, dann schneller Schwung bis zum Treffer
    const range = def.range as [number, number] | undefined;
    const base = this.g.animator.durationOf(def.anim, 1, range);
    const swing = def.speed * this.kit.speed;
    let windup = heavy ? def.windup : COMBAT.combo.windup[idx];
    windup *= this.stats.windupMul / this.kit.speed;
    if (riposte) windup *= COMBAT.riposte.windupMul;
    if (this.exhausted) windup *= 1.15;
    const swingFrac = Math.max(0, def.impact - 0.14);
    const swingTime = ((def.impact - swingFrac) * base) / swing;
    const slowTime = Math.max(0.05, windup - swingTime);
    const slowSpeed = (swingFrac * base) / slowTime;
    const total = windup + ((1 - def.impact) * base) / swing;
    const dmg = heavy ? def.damage : COMBAT.combo.damage[idx];
    const a: ActiveAttack = {
      key,
      def: { ...def, damage: dmg },
      dir,
      heavy,
      start: now,
      impactAt: now + windup,
      end: now + total,
      actionId: 0,
      power: (riposte ? COMBAT.riposte.damageMul : 1) * this.kit.damage,
      combo: heavy ? 0 : idx + 1,
    };
    a.actionId = this.g.animator.play(def.anim, {
      speed: slowSpeed,
      range,
      duration: total,
      fadeIn: 0.08,
      fadeOut: 0.2,
      events: [
        { at: slowTime / total, fn: () => this.g.animator.setActionSpeed(a.actionId, swing) },
        { at: windup / total, fn: () => this.ev.impact(this, a) },
      ],
    });
    this.combo = heavy ? 0 : idx + 1 >= 3 ? 0 : idx + 1;
    this.attack = a;
    this.mode = 'attack';
    this.ev.attackStart(this, a);
    return true;
  }

  /** Schwerer Schlag: ab einem Teil des Ausholens nicht mehr durch leichte Treffer zu unterbrechen */
  get armored(): boolean {
    const a = this.attack;
    return !!a && a.heavy && this.mode === 'attack' && this.now >= a.start + (a.impactAt - a.start) * COMBAT.heavyArmor && this.now < a.impactAt;
  }

  bash(): boolean {
    if (!this.canAct) return false;
    if (this.g.stamina < COMBAT.bash.stamina * 0.5) {
      this.ev.message(this, 'Keine Ausdauer!');
      return false;
    }
    if (this.mode === 'block') this.g.animator.cancel(this.blockAction, 0.06);
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.1);
    this.attack = null;
    this.spend(COMBAT.bash.stamina);
    this.faceTarget();
    const dur = this.g.animator.durationOf('shield_bash', COMBAT.bash.speed);
    this.mode = 'bash';
    this.modeUntil = this.now + dur * 0.8;
    this.lastAction = this.g.animator.play('shield_bash', {
      speed: COMBAT.bash.speed,
      fadeIn: 0.06,
      events: [{ at: COMBAT.bash.impact, fn: () => this.ev.bashImpact(this) }],
    });
    return true;
  }

  roll(dir: Vector3): boolean {
    if (!this.canAct) return false;
    if (this.exhausted) {
      this.ev.message(this, 'Zu erschöpft zum Ausweichen');
      return false;
    }
    if (this.mode === 'block') this.g.animator.cancel(this.blockAction, 0.05);
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.08);
    this.attack = null;
    this.spend(COMBAT.roll.stamina * this.weather.rollCostMul / Math.max(0.6, this.kit.roll));
    const speed = COMBAT.roll.speed * this.stats.rollMul * this.kit.roll;
    const dur = this.g.animator.durationOf('roll', speed);
    this.mode = 'roll';
    this.modeUntil = this.now + dur * 0.78;
    this.invulnUntil = this.now + COMBAT.roll.iframes;
    this.rollDir = dir.normalize();
    this.rollUntil = this.now + dur * 0.55;
    this.g.setHeading(Math.atan2(dir.x, dir.z));
    this.lastAction = this.g.animator.play('roll', { speed, fadeIn: 0.05, fadeOut: 0.2 });
    return true;
  }

  get rollSpeed(): number {
    const dur = this.g.animator.durationOf('roll', COMBAT.roll.speed * this.stats.rollMul * this.kit.roll);
    return COMBAT.roll.distance / (dur * 0.55);
  }

  interruptAttack(): void {
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.08);
    this.attack = null;
  }

  stagger(time: number, anim: string, speed = 1): void {
    if (this.mode === 'dead') return;
    this.interruptAttack();
    if (this.mode === 'block') this.g.animator.cancel(this.blockAction, 0.05);
    this.mode = 'stagger';
    this.modeUntil = this.now + time;
    this.combo = 0;
    this.lastAction = this.g.animator.play(anim, { speed, fadeIn: 0.05, fadeOut: 0.2 });
  }

  /** Treffer einstecken. Gibt true zurück, wenn der Kämpfer fällt. */
  takeHit(dmg: number, anim: string, heavy: boolean): boolean {
    this.g.hp = Math.max(0, this.g.hp - dmg);
    this.damageTaken += dmg;
    if (this.g.hp <= 0) return true;
    // Wuchtschlag im Ausholen läuft weiter
    if (this.armored && !heavy) return false;
    this.interruptAttack();
    if (this.mode === 'block') this.g.animator.cancel(this.blockAction, 0.04);
    this.mode = 'hit';
    this.combo = 0;
    this.modeUntil = this.now + (heavy ? 0.75 : 0.42);
    this.lastAction = this.g.animator.play(anim, { speed: heavy ? 1.0 : 1.25, fadeIn: 0.03, fadeOut: 0.2 });
    return false;
  }

  /** Sofort wieder stehen (neuer Kampf) */
  standUp(): void {
    this.g.animator.resume('death');
    this.g.animator.stop('death');
    this.g.animator.stop('get_up');
    this.mode = 'free';
    this.blockWanted = false;
    this.refill();
  }

  /** Volle Lebenspunkte und Ausdauer */
  refill(): void {
    this.specialReadyAt = this.now + 4;
    this.buffUntil = 0;
    this.hookUntil = 0;
    this.g.hp = this.stats.hpMax;
    this.g.stamina = this.stats.staminaMax;
    this.exhaustedUntil = 0;
    this.guardBrokenUntil = 0;
    this.combo = 0;
  }

  die(): void {
    this.interruptAttack();
    this.blockWanted = false;
    this.mode = 'dead';
    this.g.animator.play('death', { fadeIn: 0.08, loop: true });
    window.setTimeout(() => this.g.animator.pause('death'), this.g.animator.durationOf('death') * 960);
  }

  revive(): void {
    this.g.animator.resume('death');
    this.refill();
    this.mode = 'stagger';
    this.modeUntil = this.now + this.g.animator.durationOf('get_up') * 0.85;
    this.g.animator.play('get_up', { fadeIn: 0.2 });
  }
}
