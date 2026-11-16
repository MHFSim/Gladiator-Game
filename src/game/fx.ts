import { Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, PBRMaterial, Scene, Vector3, Color3 } from '@babylonjs/core';
import { flareTexture } from '../render/textures';

/** Treffer-Effekte: Blut, Funken, Blutflecken im Sand */
export class Fx {
  private blood: ParticleSystem;
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
  pool(at: Vector3): void {
    const d = MeshBuilder.CreateGround('bloodPool', { width: 1, height: 1 }, this.scene);
    d.material = this.decalMats[3];
    d.isPickable = false;
    d.receiveShadows = true;
    d.position.set(at.x, 0.014, at.z);
    d.rotation.y = Math.random() * Math.PI * 2;
    d.scaling.set(0.05, 1, 0.05);
    this.pools.push({ m: d, t: 0, max: 1.3 + Math.random() * 0.5 });
    if (this.pools.length > 6) this.pools.shift()!.m.dispose();
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

  bloodAt(p: Vector3, dir: Vector3): void {
    const b = this.blood;
    b.emitter = p.clone();
    b.direction1 = dir.add(new Vector3(-0.6, 0.6, -0.6));
    b.direction2 = dir.add(new Vector3(0.6, 1.2, 0.6));
    b.manualEmitCount = 45;
    // Flecken im Sand bleiben liegen
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const at = new Vector3(p.x + dir.x * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.5, 0.012 + this.next * 0.0002, p.z + dir.z * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.5);
      this.decal(at, 0.25 + Math.random() * 0.45);
    }
  }

  sparksAt(p: Vector3): void {
    this.sparks.emitter = p.clone();
    this.sparks.direction1 = new Vector3(-1, -0.2, -1);
    this.sparks.direction2 = new Vector3(1, 1.4, 1);
    this.sparks.manualEmitCount = 40;
  }

  private decal(at: Vector3, size: number): void {
    let d: Mesh;
    if (this.decals.length < 70) {
      d = MeshBuilder.CreateGround('bloodDecal', { width: 1, height: 1 }, this.scene);
      d.material = this.decalMats[this.decals.length % 3];
      d.isPickable = false;
      d.receiveShadows = true;
      this.decals.push(d);
    } else {
      d = this.decals[this.next % this.decals.length];
    }
    this.next++;
    d.position.copyFrom(at);
    d.rotation.y = Math.random() * Math.PI * 2;
    d.scaling.set(size * (0.8 + Math.random() * 0.6), 1, size);
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
