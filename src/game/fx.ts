import { Color4, DynamicTexture, Matrix, Mesh, MeshBuilder, ParticleSystem, PBRMaterial, Quaternion, Scene, TransformNode, Vector3, Color3 } from '@babylonjs/core';
import { flareTexture } from '../render/textures';

/** Treffer-Effekte: Blut, Funken, Blutflecken im Sand */
export class Fx {
  private blood: ParticleSystem;
  private spray: ParticleSystem;
  private mist: ParticleSystem;
  private drops: ParticleSystem;
  /** Brutalität: 1 = voll, 0.4 = reduziert, 0 = aus */
  goreMul = 1;
  private wounds = new Map<string, Mesh[]>();
  private woundMat: PBRMaterial;
  private sparks: ParticleSystem;
  private decals: Mesh[] = [];
  private decalMats: PBRMaterial[] = [];
  private pools: { m: Mesh; t: number; max: number }[] = [];
  private next = 0;

  constructor(private readonly scene: Scene) {
    const bloodTex = flareTexture(scene, 'bloodP', 'rgba(150,10,10,1)', 'rgba(90,0,0,0.85)');
    this.blood = new ParticleSystem('blood', 400, scene);
    this.blood.particleTexture = bloodTex;
    this.blood.emitter = Vector3.Zero();
    this.blood.emitRate = 0;
    this.blood.minSize = 0.03;
    this.blood.maxSize = 0.09;
    this.blood.minLifeTime = 0.4;
    this.blood.maxLifeTime = 0.9;
    this.blood.color1 = new Color4(0.55, 0.02, 0.02, 1);
    this.blood.color2 = new Color4(0.35, 0.0, 0.0, 1);
    this.blood.colorDead = new Color4(0.25, 0, 0, 0);
    this.blood.gravity = new Vector3(0, -9, 0);
    this.blood.minEmitPower = 1.5;
    this.blood.maxEmitPower = 4;
    this.blood.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.blood.start();
    this.blood.minSize = 0.03;
    this.blood.maxSize = 0.11;

    // Gestreckte Spritzer, die weit fliegen
    this.spray = new ParticleSystem('bloodSpray', 600, scene);
    this.spray.particleTexture = bloodTex;
    this.spray.emitter = Vector3.Zero();
    this.spray.emitRate = 0;
    this.spray.minSize = 0.015;
    this.spray.maxSize = 0.035;
    this.spray.minScaleY = 3;
    this.spray.maxScaleY = 7;
    this.spray.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    this.spray.minLifeTime = 0.5;
    this.spray.maxLifeTime = 1.2;
    this.spray.color1 = new Color4(0.6, 0.02, 0.02, 1);
    this.spray.color2 = new Color4(0.4, 0.0, 0.0, 1);
    this.spray.colorDead = new Color4(0.3, 0, 0, 0.5);
    this.spray.gravity = new Vector3(0, -9.81, 0);
    this.spray.minEmitPower = 3;
    this.spray.maxEmitPower = 8;
    this.spray.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.spray.start();

    // Blutnebel
    const mistTex = flareTexture(scene, 'bloodMist', 'rgba(120,8,8,0.7)', 'rgba(80,0,0,0.25)');
    this.mist = new ParticleSystem('bloodMist', 120, scene);
    this.mist.particleTexture = mistTex;
    this.mist.emitter = Vector3.Zero();
    this.mist.emitRate = 0;
    this.mist.minSize = 0.25;
    this.mist.maxSize = 0.7;
    this.mist.minLifeTime = 0.35;
    this.mist.maxLifeTime = 0.8;
    this.mist.color1 = new Color4(0.5, 0.02, 0.02, 0.55);
    this.mist.color2 = new Color4(0.35, 0.0, 0.0, 0.4);
    this.mist.colorDead = new Color4(0.2, 0, 0, 0);
    this.mist.minEmitPower = 0.4;
    this.mist.maxEmitPower = 1.4;
    this.mist.gravity = new Vector3(0, -1.5, 0);
    this.mist.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.mist.start();

    // Tropfen (Blutung, fliegende Teile)
    this.drops = new ParticleSystem('bloodDrops', 400, scene);
    this.drops.particleTexture = bloodTex;
    this.drops.emitter = Vector3.Zero();
    this.drops.emitRate = 0;
    this.drops.minSize = 0.02;
    this.drops.maxSize = 0.05;
    this.drops.minLifeTime = 0.6;
    this.drops.maxLifeTime = 1.0;
    this.drops.color1 = new Color4(0.5, 0.02, 0.02, 1);
    this.drops.color2 = new Color4(0.35, 0, 0, 1);
    this.drops.colorDead = new Color4(0.3, 0, 0, 0.6);
    this.drops.gravity = new Vector3(0, -9.81, 0);
    this.drops.direction1 = new Vector3(-0.2, -0.2, -0.2);
    this.drops.direction2 = new Vector3(0.2, 0.3, 0.2);
    this.drops.minEmitPower = 0.2;
    this.drops.maxEmitPower = 0.8;
    this.drops.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.drops.start();

    this.woundMat = new PBRMaterial('wound', scene);
    this.woundMat.albedoColor = new Color3(0.22, 0.01, 0.01);
    this.woundMat.metallic = 0;
    this.woundMat.roughness = 0.2;
    this.woundMat.environmentIntensity = 0;

    const sparkTex = flareTexture(scene, 'sparkP', 'rgba(255,250,220,1)', 'rgba(255,170,60,0.9)');
    this.sparks = new ParticleSystem('sparks', 200, scene);
    this.sparks.particleTexture = sparkTex;
    this.sparks.emitter = Vector3.Zero();
    this.sparks.emitRate = 0;
    this.sparks.minSize = 0.02;
    this.sparks.maxSize = 0.05;
    this.sparks.minLifeTime = 0.15;
    this.sparks.maxLifeTime = 0.4;
    this.sparks.color1 = new Color4(1, 0.9, 0.6, 1);
    this.sparks.color2 = new Color4(1, 0.6, 0.2, 1);
    this.sparks.colorDead = new Color4(1, 0.3, 0, 0);
    this.sparks.gravity = new Vector3(0, -6, 0);
    this.sparks.minEmitPower = 2;
    this.sparks.maxEmitPower = 6;
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.sparks.start();

    // Mehrere Spritzer-Formen, nass glänzend
    for (let i = 0; i < 4; i++) {
      const m = new PBRMaterial('bloodDecal' + i, scene);
      m.albedoTexture = splatTexture(scene, i);
      m.useAlphaFromAlbedoTexture = true;
      m.albedoColor = new Color3(0.15, 0.008, 0.008);
      m.metallic = 0;
      m.roughness = 0.28;
      m.environmentIntensity = 0;
      m.zOffset = -2;
      m.maxSimultaneousLights = 2;
      this.decalMats.push(m);
    }
  }

  /** Blutlache, die langsam unter einem Körper wächst */
  pool(at: Vector3, scale = 1): void {
    if (this.goreMul <= 0) return;
    const d = MeshBuilder.CreateGround('bloodPool', { width: 1, height: 1 }, this.scene);
    d.material = this.decalMats[3];
    d.isPickable = false;
    d.receiveShadows = true;
    d.position.set(at.x, 0.014, at.z);
    d.rotation.y = Math.random() * Math.PI * 2;
    d.scaling.set(0.05, 1, 0.05);
    this.pools.push({ m: d, t: 0, max: (1.3 + Math.random() * 0.5) * scale });
    if (this.pools.length > 12) this.pools.shift()!.m.dispose();
  }

  update(dt: number): void {
    for (const p of this.pools) {
      if (p.t >= 1) continue;
      p.t = Math.min(1, p.t + dt / 5);
      const s = 0.05 + (p.max - 0.05) * (1 - (1 - p.t) * (1 - p.t));
      p.m.scaling.set(s * 1.25, 1, s);
    }
  }

  /** Neuer Kampf: Lachen weg, Spritzer bleiben als Geschichte im Sand */
  clearPools(): void {
    for (const p of this.pools) p.m.dispose();
    this.pools = [];
  }

  /** Blut bei einem Treffer. power 1 = normal, 2+ = Fontäne (Todesstoß, Zerstückelung) */
  bloodAt(p: Vector3, dir: Vector3, power = 1): void {
    const k = this.goreMul;
    if (k <= 0) {
      this.sparksAt(p);
      return;
    }
    const d = dir.lengthSquared() > 1e-6 ? dir.normalize() : new Vector3(0, 1, 0);
    const b = this.blood;
    b.emitter = p.clone();
    b.direction1 = d.add(new Vector3(-0.7, 0.5, -0.7));
    b.direction2 = d.add(new Vector3(0.7, 1.4, 0.7));
    b.manualEmitCount = Math.round(80 * power * k);
    const sp = this.spray;
    sp.emitter = p.clone();
    sp.direction1 = d.scale(1.2).add(new Vector3(-0.5, 0.3, -0.5));
    sp.direction2 = d.scale(1.2).add(new Vector3(0.5, 1.1, 0.5));
    sp.manualEmitCount = Math.round(60 * power * k);
    const m = this.mist;
    m.emitter = p.clone();
    m.direction1 = d.add(new Vector3(-0.4, 0, -0.4));
    m.direction2 = d.add(new Vector3(0.4, 0.6, 0.4));
    m.manualEmitCount = Math.round(10 * power * k);
    // Flecken im Sand bleiben liegen, weit gestreut in Schlagrichtung
    const n = Math.round((2 + Math.random() * 3) * Math.min(3, power) * k);
    for (let i = 0; i < n; i++) {
      const far = 0.3 + Math.random() * (1.4 + power * 0.6);
      const at = new Vector3(p.x + d.x * far + (Math.random() - 0.5) * 0.8, 0.012 + this.next * 0.0002, p.z + d.z * far + (Math.random() - 0.5) * 0.8);
      this.decal(at, (0.2 + Math.random() * 0.5) * (0.8 + power * 0.2));
    }
  }

  /** Einzelne Tropfen (Blutung, fliegende Teile) */
  drip(p: Vector3, n = 2): void {
    if (this.goreMul <= 0) return;
    this.drops.emitter = p.clone();
    this.drops.manualEmitCount = Math.round(n * this.goreMul);
    if (Math.random() < 0.08 * this.goreMul) this.decal(new Vector3(p.x + (Math.random() - 0.5) * 0.3, 0.012 + this.next * 0.0002, p.z + (Math.random() - 0.5) * 0.3), 0.08 + Math.random() * 0.12);
  }

  /** Großer Fleck am Boden */
  splat(at: Vector3, size: number): void {
    if (this.goreMul <= 0) return;
    this.decal(new Vector3(at.x, 0.012 + this.next * 0.0002, at.z), size);
  }

  /** Blutige Wunde am Körper: glänzender Fleck an der Trefferstelle, wandert mit dem Knochen */
  wound(id: string, bone: TransformNode, contact: Vector3, size: number): void {
    if (this.goreMul <= 0) return;
    const list = this.wounds.get(id) ?? [];
    bone.computeWorldMatrix(true);
    const center = bone.getAbsolutePosition();
    const out = contact.subtract(center);
    out.y *= 0.3;
    if (out.lengthSquared() < 1e-6) out.set(0, 0, 1);
    out.normalize();
    const w = MeshBuilder.CreateSphere('wound', { diameterX: size, diameterY: size * (0.6 + Math.random() * 0.8), diameterZ: size * 0.25, segments: 6 }, this.scene);
    w.material = this.woundMat;
    w.position = center.add(out.scale(0.115 + Math.random() * 0.03)).add(new Vector3(0, (Math.random() - 0.4) * 0.25, 0));
    w.lookAt(w.position.add(out));
    w.setParent(bone);
    w.isPickable = false;
    list.push(w);
    if (list.length > 14) list.shift()!.dispose();
    this.wounds.set(id, list);
  }

  clearWounds(): void {
    for (const l of this.wounds.values()) for (const w of l) w.dispose();
    this.wounds.clear();
  }

  sparksAt(p: Vector3): void {
    this.sparks.emitter = p.clone();
    this.sparks.direction1 = new Vector3(-1, -0.2, -1);
    this.sparks.direction2 = new Vector3(1, 1.4, 1);
    this.sparks.manualEmitCount = 40;
  }

  /** Flecken im Sand: drei Formen, je eine Instanz-Gruppe (wenige Zeichenaufrufe auch bei vielen Flecken) */
  private decal(at: Vector3, size: number): void {
    const kind = this.next % 3;
    this.next++;
    if (!this.decals.length) {
      for (let i = 0; i < 3; i++) {
        const d = MeshBuilder.CreateGround('bloodDecal', { width: 1, height: 1 }, this.scene);
        d.material = this.decalMats[i];
        d.isPickable = false;
        d.receiveShadows = true;
        d.alwaysSelectAsActiveMesh = true;
        this.decals.push(d);
      }
    }
    const d = this.decals[kind];
    const m = Matrix.Compose(
      new Vector3(size * (0.8 + Math.random() * 0.6), 1, size),
      Quaternion.RotationYawPitchRoll(Math.random() * Math.PI * 2, 0, 0),
      at,
    );
    const count = d.thinInstanceCount;
    const cap = 90;
    if (count < cap) d.thinInstanceAdd(m);
    else {
      const slot = this.decalSlot[kind] % cap;
      this.decalSlot[kind]++;
      d.thinInstanceSetMatrixAt(slot, m);
    }
  }

  private decalSlot = [0, 0, 0];

  /** Neuer Kampf: Sand wieder sauber */
  clearDecals(): void {
    for (const d of this.decals) d.thinInstanceCount = 0;
    this.decalSlot = [0, 0, 0];
  }
}

/** Blutspritzer: Fleck mit unregelmäßigem Rand und Tropfen ringsum */
function splatTexture(scene: Scene, seed: number): DynamicTexture {
  const S = 128;
  const tex = new DynamicTexture('splat' + seed, { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const blob = (cx: number, cy: number, rad: number, a: number) => {
    ctx.beginPath();
    const n = 40;
    const ph = rnd() * 6;
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rr = rad * (0.82 + 0.12 * Math.sin(ang * 3 + ph) + 0.08 * Math.sin(ang * 7 + ph * 2) + rnd() * 0.06);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.shadowColor = `rgba(255,255,255,${a * 0.8})`;
    ctx.shadowBlur = 3;
    ctx.fill();
  };
  const big = seed === 3;
  blob(S / 2, S / 2, big ? S * 0.4 : S * 0.2, 0.92);
  if (!big) {
    for (let i = 0; i < 4; i++) blob(S / 2 + (rnd() - 0.5) * S * 0.3, S / 2 + (rnd() - 0.5) * S * 0.3, S * (0.07 + rnd() * 0.08), 0.85);
    // Tropfen in eine Richtung
    const dir = rnd() * Math.PI * 2;
    for (let i = 0; i < 14; i++) {
      const d = S * (0.22 + rnd() * 0.25);
      const ang = dir + (rnd() - 0.5) * 1.4;
      blob(S / 2 + Math.cos(ang) * d, S / 2 + Math.sin(ang) * d, S * (0.01 + rnd() * 0.025), 0.9);
    }
  } else {
    for (let i = 0; i < 6; i++) blob(S / 2 + (rnd() - 0.5) * S * 0.4, S / 2 + (rnd() - 0.5) * S * 0.4, S * (0.12 + rnd() * 0.1), 0.9);
  }
  tex.hasAlpha = true;
  tex.update(false);
  return tex;
}
