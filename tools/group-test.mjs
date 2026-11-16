// Testet Gruppenkämpfe im Training: 2 gegen 2 und Jeder gegen jeden.
// Aufruf: node tools/group-test.mjs <url> <ausgabe-ordner> [modus]
import puppeteer from 'puppeteer-core';

const [url = 'http://localhost:4173/?quality=low&weather=clear', dir = '/tmp', mode = 'team2'] = process.argv.slice(2);
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
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate((m) => document.querySelector(`#train-mode button[data-mode=${m}]`).click(), mode);
console.log('Info:', await page.$eval('#train-info', (e) => e.textContent));
await page.evaluate(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const waitGame = async (sec) => {
  const t0 = await G(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 240000, polling: 100 }, t0 + sec);
};
const state = () =>
  G(() =>
    __game.fighters.map((f) => ({ n: f.info.name, t: f.team, o: f.owner, c: f.cls, hp: Math.round(f.g.hp), m: f.mode, tg: f.target ? __game.fighters.indexOf(f.target) : -1, p: [+f.pos.x.toFixed(1), +f.pos.z.toFixed(1)] })),
  );
console.log('Start:', JSON.stringify(await state()));
console.log('Anzeige:', await G(() => document.getElementById('score').textContent));
// Spieler bleibt stehen und blockt nicht; KI kämpft untereinander und gegen ihn
await G(() => (__game.player.g.hp = 9999));
await waitGame(14);
const mid = await state();
console.log('Nach 14 s:', JSON.stringify(mid));
const hurt = mid.filter((f, i) => i > 0 && f.hp < 100 * 2).length;
console.log('Marken:', await G(() => document.querySelectorAll('#marks .mark:not([hidden])').length));
await page.screenshot({ path: `${dir}/group_${mode}.png` });
// Alle Gegner des Spielers fallen lassen
await G(() => {
  const me = __game.player;
  for (const f of __game.fighters) {
    if (f.team !== me.team && f.mode !== 'dead') __game.kill(f, f.pos.subtract(me.pos).normalize(), null, me);
  }
});
await waitGame(1.5);
console.log('Anzeige nach Sieg:', await G(() => document.getElementById('score').textContent));
await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 120000, polling: 200 });
const res = await G(() => ({ title: document.getElementById('r-title').textContent, sub: document.getElementById('r-sub').textContent, lines: document.getElementById('r-lines').textContent }));
console.log('Ergebnis:', JSON.stringify(res));
console.log(res.title === 'VICTORIA' ? 'OK  Sieg im Gruppenkampf' : 'FEHLER  kein Sieg');
// Revanche: alle wieder auf den Beinen
await G(() => document.getElementById('r-again').click());
await waitGame(1);
const again = await state();
console.log(again.every((f) => f.m !== 'dead') ? 'OK  Revanche: alle stehen' : 'FEHLER  Revanche', JSON.stringify(again.map((f) => f.m)));
console.log(logs.slice(0, 10).join('\n'));
await browser.close();
