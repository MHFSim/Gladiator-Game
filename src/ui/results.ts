import type { MatchResult } from '../game/game';
import { MODE_NAMES, VENATIO_WAVES } from '../game/match';
import { glicko2, rankTitle } from '../game/rating';
import { addXp, saveHero, winReward, xpForNext, MAX_ITEMS, POINTS_PER_LEVEL, type Hero } from '../game/hero';
import { dismantleValue, mainText, RARITY, rollLoot, winDenare } from '../game/items';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Zusatz zum Ergebnis (Turnier): eigene Zeile, eigener Knopf */
export interface ResultExtra {
  apply(h: Hero): string;
  againLabel: string;
  onAgain(): void;
}

/** Ergebnis nach einem Kampf: Erfahrung nur bei Sieg */
export class Results {
  open = false;

  constructor(
    private readonly hero: () => Hero,
    private readonly actions: { again: () => void; hero: () => void; home: () => void; leave: () => void },
  ) {}

  show(r: MatchResult, role: 'solo' | 'host' | 'guest', extra?: ResultExtra): void {
    const h = this.hero();
    const before = { level: h.level, xp: h.xp };
    const title = $('r-title');
    title.textContent = r.won ? 'VICTORIA' : 'NIEDERLAGE';
    title.classList.toggle('lost', !r.won);
    const fate = r.won
      ? r.verdict === 'missio'
        ? 'Der Kaiser schenkte deinem Gegner das Leben.'
        : 'Iugula! Du hast den Todesstoß gesetzt.'
      : r.verdict === 'missio'
        ? 'Der Kaiser schenkte dir das Leben.'
        : 'Der Kaiser verlangte deinen Tod – im Ludus flickt man dich wieder zusammen.';
    const group = r.mode !== 'duel';
    const ven = r.mode === 'venatio';
    const killText = ven ? (r.kills === 1 ? '1 Bestie erlegt' : `${r.kills} Bestien erlegt`) : r.kills === 1 ? '1 Gegner getötet' : `${r.kills} Gegner getötet`;
    $('r-sub').textContent = ven
      ? `Venatio · ${r.wave ?? 0} von ${VENATIO_WAVES} Wellen überstanden · ${killText}`
      : group
        ? `${MODE_NAMES[r.mode]} · ${r.enemies} Gegner (Ø Stufe ${r.foe.level}) · ${killText}`
        : `${r.wins} : ${r.losses} gegen ${r.foe.name} (Stufe ${r.foe.level}) · ${fate}`;
    if (ven) h.venatio = Math.max(h.venatio, r.wave ?? 0);
    const lines = $('r-lines');
    let gained = 0;
    let levels = 0;
    if (r.won) {
      const rw = winReward(h.level, r.foe.level, r.parries, !group && r.losses === 0, r.pvp);
      // Gruppenkampf: jede Tötung bringt zusätzlich Ruhm
      const killXp = group ? Math.round(r.kills * rw.base * (ven ? 0.08 : 0.25)) : 0;
      gained = rw.total + killXp;
      const parts = [`Sieg +${rw.base}`];
      if (killXp) parts.push(`${ven ? 'Bestien' : 'Tötungen'} ×${r.kills} +${killXp}`);
      if (rw.parries) parts.push(`Paraden ×${Math.min(10, r.parries)} +${rw.parries}`);
      if (rw.flawless) parts.push(`Makellos ${r.wins}:0 +${rw.flawless}`);
      levels = addXp(h, gained).levelsGained;
      h.wins++;
      // Denare und Beute (nur für Siege)
      const den = winDenare(r.foe.level, r.pvp);
      h.denare += den;
      const loot = rollLoot(r.foe.level, r.losses === 0);
      h.items.push(loot);
      if (h.items.length > MAX_ITEMS) {
        const worn = new Set(Object.values(h.equipped));
        const spare = h.items.filter((i) => !worn.has(i.id) && i !== loot).sort((a, b) => a.rarity - b.rarity || a.plus - b.plus)[0];
        if (spare) {
          h.denare += dismantleValue(spare);
          h.items = h.items.filter((i) => i !== spare);
        }
      }
      lines.innerHTML = `${parts.join(' · ')}<br><b>+${gained} Erfahrung</b> · <b>+${den} Denare</b><br><span class="loot">Beute: <span style="color:${RARITY[loot.rarity].color}">${loot.name}</span> (${RARITY[loot.rarity].name}, ${mainText(loot)})</span>`;
    } else {
      lines.innerHTML = group && r.kills > 0 ? `${killText}, doch der Sieg ging an andere. Keine Erfahrung – nur Siege bringen Ruhm.` : 'Keine Erfahrung – nur Siege bringen Ruhm.';
      h.losses++;
    }
    // Hausrangliste: nur Duelle gegen Menschen
    let rankLine = '';
    if (r.pvp && r.mode === 'duel' && typeof r.foe.rating === 'number') {
      const before = Math.round(h.rating.r);
      h.rating = glicko2(h.rating, { r: r.foe.rating, rd: r.foe.rd ?? 200 }, r.won ? 1 : 0);
      const after = Math.round(h.rating.r);
      let rv = h.rivals.find((x) => x.name === r.foe.name);
      if (!rv) {
        rv = { name: r.foe.name, r: r.foe.rating, rd: r.foe.rd ?? 200, w: 0, l: 0, last: 0 };
        h.rivals.push(rv);
      }
      rv.r = r.foe.rating;
      rv.rd = r.foe.rd ?? rv.rd;
      rv.last = Date.now();
      if (r.won) rv.w++;
      else rv.l++;
      h.rivals = h.rivals.sort((a, b) => b.last - a.last).slice(0, 50);
      rankLine = `<br>Hausrangliste: ${before} → <b>${after}</b> (${rankTitle(after)})`;
    }
    // Turnier und andere Zusätze
    const extraLine = extra ? extra.apply(h) : '';
    lines.innerHTML += rankLine + (extraLine ? `<br><span class="loot">${extraLine}</span>` : '');
    saveHero(h);

    // Balken: erst alter Stand, dann füllen
    const bar = $('r-xp');
    const lvl = $('r-level');
    bar.style.transition = 'none';
    bar.style.width = `${(100 * before.xp) / xpForNext(before.level)}%`;
    lvl.textContent = `Stufe ${before.level}`;
    $('r-levelup').textContent = '';
    void bar.offsetWidth;
    bar.style.transition = '';
    window.setTimeout(() => {
      if (levels > 0) {
        bar.style.width = '100%';
        window.setTimeout(() => {
          bar.style.transition = 'none';
          bar.style.width = '0%';
          void bar.offsetWidth;
          bar.style.transition = '';
          lvl.textContent = `Stufe ${h.level}`;
          bar.style.width = `${(100 * h.xp) / xpForNext(h.level)}%`;
          const pts = levels * POINTS_PER_LEVEL;
          $('r-levelup').textContent = `Stufe ${h.level} erreicht! +${pts} Attributpunkte`;
        }, 950);
      } else bar.style.width = `${(100 * h.xp) / xpForNext(h.level)}%`;
    }, 350);

    const again = $('r-again');
    const heroBtn = $('r-hero');
    const home = $('r-home');
    again.hidden = role === 'guest';
    heroBtn.hidden = role !== 'solo';
    home.textContent = role === 'solo' ? 'Ludus' : 'Arena verlassen';
    again.textContent = extra?.againLabel ?? 'Nächster Kampf';
    again.onclick = () => {
      this.hide();
      if (extra) extra.onAgain();
      else this.actions.again();
    };
    heroBtn.onclick = () => {
      this.hide();
      this.actions.hero();
    };
    home.onclick = () => {
      this.hide();
      if (role === 'solo') this.actions.home();
      else this.actions.leave();
    };
    if (role === 'guest' && !levels) $('r-levelup').textContent = 'Warte auf den Gastgeber …';
    $('result').hidden = false;
    $('hud').hidden = true;
    this.open = true;
  }

  hide(): void {
    $('result').hidden = true;
    $('hud').hidden = false;
    this.open = false;
  }
}
