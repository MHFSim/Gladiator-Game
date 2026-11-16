import puppeteer from 'puppeteer-core';
const [anim, times] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/?view=front&quality=low&weather=clear', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await page.evaluate(() => (document.getElementById('menu').hidden = true));
console.log('dur', await page.evaluate((a) => __game.player.g.animator.durationOf(a), anim));
for (const t of times.split(',').map(Number)) {
  await page.evaluate((a, t) => __game.player.g.animator.play(a, { range: [t, t + 0.01], speed: 0.001, loop: true, fadeIn: 0.01 }), anim, t);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `/tmp/pose_${t}.png`, clip: { x: 287, y: 60, width: 300, height: 342 } });
}
await browser.close();
