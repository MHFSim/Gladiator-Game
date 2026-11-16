// Testet Venatio (Wellen) und Turnier (drei Duelle) im Training.
// Aufruf: node tools/mode-test.mjs <url> <ausgabe-ordner> [venatio|tourney]
import puppeteer from 'puppeteer-core';

const [url = 'http://localhost:4173/?quality=low&weather=clear', dir = '/tmp', which = 'venatio'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const waitGame = async (sec) => {
  const t0 = await G(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 300000, polling: 100 }, t0 + sec);
};
await G(() => document.getElementById('m-train').click());
await G((m) => document.querySelector(`#train-mode button[data-mode=${m}]`).click(), which);
console.log('Info:', await page.$eval('#train-info', (e) => e.textContent));
await page.screenshot({ path: `${dir}/mode_menu.png` });
await G(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
const result = async () => {
  await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 200000, polling: 200 });
  return G(() => ({ t: document.getElementById('r-title').textContent, s: document.getElementById('r-sub').textContent, l: document.getElementById('r-lines').textContent, a: document.getElementById('r-again').textContent }));
};

if (which === 'venatio') {
  console.log('Kämpfer:', await G(() => __game.fighters.map((f) => [f.info.name, f.team, f.owner])));
  await G(() => __game.fighters.forEach((f) => (f.g.hp = 5000)));
  for (let w = 1; w <= 5; w++) {
    await page.waitForFunction((n) => __game.life.wave >= n && __game.life.beasts.some((b) => b.alive), { timeout: 200000, polling: 200 }, w);
    const info = await G(() => [document.getElementById('score').textContent, __game.life.beasts.map((b) => b.kind + ':' + b.hpMax).join(' ')]);
    console.log('Welle', w, info);
    if (w === 2) {
      await waitGame(5);
      await page.screenshot({ path: `${dir}/venatio.png` });
    }
    await G(() => {
      for (const b of __game.life.beasts) if (b.alive) __game.life.damage(b, 9999, b.pos.scale(-1), true, __game.player);
    });
  }
  const r = await result();
  console.log('Ergebnis:', JSON.stringify(r));
  console.log(r.t === 'VICTORIA' ? 'OK  Venatio gewonnen' : 'FEHLER');
} else {
  for (let round = 0; round < 3; round++) {
    await waitGame(1);
    const foe = await G(() => __game.foe.info.name + ' ' + __game.foe.info.level);
    console.log('Runde', round, 'gegen', foe);
    for (let k = 0; k < 2; k++) {
      await page.waitForFunction(() => __game.foe.mode !== 'dead' && __game.foe.mode !== 'stagger', { timeout: 60000, polling: 200 });
      await G(() => {
        const me = __game.player;
        __game.kill(__game.foe, __game.foe.pos.subtract(me.pos).normalize(), null, me);
      });
      await waitGame(k === 0 ? 5 : 1);
    }
    const r = await result();
    console.log('Ergebnis:', JSON.stringify(r));
    if (round < 2) await G(() => document.getElementById('r-again').click());
  }
  console.log('Turniersiege:', await G(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('hero')))).tourneys));
}
console.log(logs.slice(0, 10).join('\n'));
await browser.close();
