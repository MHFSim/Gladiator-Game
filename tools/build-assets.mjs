// Baut die Spiel-Assets aus den Quaternius-Paketen (CC0).
// Aufruf: node tools/build-assets.mjs <Ordner mit den entpackten Paketen>
// Ergebnis: public/assets/gladiator.glb, public/assets/anims.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Bitte Ordner mit den entpackten Quaternius-Paketen angeben.');
  process.exit(1);
}
const outDir = path.resolve('public/assets');
fs.mkdirSync(outDir, { recursive: true });

// Rekursiv eine Datei per Name finden
function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = find(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// Animationen, die das Spiel braucht (Name in der Bibliothek -> Name im Spiel)
const KEEP = {
  Idle_Loop: 'idle',
  Walk_Loop: 'walk',
  Jog_Fwd_Loop: 'jog',
  Sprint_Loop: 'sprint',
  Roll: 'roll',
  Death01: 'death',
  Hit_Chest: 'hit_chest',
  Hit_Head: 'hit_head',
  Sword_Idle: 'sword_idle',
  Sword_Attack: 'sword_attack',
  Punch_Cross: 'punch',
  Idle_Shield_Loop: 'shield_idle',
  Idle_Shield_Break: 'shield_break',
  Shield_OneShot: 'shield_bash',
  Shield_Dash: 'shield_dash',
  Sword_Block: 'block',
  Sword_Regular_A: 'light_a',
  Sword_Regular_A_Rec: 'light_a_rec',
  Sword_Regular_B: 'light_b',
  Sword_Regular_B_Rec: 'light_b_rec',
  Sword_Regular_C: 'light_c',
  Sword_Heavy_Combo: 'heavy',
  Sword_Dash: 'sword_dash',
  Hit_Knockback: 'knockback',
  OverhandThrow: 'throw',
  Melee_Hook: 'hook',
  Melee_Hook_Rec: 'hook_rec',
  LayToIdle: 'get_up',
  Yes: 'cheer',
};

async function buildAnims() {
  const files = ['UAL1_Standard.glb', 'UAL2_Standard.glb'].map((n) => find(src, n));
  if (files.some((f) => !f)) throw new Error('UAL1_Standard.glb / UAL2_Standard.glb nicht gefunden');
  const outs = [];
  for (const [i, file] of files.entries()) {
    const doc = await io.read(file);
    const root = doc.getRoot();
    for (const a of root.listAnimations()) {
      const name = KEEP[a.getName()];
      if (name) a.setName(name);
      else a.dispose();
    }
    // Mesh und Skin entfernen, nur Knochen-Knoten + Animationen behalten
    for (const n of root.listNodes()) {
      n.setMesh(null);
      n.setSkin(null);
    }
    for (const s of root.listSkins()) s.dispose();
    // Kanäle auf "_leaf"-Endknochen sind wirkungslos -> entfernen
    for (const a of root.listAnimations()) {
      for (const ch of a.listChannels()) {
        const n = ch.getTargetNode();
        if (n && n.getName().includes('_leaf')) {
          ch.getSampler()?.dispose();
          ch.dispose();
        }
      }
    }
    await doc.transform(
      resample({ tolerance: 2e-4 }),
      prune({ keepLeaves: true }),
      dedup(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = path.join(outDir, `anims${i + 1}.glb`);
    await io.write(out, doc);
    outs.push(out);
    console.log('Animationen:', path.basename(out), (fs.statSync(out).size / 1e6).toFixed(2), 'MB',
      root.listAnimations().map((a) => a.getName()).join(', '));
  }
  return outs;
}

async function buildCharacter() {
  const gltf = find(src, 'Superhero_Male_FullBody.gltf');
  if (!gltf) throw new Error('Superhero_Male_FullBody.gltf nicht gefunden');
  // Paket verweist auf zwei falsch benannte Texturen -> in temporären Ordner kopieren und reparieren
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'char-'));
  const dir = path.dirname(gltf);
  for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
  const fixes = { 'T_Hair_1_Normal_png.png': 'T_Hair_1_Normal.png', 'T_Eye_Normal_png.png': 'T_Eye_Normal.png' };
  for (const [want, have] of Object.entries(fixes)) {
    if (!fs.existsSync(path.join(tmp, want))) fs.copyFileSync(path.join(tmp, have), path.join(tmp, want));
  }
  // Helle Hautvariante bevorzugen, falls vorhanden
  const light = find(src, 'T_Superhero_Male_Ligh.png');
  const doc = await io.read(path.join(tmp, 'Superhero_Male_FullBody.gltf'));
  if (light) {
    for (const t of doc.getRoot().listTextures()) {
      if (t.getURI() === 'T_Superhero_Male_Dark.png') {
        t.setImage(fs.readFileSync(light));
        t.setURI('T_Superhero_Male_Light.png');
      }
    }
  }
  await doc.transform(
    weld(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(outDir, 'gladiator.glb');
  await io.write(out, doc);
  console.log('Figur:', path.basename(out), (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
  fs.rmSync(tmp, { recursive: true, force: true });
}

await MeshoptEncoder.ready;
await buildCharacter();
await buildAnims();

// Meshopt-Decoder (MIT) lokal bereitstellen, damit kein CDN nötig ist
const vendor = path.resolve('public/vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.resolve('node_modules/meshoptimizer/meshopt_decoder.cjs'), path.join(vendor, 'meshopt_decoder.js'));
console.log('Decoder kopiert: public/vendor/meshopt_decoder.js');
