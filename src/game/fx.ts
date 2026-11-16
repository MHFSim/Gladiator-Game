import { Color4, Mesh, MeshBuilder, ParticleSystem, Scene, StandardMaterial, Vector3, Color3 } from '@babylonjs/core';
import { flareTexture } from '../render/textures';

/** Treffer-Effekte: Blut, Funken, Blutflecken im Sand */
export class Fx {
  private blood: ParticleSystem;
  private sparks: ParticleSystem;
  private decals: Mesh[] = [];
  private decalMat: StandardMaterial;
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

    this.decalMat = new StandardMaterial('bloodDecal', scene);
    this.decalMat.diffuseTexture = flareTexture(scene, 'bloodD', 'rgba(70,4,4,0.95)', 'rgba(60,2,2,0.7)');
    this.decalMat.diffuseTexture.hasAlpha = true;
    this.decalMat.useAlphaFromDiffuseTexture = true;
    this.decalMat.specularColor = new Color3(0.2, 0.05, 0.05);
    this.decalMat.zOffset = -2;
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
      d.material = this.decalMat;
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
