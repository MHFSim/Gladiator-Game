import { FreeCamera, Scene, Vector3 } from '@babylonjs/core';
import type { Arena } from '../arena/capua';
import { ARENA } from '../arena/capua';
import type { Gladiator } from '../gladiators/gladiator';
import type { Action, TouchInput } from '../input/touch';
import { AiController } from './ai';
import { blockSideFor, COMBAT, Fighter, type ActiveAttack, type Dir, type FighterEvents } from './fighter';
import { Fx } from './fx';

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
}

export interface GuardInfo {
  anchor: Vector3; // Weltposition über dem Gegner
  mine: Dir;
  foe: Dir; // Seite aus Spielersicht
  incoming: Dir | null; // aus Spielersicht
  heavy: boolean;
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
    private readonly arena: Arena,
    playerG: Gladiator,
    foeG: Gladiator,
    private readonly input: TouchInput,
    private readonly hud: HudHooks,
    difficulty: number,
  ) {
    this.player = new Fighter(playerG, 'Du', this);
    this.foe = new Fighter(foeG, 'Gegner', this);
    this.player.target = this.foe;
    this.foe.target = this.player;
    this.ai = new AiController(this.foe, this.player, difficulty);
    this.fx = new Fx(scene);
    this.resetPositions();
    hud.score(0, 0);
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

  /* ---------- Ereignisse der Kämpfer ---------- */

  attackStart(f: Fighter, a: ActiveAttack): void {
    if (f === this.player) this.ai.onFoeAttack(a, this.now);
  }

  feint(f: Fighter): void {
    if (f === this.player) {
      this.ai.onFoeFeint();
      this.hud.floatText(this.chest(f), 'Finte', 'good');
    } else {
      this.hud.floatText(this.chest(f), 'Finte!', 'bad');
    }
  }

  message(f: Fighter, text: string): void {
    if (f === this.player) this.hud.hint(text, 1.2);
  }

  private chest(f: Fighter): Vector3 {
    return f.pos.add(new Vector3(0, f.g.chestHeight + 0.35, 0));
  }

  private inFront(a: Fighter, b: Fighter, maxAngle: number): boolean {
    const d = b.pos.subtract(a.pos);
    return Math.abs(angleDiff(a.g.heading, Math.atan2(d.x, d.z))) < maxAngle;
  }

  /** Der Treffer-Moment eines Angriffs: Parade, Block oder Treffer */
  impact(A: Fighter, a: ActiveAttack): void {
    const D = A === this.player ? this.foe : this.player;
    if (A.attack !== a || A.mode !== 'attack' || D.mode === 'dead') return;
    const dist = Vector3.Distance(A.pos, D.pos);
    if (dist > COMBAT.reach || !this.inFront(A, D, COMBAT.maxAngle)) return;
    const contact = Vector3.Lerp(A.pos, D.pos, 0.65);
    contact.y = D.g.chestHeight + (a.dir === 'top' ? 0.25 : 0);
    const push = D.pos.subtract(A.pos).normalize();
    const youHit = A === this.player;

    if (this.now < D.invulnUntil) {
      this.hud.floatText(this.chest(D), 'Ausgewichen', youHit ? 'bad' : 'good');
      return;
    }
    const need = blockSideFor(a.dir);

    // Parade
    if (D.mode === 'parry' && this.now <= D.parryUntil && D.parryDir === need) {
      D.parrySucceeded();
      A.drain(COMBAT.parried.stamina);
      A.stagger(COMBAT.parried.staggerTime, 'knockback', 1.1);
      A.vel.addInPlace(push.scale(-2.5));
      this.fx.sparksAt(contact);
      this.fx.sparksAt(contact);
      this.hitStop = 0.14;
      this.shake = 0.3;
      this.hud.floatText(this.chest(D), youHit ? 'Pariert!' : 'PARADE!', youHit ? 'bad' : 'good');
      return;
    }

    // Block
    const canBlock = (D.mode === 'free' || D.mode === 'parry') && this.now >= D.guardBrokenUntil;
    if (canBlock && D.guard === need) {
      if (D.exhausted) {
        // Erschöpft: die Deckung bricht unter dem Schlag
        const dmg = Math.round(a.def.damage * 0.5);
        this.fx.sparksAt(contact);
        this.hud.floatText(this.chest(D), 'Deckung bricht', youHit ? 'good' : 'bad');
        this.hitStop = 0.08;
        if (D.takeHit(dmg, 'hit_chest', a.heavy)) return this.kill(D, push);
        D.stagger(0.8, 'shield_break');
        D.guardBrokenUntil = this.now + 1.0;
        return;
      }
      this.fx.sparksAt(contact);
      D.blockReact(a.def.damage * COMBAT.blockStaminaFactor * (a.heavy ? 1.4 : 1));
      if (a.heavy) D.g.hp = Math.max(1, D.g.hp - a.def.damage * COMBAT.heavyChip);
      D.vel.addInPlace(push.scale(a.heavy ? 1.6 : 0.8));
      this.shake = a.heavy ? 0.18 : 0.1;
      this.hitStop = a.heavy ? 0.07 : 0.04;
      this.hud.floatText(this.chest(D), 'Geblockt', youHit ? '' : 'good');
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
    let armor = 0;
    if (zoneKey === 'top') armor = COMBAT.armor.helmet;
    // Angriff von links trifft die rechte Seite des Gegners (Manica), von rechts die linke (Beinschiene)
    if (zoneKey === 'arm' && a.dir === 'left') armor = COMBAT.armor.manica;
    if (zoneKey === 'leg' && a.dir === 'right') armor = COMBAT.armor.greave;
    const weak = this.now < A.weakUntil ? 0.75 : 1;
    const dmg = Math.round(a.def.damage * zone.mult * (1 - armor) * weak);
    if (zone.debuff === 'weak') D.weakUntil = this.now + 3;
    if (zone.debuff === 'slow') D.slowUntil = this.now + 3;
    this.fx.bloodAt(contact, push);
    this.shake = a.heavy ? 0.4 : 0.22;
    this.hitStop = a.heavy ? 0.1 : 0.06;
    this.hud.floatText(this.chest(D), `${zone.name} −${dmg}`, youHit ? (a.heavy ? 'big' : 'good') : 'bad');
    if (D.takeHit(dmg, zone.anim, a.heavy)) return this.kill(D, push);
    D.vel.addInPlace(push.scale(a.heavy ? 2.6 : 1.4));
  }

  bashImpact(A: Fighter): void {
    const D = A === this.player ? this.foe : this.player;
    if (A.mode !== 'bash' || D.mode === 'dead') return;
    const dist = Vector3.Distance(A.pos, D.pos);
    const youBash = A === this.player;
    if (dist > COMBAT.bash.range || !this.inFront(A, D, 1.0) || this.now < D.invulnUntil) {
      A.modeUntil += COMBAT.bash.missLock;
      if (youBash) this.hud.floatText(this.chest(D), 'Daneben', 'bad');
      return;
    }
    if (D.mode === 'attack' && D.attack && this.now < D.attack.impactAt) {
      if (youBash) this.hud.floatText(this.chest(D), 'Zu langsam', 'bad');
      return;
    }
    if (D.mode === 'bash') {
      this.hud.floatText(this.chest(D), 'Konter', '');
      this.fx.sparksAt(this.chest(D));
      return;
    }
    const push = D.pos.subtract(A.pos).normalize();
    D.stagger(COMBAT.bash.staggerTime, 'shield_break');
    D.guardBrokenUntil = this.now + COMBAT.bash.staggerTime + 0.25;
    D.drain(COMBAT.bash.targetStamina);
    D.vel.addInPlace(push.scale(4));
    this.shake = 0.25;
    this.hitStop = 0.06;
    this.hud.floatText(this.chest(D), 'Deckung gebrochen!', youBash ? 'good' : 'bad');
  }

  private kill(D: Fighter, push: Vector3): void {
    D.die();
    D.vel.addInPlace(push.scale(1.5));
    this.hitStop = 0.25;
    if (this.roundOver) return;
    this.roundOver = true;
    if (D === this.foe) {
      this.wins++;
      this.hud.hint('Sieg! Der Gegner liegt im Sand.', 3.5);
    } else {
      this.losses++;
      this.hud.hint('Du bist gefallen …', 3.5);
    }
    this.hud.score(this.wins, this.losses);
    window.setTimeout(() => this.newRound(), 4500);
  }

  private newRound(): void {
    for (const f of [this.player, this.foe]) {
      if (f.mode === 'dead') f.revive();
      else {
        f.g.hp = COMBAT.hpMax;
        f.g.stamina = COMBAT.staminaMax;
      }
    }
    this.roundOver = false;
    this.ai.reset(this.now);
    this.hud.hint('Nächste Runde – kämpft!', 2);
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
      case 'heavy': {
        const dir: Dir = this.locked ? p.guard : 'top';
        p.startAttack(dir, a.type === 'heavy');
        break;
      }
      case 'guard':
        p.setGuard(a.dir);
        break;
      case 'parry':
        p.parry(a.dir ?? p.guard);
        break;
      case 'bash':
        p.bash();
        break;
      case 'roll': {
        let dir = this.stickWorld();
        const fw = new Vector3(Math.sin(p.g.heading), 0, Math.cos(p.g.heading));
        const right = new Vector3(fw.z, 0, -fw.x);
        if (a.dir === 'left') dir = right.scale(-1);
        else if (a.dir === 'right') dir = right;
        else if (a.dir === 'forward') dir = fw;
        else if (a.dir === 'back' || dir.length() < 0.25) dir = fw.scale(-1);
        p.roll(dir);
        break;
      }
      case 'lock':
        this.locked = !this.locked;
        this.manualUnlock = !this.locked;
        this.hud.setLocked(this.locked);
        break;
      case 'cheer':
        if (p.mode === 'free') {
          p.g.animator.play('cheer');
          this.hud.hint('Das Publikum fehlt noch – kommt in Phase 3', 2);
        }
        break;
    }
  }

  /* ---------- Hauptschleife ---------- */

  update(rawDt: number, daylight: number, freeze = false): void {
    let dt = Math.min(rawDt, 0.05);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      const slow = this.hitStop > 0 ? 0.06 : 1;
      this.scene.animationTimeScale = slow;
      dt *= slow;
    }
    this.now += dt;
    for (const f of [this.player, this.foe]) f.tick(this.now, dt);

    // Automatisch aufschalten, wenn der Gegner nah ist
    const dist = Vector3.Distance(this.player.pos, this.foe.pos);
    if (!this.locked && !this.manualUnlock && dist < COMBAT.lockRange && this.foe.mode !== 'dead') {
      this.locked = true;
      this.hud.setLocked(true);
    }
    if (this.manualUnlock && dist > COMBAT.lockRange + 4) this.manualUnlock = false;
    this.input.locked = this.locked;

    for (const a of this.input.takeActions()) this.handle(a);
    if (!freeze) this.aiMove = this.ai.update(this.now);

    this.movePlayer(dt);
    this.moveFoe(dt, freeze);
    for (const f of [this.player, this.foe]) {
      this.integrate(f, dt);
      f.g.animator.update(dt);
    }
    this.arena.update(dt, daylight);
    if (!freeze) this.updateCamera(dt);
    this.updateHud();
  }

  private updateHud(): void {
    const p = this.player;
    this.hud.setBars(p.g.hp, p.g.stamina, p.exhausted);
    if (!this.locked || this.foe.mode === 'dead') {
      this.hud.guard(null);
      return;
    }
    const fa = this.foe.attack;
    this.hud.guard({
      anchor: this.foe.pos.add(new Vector3(0, this.foe.g.chestHeight - 0.05, 0)),
      mine: p.guard,
      foe: blockSideFor(this.foe.guard),
      incoming: fa && this.now < fa.impactAt ? blockSideFor(fa.dir) : null,
      heavy: !!fa?.heavy,
      foeHp: this.foe.g.hp,
      foeSt: this.foe.g.stamina,
    });
  }

  /* ---------- Bewegung ---------- */

  private maxSpeed(f: Fighter, locked: boolean): number {
    let s = locked ? 2.6 : 6.0;
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
    } else if (f.mode === 'hit' || f.mode === 'stagger' || f.mode === 'dead' || f.mode === 'roll' || f.mode === 'bash' || f.mode === 'parry') {
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

  private moveFoe(dt: number, freeze: boolean): void {
    const m = freeze ? { dir: Vector3.Zero(), speed: 0 } : this.aiMove;
    this.steer(this.foe, m.dir, Math.min(1, m.speed / this.maxSpeed(this.foe, true)), true, dt);
  }

  private integrate(f: Fighter, dt: number): void {
    const pos = f.pos;
    pos.x += f.vel.x * dt;
    pos.z += f.vel.z * dt;
    const r = Math.hypot(pos.x, pos.z);
    if (r > ARENA.playRadius) {
      pos.x *= ARENA.playRadius / r;
      pos.z *= ARENA.playRadius / r;
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
    const d = this.input.takeCamDelta();
    const p = this.player;
    const target = p.pos.add(new Vector3(0, 1.5, 0));
    let camPos: Vector3;
    let look: Vector3;
    if (this.locked && this.foe.mode !== 'dead') {
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
    const rr = Math.hypot(camPos.x, camPos.z);
    const maxR = ARENA.radius - 0.4;
    if (rr > maxR) {
      camPos.x *= maxR / rr;
      camPos.z *= maxR / rr;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * 0.12;
      camPos.addInPlace(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.camera.position.copyFrom(Vector3.Lerp(this.camera.position, camPos, Math.min(1, dt * 10)));
    this.camLook = Vector3.Lerp(this.camLook, look, Math.min(1, dt * 10));
    this.camera.setTarget(this.camLook);
  }

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
