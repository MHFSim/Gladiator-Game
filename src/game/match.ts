import type { ClassId } from '../data/classes';
import type { Team } from '../gladiators/gear';
import type { Kit } from './fighter';
import type { FighterInfo, Stats } from './hero';

export type MatchMode = 'duel' | 'team2' | 'team3' | 'melee4' | 'melee8';

export const MODE_NAMES: Record<MatchMode, string> = {
  duel: 'Duell',
  team2: '2 gegen 2',
  team3: '3 gegen 3',
  melee4: 'Jeder gegen jeden (4)',
  melee8: 'Jeder gegen jeden (8)',
};

/** Anzahl der Kämpfer je Modus */
export const MODE_SIZE: Record<MatchMode, number> = { duel: 2, team2: 4, team3: 6, melee4: 4, melee8: 8 };

export function isTeamMode(m: MatchMode): boolean {
  return m === 'team2' || m === 'team3';
}

export function isMelee(m: MatchMode): boolean {
  return m === 'melee4' || m === 'melee8';
}

/** Ein Kämpfer im Match. owner: 'local' (dieses Handy), 'ai' oder die ID eines Gast-Handys */
export interface FighterSetup {
  cls: ClassId;
  kit: Kit;
  tiers: [number, number, number, number, number];
  stats: Stats;
  info: FighterInfo;
  team: number;
  owner: string;
  /** KI-Stufe 0..4 (nur bei owner 'ai') */
  ai?: number;
}

export interface MatchSetup {
  mode: MatchMode;
  fighters: FighterSetup[];
  weather?: string;
  time?: number;
  arena?: 'capua' | 'colosseum';
  /** Fallen, Ereignisse und Bestien */
  life?: boolean;
}

/** Farben je Team (im Jeder-gegen-jeden hat jeder sein eigenes Team) */
export const TEAM_COLORS: Team[] = [
  { field: '#8e1c16', emblem: '#e2b65a', plume: [170, 24, 20] },
  { field: '#1d3f78', emblem: '#d9c27a', plume: [235, 230, 215] },
  { field: '#2f5a24', emblem: '#e6d48a', plume: [60, 120, 40] },
  { field: '#4b1f5e', emblem: '#e2b65a', plume: [120, 40, 140] },
  { field: '#1c1c1c', emblem: '#c9c9c9', plume: [30, 30, 30] },
  { field: '#a8681c', emblem: '#2a1a0a', plume: [220, 150, 40] },
  { field: '#d8d0bc', emblem: '#8e1c16', plume: [250, 250, 245] },
  { field: '#1d6a6a', emblem: '#f0e0b0', plume: [40, 150, 150] },
];

export const TEAM_NAMES = ['Rot', 'Blau', 'Grün', 'Purpur', 'Schwarz', 'Ocker', 'Weiß', 'Türkis'];

/** Startplätze: [x, z, Blickrichtung] */
export function spawnPoints(mode: MatchMode, fighters: FighterSetup[]): [number, number, number][] {
  if (mode === 'duel') {
    return fighters.map((f) => (f.team === 0 ? [0, -3.2, 0] : [0, 3.2, Math.PI]));
  }
  if (isTeamMode(mode)) {
    const counts = [0, 0];
    const per = [fighters.filter((f) => f.team === 0).length, fighters.filter((f) => f.team === 1).length];
    return fighters.map((f) => {
      const i = counts[f.team]++;
      const x = (i - (per[f.team] - 1) / 2) * 2.3;
      return f.team === 0 ? [x, -4.5, 0] : [-x, 4.5, Math.PI];
    });
  }
  const n = fighters.length;
  const r = n > 4 ? 6.5 : 5;
  return fighters.map((_, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    return [x, z, Math.atan2(-x, -z)];
  });
}

/** Teams verteilen: Menschen abwechselnd auf beide Teams (Team-Modus), sonst jeder ein Team */
export function assignTeams(mode: MatchMode, humans: number): number[] {
  const size = MODE_SIZE[mode];
  const teams: number[] = [];
  for (let i = 0; i < size; i++) {
    if (mode === 'duel') teams.push(i);
    else if (isTeamMode(mode)) teams.push(i < humans ? i % 2 : 0);
    else teams.push(i);
  }
  if (isTeamMode(mode)) {
    // KI-Plätze auffüllen, bis beide Teams gleich groß sind
    const half = size / 2;
    const c = [0, 0];
    for (let i = 0; i < humans; i++) c[teams[i]]++;
    for (let i = humans; i < size; i++) {
      const t = c[0] < half ? 0 : 1;
      teams[i] = t;
      c[t]++;
    }
  }
  return teams;
}
