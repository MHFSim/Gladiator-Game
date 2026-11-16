import type { Kit } from '../game/fighter';

export type ClassId = 'murmillo' | 'secutor' | 'thraex' | 'hoplomachus' | 'retiarius' | 'provocator';

export type SpecialId = 'ram' | 'pursuit' | 'hook' | 'javelin' | 'net' | 'challenge';

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  desc: string;
  special: { id: SpecialId; name: string; desc: string; cooldown: number };
  kit: Kit;
  /** klassische Gegner (Publikum mag die Paarung) */
  rivals: ClassId[];
  weapon: 'gladius' | 'sica' | 'spear' | 'trident';
  shield: 'scutum' | 'parmula' | 'parma' | 'none';
  helmet: 'murmillo' | 'secutor' | 'thraex' | 'hoplomachus' | 'provocator' | 'none';
}

export const CLASSES: Record<ClassId, ClassDef> = {
  murmillo: {
    id: 'murmillo',
    name: 'Murmillo',
    role: 'Schwerer Kämpfer',
    desc: 'Großer Schild, Gladius, Kammhelm. Hält viel aus, blockt günstig, ist aber träge.',
    special: { id: 'ram', name: 'Schildramme', desc: 'Sturmlauf mit dem Schild: stößt den Gegner um und bricht jede Deckung.', cooldown: 11 },
    kit: { reach: 2.35, damage: 1.0, speed: 0.95, blockCost: 0.72, armor: { head: 0.3, body: 0, arm: 0.35, leg: 0.35 }, move: 0.95, roll: 0.85, hasShield: true },
    rivals: ['thraex', 'hoplomachus'],
    weapon: 'gladius',
    shield: 'scutum',
    helmet: 'murmillo',
  },
  secutor: {
    id: 'secutor',
    name: 'Secutor',
    role: 'Verfolger',
    desc: 'Glatter Rundhelm, großer Schild, Gladius. Ausgewogen und ausdauernd.',
    special: { id: 'pursuit', name: 'Verfolgung', desc: '4 Sekunden schneller laufen, Ausdauer erholt sich doppelt so schnell.', cooldown: 12 },
    kit: { reach: 2.35, damage: 1.0, speed: 1.0, blockCost: 0.8, armor: { head: 0.42, body: 0, arm: 0.35, leg: 0.35 }, move: 1.04, roll: 0.9, hasShield: true },
    rivals: ['retiarius'],
    weapon: 'gladius',
    shield: 'scutum',
    helmet: 'secutor',
  },
  thraex: {
    id: 'thraex',
    name: 'Thraex',
    role: 'Angreifer',
    desc: 'Kleiner Schild, gebogene Sica, Greifenhelm. Schnelle, harte Schläge, schwacher Block.',
    special: { id: 'hook', name: 'Hakenschlag', desc: 'Der nächste Schlag greift um den Schild herum und kann nicht geblockt werden.', cooldown: 10 },
    kit: { reach: 2.2, damage: 1.06, speed: 1.12, blockCost: 1.15, armor: { head: 0.3, body: 0, arm: 0.35, leg: 0.45 }, move: 1.07, roll: 1.1, hasShield: true },
    rivals: ['murmillo', 'hoplomachus'],
    weapon: 'sica',
    shield: 'parmula',
    helmet: 'thraex',
  },
  hoplomachus: {
    id: 'hoplomachus',
    name: 'Hoplomachus',
    role: 'Reichweite',
    desc: 'Speer und Rundschild. Trifft aus größerer Entfernung, im Gedränge etwas langsamer.',
    special: { id: 'javelin', name: 'Speerwurf', desc: 'Wirft einen Wurfspeer auf den Gegner. Blocken oder ausweichen hilft.', cooldown: 12 },
    kit: { reach: 2.9, damage: 0.95, speed: 0.95, blockCost: 1.05, armor: { head: 0.3, body: 0, arm: 0.3, leg: 0.42 }, move: 1.0, roll: 1.0, hasShield: true },
    rivals: ['murmillo', 'thraex'],
    weapon: 'spear',
    shield: 'parma',
    helmet: 'hoplomachus',
  },
  retiarius: {
    id: 'retiarius',
    name: 'Retiarius',
    role: 'Netzkämpfer',
    desc: 'Dreizack und Netz, kein Helm, kein Schild. Sehr schnell und weit, aber kaum geschützt.',
    special: { id: 'net', name: 'Netzwurf', desc: 'Wirft das Netz: Ein getroffener Gegner ist 1,6 Sekunden gefangen.', cooldown: 14 },
    kit: { reach: 3.0, damage: 0.95, speed: 1.1, blockCost: 1.6, armor: { head: 0, body: 0, arm: 0.42, leg: 0.05 }, move: 1.14, roll: 1.25, hasShield: false },
    rivals: ['secutor'],
    weapon: 'trident',
    shield: 'none',
    helmet: 'none',
  },
  provocator: {
    id: 'provocator',
    name: 'Provocator',
    role: 'Allrounder',
    desc: 'Brustpanzer, Rechteckschild, Gladius. Keine Schwäche, keine besondere Stärke.',
    special: { id: 'challenge', name: 'Herausforderung', desc: '6 Sekunden: beide Kämpfer machen 30 % mehr Schaden, das Publikum jubelt doppelt.', cooldown: 15 },
    kit: { reach: 2.35, damage: 1.0, speed: 1.0, blockCost: 0.9, armor: { head: 0.3, body: 0.22, arm: 0.3, leg: 0.35 }, move: 1.0, roll: 0.95, hasShield: true },
    rivals: ['provocator'],
    weapon: 'gladius',
    shield: 'scutum',
    helmet: 'provocator',
  },
};

export const CLASS_ORDER: ClassId[] = ['murmillo', 'secutor', 'thraex', 'hoplomachus', 'retiarius', 'provocator'];
