import type { MatchResult } from '../game/game';
import { addXp, saveHero, winReward, xpForNext, MAX_ITEMS, POINTS_PER_LEVEL, type Hero } from '../game/hero';
import { dismantleValue, mainText, RARITY, rollLoot, winDenare } from '../game/items';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Ergebnis nach einem Kampf: Erfahrung nur bei Sieg */
export class Results {
  open = false;

  constructor(
    private readonly hero: () => Hero,
    private readonly actions: { again: () => void; hero: () => void; home: () => void; leave: () => void },
  ) {}

  show(r: MatchResult, role: 'solo' | 'host' | 'guest'): void {
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
    $('r-sub').textContent = `${r.wins} : ${r.losses} gegen ${r.foe.name} (Stufe ${r.foe.level}) · ${fate}`;
    const lines = $('r-lines');
    let gained = 0;
    let levels = 0;
    if (r.won) {
      const rw = winReward(h.level, r.foe.level, r.parries, r.losses === 0, r.pvp);
      gained = rw.total;
      const parts = [`Sieg +${rw.base}`];
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
      lines.innerHTML = 'Keine Erfahrung – nur Siege bringen Ruhm.';
      h.losses++;
    }
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
    again.textContent = 'Nächster Kampf';
    again.onclick = () => {
      this.hide();
      this.actions.again();
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
