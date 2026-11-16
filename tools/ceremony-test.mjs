// Testet Gunst, Kaiser-Daumen und Todesstoß. Aufruf: node tools/ceremony-test.mjs <url> <ordner> [missio|iugula]
import puppeteer from 'puppeteer-core';

const [url, dir = '/tmp', want = 'iugula'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Spielzeit abwarten (langsamer Software-Renderer)
const waitGame = async (sec) => {
  const t0 = await page.evaluate(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 240000, polling: 200 }, t0 + sec);
};
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate(() => document.querySelector('#train-list button').click());
await wait(1500);
// Gunst testen: Parade-Ereignis + Anheizen
await page.evaluate(() => {
  __game.spec.note('parry', __game.player, __game.foe);
  __input.push({ type: 'cheer' });
});
await waitGame(0.5);
console.log('Gunst nach Parade+Anheizen:', await page.evaluate(() => [__game.player.favor, __game.foe.favor, __game.spec.excite.toFixed(2)]));
await page.screenshot({ path: `${dir}/cer0-favor.png` });
await page.evaluate(() => __game.kill(__game.foe, __game.foe.pos.subtract(__game.player.pos).normalize()));
await waitGame(4.8);
await page.evaluate((w) => {
  __game.foe.favor = w === 'iugula' ? 0 : 100;
  const r = Math.random;
  Math.random = () => (w === 'iugula' ? 0.99 : 0.01);
  setTimeout(() => (Math.random = r), 20000);
}, want);
await page.evaluate(() => __game.kill(__game.foe, __game.foe.pos.subtract(__game.player.pos).normalize()));
await waitGame(0.6);
await page.screenshot({ path: `${dir}/cer1-fall.png` });
await waitGame(2.6);
await page.screenshot({ path: `${dir}/cer2-vote.png` });
await waitGame(3.0);
await page.screenshot({ path: `${dir}/cer3-verdict.png` });
console.log('Zeremonie:', await page.evaluate(() => __game.spec.cer && { ph: __game.spec.cer.phase, v: __game.spec.cer.verdict }));
await waitGame(3.0);
await page.screenshot({ path: `${dir}/cer4-strike.png` });
await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 240000, polling: 300 });
await page.screenshot({ path: `${dir}/cer5-result.png` });
console.log('Ergebnis:', await page.evaluate(() => document.getElementById('r-sub').textContent));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/GPU stall/.test(l)).slice(-15).join('\n'));
await browser.close();
