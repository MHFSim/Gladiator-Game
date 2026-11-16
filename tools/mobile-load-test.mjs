import puppeteer from 'puppeteer-core';
const [url, ua] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setUserAgent(ua);
await p.setViewport({ width: 874, height: 402, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
const logs=[]; p.on('console', m=>logs.push(m.type()+': '+m.text())); p.on('pageerror', e=>logs.push('PAGEERR '+e.message)); p.on('requestfailed', r=>logs.push('REQFAIL '+r.url()+' '+r.failure()?.errorText));
p.on('response', r=>{ if (r.status()>=400) logs.push('HTTP '+r.status()+' '+r.url()); });
await p.goto(url, {waitUntil:'load', timeout: 120000});
for (let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,3000)); const t = await p.evaluate(()=>document.getElementById('loading-text')?.textContent + ' | ready=' + (window.__ready===true) + ' | loadingVisible=' + (document.getElementById('loading').style.display!=='none')); logs.push('T'+i+': '+t); if (t.includes('ready=true')) break; }
console.log(logs.filter(l=>!l.includes('GPU stall')).join('\n'));
await b.close();
