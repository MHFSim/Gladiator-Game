// Vergleichsbilder für die Grafik: startet ein Trainingsduell und fotografiert mehrere Ansichten ohne Menü und HUD.
// Aufruf: node tools/beauty.mjs <ausgabe-ordner> [arena] [zeit] [wetter] [qualität]
import puppeteer from 'puppeteer-core';

const [dir = '/tmp/beauty', arena = 'capua', time = '17.5', weather = 'clear', quality = 'ultra'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/GL Driver|GPU stall/.test(m.text()) && logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
await page.goto(`http://localhost:4173/?quality=${quality}&weather=${weather}&arena=${arena}&time=${time}&nodyn${process.env.Q ?? ''}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
const G = (fn, arg) => page.evaluate(fn, arg);
await G(() => document.getElementById('m-train').click());
await G(() => document.querySelector('#train-mode button[data-mode=duel]').click());
await G(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
await G(() => {
  const z = __game.foe.pos.scale(0);
  __game.ai.update = () => ({ dir: z, speed: 0 });
  __game.player.g.root.position.set(0, 0, -0.9);
  __game.foe.g.root.position.set(0, 0, 0.9);
  __game.player.g.setHeading(0);
  __game.foe.g.setHeading(Math.PI);
  document.getElementById('hud').style.visibility = 'hidden';
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(5000);
await page.screenshot({ path: `${dir}/play_${arena}.png` });
// Schlag mit Blut
await G(() => __input.push({ type: 'heavy' }));
await sleep(2600);
await page.screenshot({ path: `${dir}/hit_${arena}.png` });
const cam = async (name, pos, target) => {
  await G(
    ([p, t]) => {
      __game.updateCamera = () => {};
      __game.debugCamera(new __game.player.pos.constructor(...p), new __game.player.pos.constructor(...t));
    },
    [pos, target],
  );
  await sleep(2500);
  await page.screenshot({ path: `${dir}/${name}_${arena}.png` });
};
await cam('close', [2.6, 1.5, -1.6], [0, 1.25, 0]);
await cam('wide', [9, 6.5, -12], [-2, 1.5, 2]);
await cam('low', [-5, 0.6, -6], [3, 4, 6]);
// Gegen die Sonne (Lichtstrahlen durch die Bögen)
const sd = await G(() => {
  const d = window.__env.sun.direction;
  return [-d.x, -d.y, -d.z];
});
const h = Math.hypot(sd[0], sd[2]);
await cam('sun', [(-sd[0] / h) * 6, 1.4, (-sd[2] / h) * 6], [(sd[0] / h) * 30, 1.4 + sd[1] * 30, (sd[2] / h) * 30]);
console.log(logs.slice(0, 12).join('\n'));
await browser.close();
