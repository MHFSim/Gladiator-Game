import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:4173/?quality=low&weather=clear', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
const count = () => page.evaluate(() => { const s = __game.player.g.root.getScene(); return { meshes: s.meshes.length, mats: s.materials.length, tex: s.textures.length, ps: s.particleSystems.length, arena: __game.arenaKind }; });
console.log('Start', JSON.stringify(await count()));
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate(() => document.querySelector('#train-arena button[data-arena=colosseum]').click());
await page.evaluate(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('busy').hidden && !document.getElementById('menu').hidden === false, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 4000));
console.log('Kolosseum', JSON.stringify(await count()));
await page.screenshot({ path: '/tmp/sw1.png' });
// zurück nach Capua und wieder ins Kolosseum: Speicher darf nicht wachsen
for (const a of ['capua', 'colosseum', 'capua']) {
  await page.evaluate((a) => window.__world.setArena(a), a);
  console.log('->', a, JSON.stringify(await count()));
}
// Spielfeld: Spieler weit nach außen schieben
await page.evaluate(() => window.__world.setArena('colosseum'));
await page.evaluate(() => { __game.player.pos.x = 40; __game.player.pos.z = 0; });
await new Promise((r) => setTimeout(r, 1500));
console.log('Pos nach Klammer', await page.evaluate(() => [__game.player.pos.x.toFixed(1), __game.player.pos.z.toFixed(1)]));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/stall/.test(l)).slice(-10).join('\n'));
await browser.close();
