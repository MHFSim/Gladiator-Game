import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  type Camera,
} from '@babylonjs/core';
import type { Sound } from '../audio/sound';
import type { QualityProfile } from '../core/quality';
import type { Environment } from './environment';
import { fbm } from './textures';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export const WEATHER_NAMES: Record<WeatherKind, string> = {
  clear: 'Klar und heiß',
  cloudy: 'Bewölkt',
  rain: 'Regen',
  storm: 'Gewitter',
  fog: 'Nebel',
};

/** Wirkung im Kampf */
export interface WeatherRules {
  regenMul: number;
  rollCostMul: number;
  lockRange: number;
}

export const WEATHER_RULES: Record<WeatherKind, WeatherRules> = {
  clear: { regenMul: 0.9, rollCostMul: 1, lockRange: 9 },
  cloudy: { regenMul: 1, rollCostMul: 1, lockRange: 9 },
  rain: { regenMul: 1, rollCostMul: 1.25, lockRange: 9 },
  storm: { regenMul: 1, rollCostMul: 1.25, lockRange: 8 },
  fog: { regenMul: 1, rollCostMul: 1, lockRange: 6 },
};

interface Look {
  cover: number; // Wolkendecke 0..1
  dense: boolean;
  fog: number;
  fogTint: Color3;
  rain: number; // 0..1
  wet: boolean;
  mist: boolean;
  dust: number; // Faktor für Staub in der Luft
  gloom: number;
}

const LOOKS: Record<WeatherKind, Look> = {
  clear: { cover: 0.12, dense: false, fog: 0.0026, fogTint: new Color3(1, 0.95, 0.85), rain: 0, wet: false, mist: false, dust: 1.4, gloom: 0 },
  cloudy: { cover: 0.62, dense: true, fog: 0.0045, fogTint: new Color3(0.82, 0.83, 0.85), rain: 0, wet: false, mist: false, dust: 0.8, gloom: 0 },
  rain: { cover: 0.9, dense: true, fog: 0.011, fogTint: new Color3(0.55, 0.58, 0.62), rain: 0.7, wet: true, mist: false, dust: 0, gloom: 0.38 },
  storm: { cover: 1, dense: true, fog: 0.014, fogTint: new Color3(0.4, 0.42, 0.48), rain: 1, wet: true, mist: false, dust: 0, gloom: 0.58 },
  fog: { cover: 0.7, dense: true, fog: 0.055, fogTint: new Color3(0.8, 0.8, 0.8), rain: 0, wet: true, mist: true, dust: 0, gloom: 0.1 },
};

export function randomWeather(): WeatherKind {
  const r = Math.random();
  if (r < 0.38) return 'clear';
  if (r < 0.62) return 'cloudy';
  if (r < 0.79) return 'rain';
  if (r < 0.9) return 'fog';
  return 'storm';
}

function cloudTexture(scene: Scene, dense: boolean): DynamicTexture {
  const s = 256;
  const tex = new DynamicTexture(dense ? 'cloudsDense' : 'cloudsSparse', { width: s, height: s }, scene, true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(s, s);
  const seed = dense ? 91 : 37;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s;
      const v = y / s;
      const n = fbm(u, v, 4, 5, seed);
      const detail = fbm(u, v, 16, 3, seed + 5);
      const cov = dense ? 0.28 : 0.56;
      let a = Math.max(0, Math.min(1, (n - cov) / 0.22));
      if (dense) a = Math.min(1, 0.55 + a * 0.6);
      const shade = 0.72 + 0.28 * Math.min(1, detail * 1.4);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * shade);
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

function radialMask(scene: Scene): DynamicTexture {
  const s = 128;
  const tex = new DynamicTexture('cloudMask', { width: s, height: s }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true;
  tex.getAlphaFromRGB = false;
  tex.update(false);
  return tex;
}

function streakTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('rainStreak', { width: 8, height: 64 }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 8, 64);
  for (let x = 0; x < 8; x++) {
    const k = 1 - Math.abs(x - 3.5) / 4;
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, `rgba(235,242,255,${(0.9 * k).toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1, 64);
  }
  tex.hasAlpha = true;
  tex.update(false);
  return tex;
}

function softTexture(scene: Scene, name: string): DynamicTexture {
  const s = 64;
  const tex = new DynamicTexture(name, { width: s, height: s }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true;
  tex.update(false);
  return tex;
}

export class Weather {
  kind: WeatherKind = 'clear';
  rules: WeatherRules = WEATHER_RULES.clear;
  private cloudMat: StandardMaterial;
  private sparse: DynamicTexture | null = null;
  private dense: DynamicTexture | null = null;
  private rain: ParticleSystem | null = null;
  private splash: ParticleSystem | null = null;
  private mist: ParticleSystem | null = null;
  private puddles: Mesh[] = [];
  private wetState = new Map<PBRMaterial, { rough: number; color: Color3; env: number }>();
  private flash = 0;
  private nextBolt = 8;
  private look: Look = LOOKS.clear;
  private readonly maxRain: number;

  constructor(
    private readonly scene: Scene,
    private readonly env: Environment,
    private readonly camera: Camera,
    q: QualityProfile,
    private readonly sound: Sound,
  ) {
    this.maxRain = { ultra: 4500, high: 3500, medium: 2400, low: 1200 }[q.tier];
    // Wolkenschicht hoch über der Arena
    const plane = MeshBuilder.CreateGround('clouds', { width: 4200, height: 4200, subdivisions: 1 }, scene);
    plane.position.y = 320;
    plane.rotation.x = Math.PI; // Unterseite nach unten
    const m = new StandardMaterial('cloudMat', scene);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.fogEnabled = false;
    m.useAlphaFromDiffuseTexture = true;
    m.opacityTexture = radialMask(scene);
    m.specularColor = Color3.Black();
    plane.material = m;
    plane.isPickable = false;
    plane.applyFog = false;
    plane.infiniteDistance = true;
    plane.alphaIndex = 0;
    this.cloudMat = m;
  }

  private ensureRain(): void {
    if (this.rain) return;
    const tex = streakTexture(this.scene);
    // CPU-Partikel: auf allen Handys verlässlich, Menge nach Grafikstufe
    const ps = new ParticleSystem('rain', this.maxRain, this.scene);
    ps.particleTexture = tex;
    ps.minEmitBox = new Vector3(-11, 0, -11);
    ps.maxEmitBox = new Vector3(11, 3, 11);
    ps.direction1 = new Vector3(-0.6, -1, -0.2);
    ps.direction2 = new Vector3(-0.4, -1, 0.1);
    ps.minEmitPower = 17;
    ps.maxEmitPower = 22;
    ps.minLifeTime = 0.75;
    ps.maxLifeTime = 0.9;
    ps.minSize = 0.028;
    ps.maxSize = 0.042;
    ps.minScaleY = 14;
    ps.maxScaleY = 22;
    ps.color1 = new Color4(0.8, 0.84, 0.92, 0.6);
    ps.color2 = new Color4(0.72, 0.76, 0.84, 0.45);
    ps.colorDead = new Color4(0.7, 0.75, 0.85, 0.2);
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitter = new Vector3(0, 14, 0);
    this.rain = ps;

    const sp = new ParticleSystem('splash', 600, this.scene);
    sp.particleTexture = softTexture(this.scene, 'splashTex');
    sp.minEmitBox = new Vector3(-10, 0.02, -10);
    sp.maxEmitBox = new Vector3(10, 0.05, 10);
    sp.direction1 = new Vector3(-0.3, 1, -0.3);
    sp.direction2 = new Vector3(0.3, 1.6, 0.3);
    sp.minEmitPower = 0.6;
    sp.maxEmitPower = 1.2;
    sp.gravity = new Vector3(0, -9, 0);
    sp.minLifeTime = 0.12;
    sp.maxLifeTime = 0.22;
    sp.minSize = 0.03;
    sp.maxSize = 0.07;
    sp.color1 = new Color4(0.85, 0.9, 1, 0.45);
    sp.color2 = new Color4(0.85, 0.9, 1, 0.3);
    sp.colorDead = new Color4(1, 1, 1, 0);
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    sp.emitter = Vector3.Zero();
    this.splash = sp;

    // Pfützen spiegeln den Himmel
    const pm = new PBRMaterial('puddle', this.scene);
    pm.albedoColor = new Color3(0.06, 0.045, 0.03);
    pm.metallic = 0;
    pm.roughness = 0.1;
    pm.reflectionTexture = this.env.probe.cubeTexture;
    pm.environmentIntensity = 0.35;
    pm.alpha = 0.8;
    pm.opacityTexture = softTexture(this.scene, 'puddleMask');
    const spots: [number, number, number, number][] = [
      [-3, 2, 1.6, 0.9],
      [4.5, -1, 1.1, 0.7],
      [1, -6.5, 2.2, 1.2],
      [-7, -2, 1.3, 1.0],
      [7.5, 6, 1.8, 0.9],
      [-2.5, 8.5, 1.2, 0.8],
      [10.5, -6, 1.5, 1.1],
    ];
    for (const [x, z, a, b] of spots) {
      const d = MeshBuilder.CreateDisc('puddle', { radius: 1, tessellation: 20 }, this.scene);
      d.rotation.x = Math.PI / 2;
      d.scaling.set(a, b, 1);
      d.position.set(x, 0.012, z);
      d.material = pm;
      d.isPickable = false;
      d.receiveShadows = true;
      d.setEnabled(false);
      this.puddles.push(d);
    }
  }

  private ensureMist(): void {
    if (this.mist) return;
    const ps = new ParticleSystem('mist', 70, this.scene);
    ps.particleTexture = softTexture(this.scene, 'mistTex');
    ps.minEmitBox = new Vector3(-17, 0.2, -17);
    ps.maxEmitBox = new Vector3(17, 1.6, 17);
    ps.direction1 = new Vector3(-0.15, 0, -0.1);
    ps.direction2 = new Vector3(0.15, 0.03, 0.1);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.6;
    ps.minLifeTime = 14;
    ps.maxLifeTime = 22;
    ps.minSize = 6;
    ps.maxSize = 11;
    ps.emitRate = 4;
    ps.color1 = new Color4(0.85, 0.85, 0.86, 0.16);
    ps.color2 = new Color4(0.78, 0.8, 0.82, 0.11);
    ps.colorDead = new Color4(0.8, 0.8, 0.8, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitter = Vector3.Zero();
    ps.preWarmCycles = 300;
    ps.preWarmStepOffset = 5;
    this.mist = ps;
  }

  private setWet(on: boolean): void {
    for (const mat of this.scene.materials) {
      if (!(mat instanceof PBRMaterial) || mat.name === 'puddle' || mat.name === 'crowdMat') continue;
      if (!this.wetState.has(mat)) this.wetState.set(mat, { rough: mat.roughness ?? 0.8, color: mat.albedoColor.clone(), env: mat.environmentIntensity });
      const o = this.wetState.get(mat)!;
      if (on) {
        mat.roughness = Math.max(0.12, o.rough * (mat.metallic && mat.metallic > 0.5 ? 0.7 : 0.62));
        if (!(mat.metallic && mat.metallic > 0.5)) mat.albedoColor = o.color.scale(mat.name === 'sand' ? 0.58 : 0.74);
        mat.environmentIntensity = o.env > 0 ? o.env * 1.6 : 0;
      } else {
        mat.roughness = o.rough;
        mat.albedoColor = o.color.clone();
        mat.environmentIntensity = o.env;
      }
    }
  }

  set(kind: WeatherKind): void {
    this.kind = kind;
    this.rules = WEATHER_RULES[kind];
    const L = LOOKS[kind];
    this.look = L;
    // Wolken
    if (L.dense && !this.dense) this.dense = cloudTexture(this.scene, true);
    if (!L.dense && !this.sparse) this.sparse = cloudTexture(this.scene, false);
    const tex = (L.dense ? this.dense : this.sparse)!;
    tex.uScale = tex.vScale = 5;
    this.cloudMat.diffuseTexture = tex;
    this.cloudMat.alpha = L.dense ? Math.min(1, 0.4 + L.cover * 0.6) : 0.85;
    // Licht und Dunst
    this.env.setWeather(L.cover, L.fog, L.fogTint, L.gloom);
    // Regen
    if (L.rain > 0) {
      this.ensureRain();
      const r = this.rain!;
      r.emitRate = (this.maxRain * L.rain) / 0.85;
      r.start();
      this.splash!.emitRate = 500 * L.rain;
      this.splash!.start();
    } else if (this.rain) {
      this.rain.stop();
      this.splash!.stop();
    }
    for (const p of this.puddles) p.setEnabled(L.rain > 0);
    if (L.mist) {
      this.ensureMist();
      this.mist!.start();
    } else this.mist?.stop();
    this.setWet(L.wet);
    const dust = this.scene.getParticleSystemById?.('dust') ?? this.scene.particleSystems.find((p) => p.name === 'dust');
    if (dust) {
      if (L.dust > 0) dust.start();
      else dust.stop();
    }
    this.sound.rain(L.rain);
    this.nextBolt = 4 + Math.random() * 6;
    this.refreshCloudColor();
  }

  private refreshCloudColor(): void {
    const day = this.env.daylight;
    const L = this.look;
    const bright = (0.25 + 0.95 * day) * (1 - 0.6 * Math.max(0, L.cover - 0.3)) + this.flash * 2.5;
    const warm = this.env.sunWarmth;
    this.cloudMat.diffuseColor = new Color3(bright * (1 + warm * 0.25), bright * (1 + warm * 0.05), bright * (1 - warm * 0.15));
  }

  update(dt: number): void {
    const cam = this.camera.position;
    const tex = this.cloudMat.diffuseTexture as Texture | null;
    if (tex) tex.uOffset += dt * 0.0016;
    if (this.rain && this.look.rain > 0) {
      const fw = this.camera.getDirection(Vector3.Forward());
      (this.rain.emitter as Vector3).set(cam.x + fw.x * 6, cam.y + 12, cam.z + fw.z * 6);
      (this.splash!.emitter as Vector3).set(cam.x + fw.x * 6, 0, cam.z + fw.z * 6);
    }
    // Blitze
    if (this.kind === 'storm') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 6 + Math.random() * 10;
        this.flash = 1;
        const delay = 0.4 + Math.random() * 1.8;
        window.setTimeout(() => this.sound.thunder(1 - delay / 2.5), delay * 1000);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      const f = this.flash > 0.55 || (this.flash > 0.2 && this.flash < 0.35) ? this.flash : this.flash * 0.2;
      this.env.setFlash(f);
    }
    this.refreshCloudColor();
  }

  /** Blendung durch Blitz (für das Spiel) */
  get glare(): number {
    return this.flash;
  }
}
