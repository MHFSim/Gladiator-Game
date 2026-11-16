import { CLASSES, type ClassId } from '../data/classes';
import type { Kit } from './fighter';
import type { Stats } from './hero';

export type Slot = 'weapon' | 'shield' | 'helmet' | 'arm' | 'legs';
export const SLOTS: Slot[] = ['weapon', 'shield', 'helmet', 'arm', 'legs'];
export const SLOT_NAMES: Record<Slot, string> = {
  weapon: 'Waffe',
  shield: 'Schild',
  helmet: 'Helm',
  arm: 'Armschutz',
  legs: 'Beinschutz',
};

export type AffixKey = 'hp' | 'stamina' | 'regen' | 'speed' | 'move' | 'favor' | 'crit';
export const AFFIX_NAMES: Record<AffixKey, (v: number) => string> = {
  hp: (v) => `+${v} Leben`,
  stamina: (v) => `+${v} Ausdauer`,
  regen: (v) => `+${v} % Erholung`,
  speed: (v) => `+${v} % Angriffstempo`,
  move: (v) => `+${v} % Laufen`,
  favor: (v) => `+${v} % Gunst`,
  crit: (v) => `+${v} % Kopftreffer`,
};

export const RARITY = [
  { name: 'Gewöhnlich', color: '#b8b0a4' },
  { name: 'Gut', color: '#7fd36b' },
  { name: 'Selten', color: '#6aa8ff' },
  { name: 'Episch', color: '#c07bff' },
  { name: 'Legendär', color: '#ffc94a' },
];

export interface Item {
  id: string;
  slot: Slot;
  rarity: number;
  plus: number;
  name: string;
  affixes: { k: AffixKey; v: number }[];
}

const NAMES: Record<Slot, string[]> = {
  weapon: ['Einfache Klinge', 'Geschmiedete Klinge', 'Klinge aus Noricum-Stahl', 'Klinge des Ludus Magnus', 'Klinge des Spiculus'],
  shield: ['Einfacher Schild', 'Geschmiedeter Schild', 'Beschlagener Schild', 'Schild des Ludus Magnus', 'Schild des Priscus'],
  helmet: ['Einfacher Helm', 'Getriebener Helm', 'Helm aus korinthischer Bronze', 'Helm des Ludus Magnus', 'Helm des Flamma'],
  arm: ['Einfache Manica', 'Geschuppte Manica', 'Manica aus Kettengeflecht', 'Manica des Ludus Magnus', 'Manica des Verus'],
  legs: ['Einfache Beinschienen', 'Geschmiedete Beinschienen', 'Beinschienen aus Bronzeguss', 'Beinschienen des Ludus Magnus', 'Beinschienen des Carpophorus'],
};

function itemName(slot: Slot, rarity: number): string {
  return NAMES[slot][Math.max(0, Math.min(4, rarity))];
}

/** Hauptwert eines Gegenstands (Prozent bzw. Rüstungspunkte ×100) */
export function mainValue(it: Item): number {
  return 4 + it.rarity * 3 + it.plus * 2;
}

export function mainText(it: Item): string {
  const v = mainValue(it);
  switch (it.slot) {
    case 'weapon':
      return `+${v} % Schaden`;
    case 'shield':
      return `−${v} % Blockkosten`;
    case 'helmet':
      return `+${v} Kopfschutz`;
    case 'arm':
      return `+${v} Armschutz`;
    case 'legs':
      return `+${v} Beinschutz`;
  }
}

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

const AFFIX_RANGE: Record<AffixKey, [number, number]> = {
  hp: [4, 12],
  stamina: [4, 12],
  regen: [4, 12],
  speed: [2, 6],
  move: [2, 6],
  favor: [5, 15],
  crit: [5, 15],
};

export function makeItem(slot: Slot, rarity: number, rnd = Math.random): Item {
  const keys = Object.keys(AFFIX_RANGE) as AffixKey[];
  const affixes: Item['affixes'] = [];
  const n = Math.min(3, rarity);
  while (affixes.length < n) {
    const k = keys[Math.floor(rnd() * keys.length)];
    if (affixes.some((a) => a.k === k)) continue;
    const [lo, hi] = AFFIX_RANGE[k];
    const v = Math.round(lo + (hi - lo) * rnd() * (0.6 + rarity * 0.1));
    affixes.push({ k, v });
  }
  return { id: uid(), slot, rarity, plus: 0, name: itemName(slot, rarity), affixes };
}

export function starterItems(): Item[] {
  return SLOTS.map((s) => makeItem(s, 0));
}

/** Beute nach einem Sieg: Seltenheit hängt von der Stärke des Gegners ab */
export function rollLoot(foeLevel: number, flawless: boolean, rnd = Math.random): Item {
  const slot = SLOTS[Math.floor(rnd() * SLOTS.length)];
  const luck = foeLevel / 50 + (flawless ? 0.08 : 0);
  const r = rnd();
  let rarity = 0;
  if (r < 0.01 + luck * 0.06) rarity = 4;
  else if (r < 0.05 + luck * 0.2) rarity = 3;
  else if (r < 0.18 + luck * 0.35) rarity = 2;
  else if (r < 0.5 + luck * 0.3) rarity = 1;
  return makeItem(slot, rarity, rnd);
}

export function winDenare(foeLevel: number, pvp: boolean): number {
  return Math.round((30 + 12 * foeLevel) * (pvp ? 1.5 : 1));
}

/* ---------- Schmied ---------- */

export const MAX_PLUS = 10;

export function upgradeCost(it: Item): number {
  return Math.round(25 * Math.pow(it.plus + 1, 1.5) * (1 + it.rarity * 0.6));
}

/** Erfolgschance in Prozent */
export function upgradeChance(it: Item): number {
  const next = it.plus + 1;
  if (next <= 5) return 100;
  return [85, 70, 55, 40, 30][next - 6] ?? 30;
}

export function dismantleValue(it: Item): number {
  return Math.round(10 * Math.pow(1 + it.rarity, 2) + it.plus * 15);
}

/* ---------- Wirkung ---------- */

export type Equipped = Partial<Record<Slot, Item>>;

/** Kampfpaket aus Klasse und Ausrüstung */
export function kitFor(cls: ClassId, eq: Equipped): Kit {
  const base = CLASSES[cls].kit;
  const k: Kit = { ...base, armor: { ...base.armor } };
  const pct = (s: Slot) => (eq[s] ? mainValue(eq[s]!) / 100 : 0);
  k.damage *= 1 + pct('weapon');
  k.blockCost *= 1 - Math.min(0.6, pct('shield'));
  const cap = (v: number) => Math.min(0.75, v);
  if (eq.helmet && CLASSES[cls].helmet !== 'none') k.armor.head = cap(k.armor.head + pct('helmet') * 0.6);
  if (eq.arm) k.armor.arm = cap(k.armor.arm + pct('arm') * 0.6);
  if (eq.legs) k.armor.leg = cap(k.armor.leg + pct('legs') * 0.6);
  for (const it of Object.values(eq)) {
    for (const a of it?.affixes ?? []) {
      if (a.k === 'speed') k.speed *= 1 + a.v / 100;
      if (a.k === 'move') k.move *= 1 + a.v / 100;
    }
  }
  return k;
}

/** Werte aus Attributen um die Boni der Ausrüstung ergänzen */
export function applyItemStats(st: Stats, eq: Equipped): Stats {
  const s = { ...st };
  for (const it of Object.values(eq)) {
    for (const a of it?.affixes ?? []) {
      if (a.k === 'hp') s.hpMax += a.v;
      if (a.k === 'stamina') s.staminaMax += a.v;
      if (a.k === 'regen') s.staminaRegen *= 1 + a.v / 100;
      if (a.k === 'crit') s.headMul *= 1 + a.v / 100;
      if (a.k === 'favor') s.gloriaMul *= 1 + a.v / 100;
    }
  }
  return s;
}

/** Seltenheit je Platz für das Aussehen */
export function tiersOf(eq: Equipped): [number, number, number, number, number] {
  return SLOTS.map((s) => eq[s]?.rarity ?? 0) as [number, number, number, number, number];
}

/** Gegenstände eines KI-Gegners nach Stufe */
export function aiEquipment(level: number, rnd = Math.random): Equipped {
  const eq: Equipped = {};
  for (const s of SLOTS) {
    const r = Math.min(4, Math.max(0, Math.floor(level / 11 + rnd() * 0.9)));
    const it = makeItem(s, r, rnd);
    it.plus = Math.min(MAX_PLUS, Math.floor(level / 6));
    eq[s] = it;
  }
  return eq;
}

/** Gültigkeit beim Laden prüfen */
export function validItem(o: unknown): o is Item {
  const it = o as Item;
  return (
    !!it &&
    typeof it.id === 'string' &&
    SLOTS.includes(it.slot) &&
    Number.isInteger(it.rarity) &&
    it.rarity >= 0 &&
    it.rarity <= 4 &&
    Number.isInteger(it.plus) &&
    it.plus >= 0 &&
    it.plus <= MAX_PLUS &&
    Array.isArray(it.affixes) &&
    it.affixes.length <= 3
  );
}
