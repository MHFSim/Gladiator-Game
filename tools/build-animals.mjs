// Baut die Tiere für die Venatio aus Quaternius „Ultimate Animated Animals“ (CC0).
// Aufruf: node tools/build-animals.mjs <Ordner mit glTF/Wolf.gltf und glTF/Bull.gltf>
// Ergebnis: public/assets/wolf.glb, public/assets/bull.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Bitte Ordner des Tierpakets angeben.');
  process.exit(1);
}
const KEEP = {
  Wolf: ['Attack', 'Death', 'Gallop', 'Idle', 'Idle_HitReact_Left', 'Walk', 'Idle_2_HeadLow'],
  Bull: ['Attack_Headbutt', 'Death', 'Gallop', 'Idle', 'Idle_Headlow', 'Idle_HitReact_Left', 'Walk'],
};
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const [name, keep] of Object.entries(KEEP)) {
  const doc = await io.read(path.join(src, 'glTF', `${name}.gltf`));
  for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  await doc.transform(prune(), dedup(), weld(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.resolve('public/assets', `${name.toLowerCase()}.glb`);
  await io.write(out, doc);
  console.log(out, doc.getRoot().listAnimations().map((a) => a.getName()).join(', '));
}
