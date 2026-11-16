// Macht Screenshots im Handy-Querformat (iPhone 17 Pro: 874 x 402 Punkte).
// Aufruf: node tools/screenshot.mjs <url> <ausgabe.png> [wartezeit-ms]
import puppeteer from 'puppeteer-core';

const [url, out, waitMs = '4000'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: Number(process.env.DPR ?? 1), isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction('window.__ready === true', { timeout: 180000 });
} catch {
  logs.push('[timeout] Spiel wurde nicht fertig geladen');
}
await new Promise((r) => setTimeout(r, Number(waitMs)));
if (process.env.EVAL) console.log('EVAL', JSON.stringify(await page.evaluate(process.env.EVAL)));
await page.screenshot({ path: out });
console.log(logs.slice(-25).join('\n'));
await browser.close();
