import { Vector3 } from '@babylonjs/core';
import type { Gladiator } from '../gladiators/gladiator';
import C from '../data/combat.json';

export type Dir = 'top' | 'left' | 'right';
export type Mode = 'free' | 'attack' | 'parry' | 'bash' | 'roll' | 'stagger' | 'hit' | 'dead';

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
}

export const COMBAT = C;

/** Seite, auf der der Verteidiger blocken muss (spiegelverkehrt, da man sich gegenübersteht) */
export function blockSideFor(attackDir: Dir): Dir {
  return attackDir === 'left' ? 'right' : attackDir === 'right' ? 'left' : 'top';
}

export interface FighterEvents {
  attackStart(f: Fighter, a: ActiveAttack): void;
  impact(f: Fighter, a: ActiveAttack): void;
  bashImpact(f: Fighter): void;
  feint(f: Fighter): void;
  message(f: Fighter, text: string): void;
}

/** Ein Kämpfer: Zustand, Ausdauer, Aktionen. Die Regeln beim Aufeinandertreffen stehen in Game. */
export class Fighter {
  mode: Mode = 'free';
  guard: Dir = 'top';
  attack: ActiveAttack | null = null;
  modeUntil = 0;
  parryDir: Dir = 'top';
  parryUntil = 0;
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

  now = 0;

  get canAct(): boolean {
    if (this.mode === 'free') return true;
    // Kombo: nach der Erholungsphase darf der nächste Angriff starten
    if (this.mode === 'attack' && this.attack) {
      const t = (this.now - this.attack.start) / (this.attack.end - this.attack.start);
      return t >= this.attack.def.recovery;
    }
    return false;
  }

  tick(now: number, dt: number): void {
    this.now = now;
    if (this.mode !== 'dead' && this.mode !== 'free' && this.mode !== 'attack' && now >= this.modeUntil) {
      this.mode = 'free';
    }
    if (this.mode === 'attack' && this.attack && now >= this.attack.end) {
      this.mode = 'free';
      this.attack = null;
    }
    // Ausdauer
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.mode !== 'dead') {
      const rate = this.exhausted ? COMBAT.staminaRegen * 1.3 : COMBAT.staminaRegen;
      this.g.stamina = Math.min(COMBAT.staminaMax, this.g.stamina + rate * dt);
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

  /** Ausdauer durch fremde Einwirkung verlieren (Parade, Schildstoß) */
  drain(v: number): void {
    this.spend(v);
  }

  faceTarget(): void {
    if (!this.target || this.target.mode === 'dead') return;
    const d = this.target.pos.subtract(this.pos);
    this.g.setHeading(Math.atan2(d.x, d.z));
  }

  setGuard(d: Dir): void {
    if (this.mode === 'dead') return;
    this.guard = d;
  }

  startAttack(dir: Dir, heavy: boolean): boolean {
    if (!this.canAct) return false;
    const key = `${heavy ? 'heavy' : 'light'}_${dir}`;
    const def = (COMBAT.attacks as unknown as Record<string, AttackDef>)[key];
    if (this.g.stamina < def.stamina * 0.5) {
      this.ev.message(this, 'Keine Ausdauer!');
      return false;
    }
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.1);
    this.spend(def.stamina);
    this.guard = dir;
    this.faceTarget();
    // Zwei Phasen: gut lesbares Ausholen (langsam), dann schneller Schwung bis zum Treffer
    const range = def.range as [number, number] | undefined;
    const base = this.g.animator.durationOf(def.anim, 1, range); // Länge bei Tempo 1
    const swing = def.speed;
    const windup = def.windup * (this.exhausted ? 1.15 : 1);
    const swingFrac = Math.max(0, def.impact - 0.14);
    const swingTime = ((def.impact - swingFrac) * base) / swing;
    const slowTime = Math.max(0.05, windup - swingTime);
    const slowSpeed = (swingFrac * base) / slowTime;
    const total = windup + ((1 - def.impact) * base) / swing;
    const a: ActiveAttack = {
      key,
      def,
      dir,
      heavy,
      start: this.now,
      impactAt: this.now + windup,
      end: this.now + total,
      actionId: 0,
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
    this.attack = a;
    this.mode = 'attack';
    this.ev.attackStart(this, a);
    return true;
  }

  /** Schweren Angriff vor dem Treffer abbrechen */
  feint(): boolean {
    const a = this.attack;
    if (this.mode !== 'attack' || !a || !a.heavy) return false;
    if (this.now > a.impactAt - COMBAT.feint.latest) return false;
    this.g.animator.cancel(a.actionId, 0.15);
    this.spend(COMBAT.feint.stamina);
    this.attack = null;
    this.mode = 'free';
    this.ev.feint(this);
    return true;
  }

  parry(dir: Dir): boolean {
    if (this.mode === 'attack' && this.attack?.heavy && this.now < this.attack.impactAt - COMBAT.feint.latest) {
      // Parade während eines schweren Angriffs = Finte
      this.feint();
    }
    if (this.mode !== 'free') return false;
    this.guard = dir;
    this.parryDir = dir;
    this.parryUntil = this.now + COMBAT.parryWindow;
    this.mode = 'parry';
    this.modeUntil = this.now + COMBAT.parryMissLock;
    this.faceTarget();
    this.lastAction = this.g.animator.play('block', { range: [0, 0.6], speed: 1.5, fadeIn: 0.05, fadeOut: 0.15 });
    return true;
  }

  /** Erfolgreiche Parade: sofort wieder handlungsfähig (Konter) */
  parrySucceeded(): void {
    this.mode = 'free';
    this.parryUntil = 0;
  }

  bash(): boolean {
    if (!this.canAct) return false;
    if (this.g.stamina < COMBAT.bash.stamina * 0.5) {
      this.ev.message(this, 'Keine Ausdauer!');
      return false;
    }
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
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.08);
    this.attack = null;
    this.spend(COMBAT.roll.stamina);
    const speed = COMBAT.roll.speed;
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
    const dur = this.g.animator.durationOf('roll', COMBAT.roll.speed);
    return COMBAT.roll.distance / (dur * 0.55);
  }

  interruptAttack(): void {
    if (this.attack) this.g.animator.cancel(this.attack.actionId, 0.08);
    this.attack = null;
  }

  stagger(time: number, anim: string, speed = 1): void {
    if (this.mode === 'dead') return;
    this.interruptAttack();
    this.mode = 'stagger';
    this.modeUntil = this.now + time;
    this.lastAction = this.g.animator.play(anim, { speed, fadeIn: 0.05, fadeOut: 0.2 });
  }

  takeHit(dmg: number, anim: string, heavy: boolean): boolean {
    this.g.hp = Math.max(0, this.g.hp - dmg);
    if (this.g.hp <= 0) return true;
    this.interruptAttack();
    this.mode = 'hit';
    this.modeUntil = this.now + (heavy ? 0.75 : 0.45);
    this.lastAction = this.g.animator.play(anim, { speed: 1.2, fadeIn: 0.04, fadeOut: 0.2 });
    return false;
  }

  blockReact(cost: number): void {
    this.spend(cost);
    if (this.mode === 'free') this.lastAction = this.g.animator.play('block', { range: [0.1, 0.55], speed: 1.6, fadeIn: 0.04, fadeOut: 0.15 });
  }

  die(): void {
    this.interruptAttack();
    this.mode = 'dead';
    this.g.animator.play('death', { fadeIn: 0.08, loop: true });
    window.setTimeout(() => this.g.animator.pause('death'), this.g.animator.durationOf('death') * 960);
  }

  revive(): void {
    this.g.animator.resume('death');
    this.g.hp = COMBAT.hpMax;
    this.g.stamina = COMBAT.staminaMax;
    this.exhaustedUntil = 0;
    this.mode = 'stagger';
    this.modeUntil = this.now + this.g.animator.durationOf('get_up') * 0.85;
    this.g.animator.play('get_up', { fadeIn: 0.2 });
  }
}
