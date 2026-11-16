// Testet Heldenmenü, Training und Ergebnis-Bildschirm. Aufruf: node tools/hero-test.mjs <url> <ordner>
import puppeteer from 'puppeteer-core';

const [url, dir = '/tmp'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('seg.hero.v1', JSON.stringify({ v: 1, name: 'Crixus', level: 2, xp: 250, attrs: { vis: 1, corpus: 0, spiritus: 0, celeritas: 0, acies: 0, gloria: 0 }, wins: 3, losses: 1, created: 1 }));
});
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
await wait(1500);
await page.screenshot({ path: `${dir}/h1-main.png` });
await click('m-hero');
await wait(300);
const plus = await page.$$('.attr-row button');
await plus[3].tap(); // Corpus +
await plus[3].tap();
await wait(200);
await page.screenshot({ path: `${dir}/h2-hero.png` });
await click('hs-apply');
await click('hs-back');
await click('m-train');
await wait(300);
await page.screenshot({ path: `${dir}/h3-train.png` });
const btns = await page.$$('#train-list button');
await btns[1].click();
await wait(1500);
const before = await page.evaluate(() => ({ hpMax: __game.player.stats.hpMax, foe: __game.foe.info, foeHp: __game.foe.stats.hpMax }));
console.log('Werte', JSON.stringify(before));
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => __game.kill(__game.foe, __game.foe.pos.subtract(__game.player.pos).normalize()));
  await wait(i === 0 ? 5200 : 4500);
}
await page.screenshot({ path: `${dir}/h4-result.png` });
const hero = await page.evaluate(() => JSON.parse(localStorage.getItem('seg.hero.v1')));
console.log('Held', JSON.stringify(hero));
await click('r-again');
await wait(2500);
console.log('Nach Revanche', JSON.stringify(await page.evaluate(() => ({ foeMode: __game.foe.mode, hp: __game.foe.g.hp, score: document.getElementById('score').textContent }))));
await page.screenshot({ path: `${dir}/h5-again.png` });
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(-15).join('\n'));
await browser.close();
