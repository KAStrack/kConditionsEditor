/*!
 * The GitHub Pages site, served the way Pages serves it.
 *
 * docs/ is the site root on Pages, so anything a page reaches outside it — a
 * `../src/` script, the repository's schema/ — works from a checkout and 404s
 * once published. Serving docs/ alone makes that a console error here. The
 * pages are also meant to load the minified build, as a real install would,
 * so a page that quietly went back to src/ (or to an unminified bundle) fails.
 * And the schema's $id is a URL on the site, so the site must serve it.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, serve, checker } = require('./harness.js');
const VERSION = require('../../package.json').version;

(async () => {
  const site = await serve(0, path.join(ROOT, 'docs'));
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  for (const page of ['index.html', 'demo.html', 'skins.html', 'docs.html', 'design-lab.html']) {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const assets = [];
    p.on('pageerror', e => errs.push(page + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push(page + ': ' + m.text()); });
    p.on('requestfinished', r => {
      const u = new URL(r.url());
      if (u.origin === site.url && /\.(js|css)$/.test(u.pathname)) assets.push(u.pathname);
    });
    await p.goto(site.url + '/' + page); await p.waitForTimeout(700);
    const info = await p.evaluate(() => ({
      editors: document.querySelectorAll('.kce').length,
      undo: document.querySelectorAll('.kce-undo').length,
      grips: document.querySelectorAll('.kce-grip').length,
      version: document.querySelector('.brand-version') ? document.querySelector('.brand-version').textContent : null
    }));
    console.log(page.padEnd(17), JSON.stringify(info));
    const library = assets.filter(a => /k-conditions/.test(a));
    ok(page + ' loads the library', library.length > 0, assets);
    ok(page + ' loads only the minified build from dist/',
      library.every(a => /^\/dist\/k-conditions[a-z-]*\.min\.(js|css)$/.test(a)), library);
    ok(page + ' shows the package version', info.version === VERSION, info.version);
    await p.close();
  }
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/condition-document.schema.json'), 'utf8'));
  const id = new URL(schema.$id);
  const served = await fetch(site.url + id.pathname.replace(/^\/kConditionsEditor/, ''));
  ok('the schema is served where its $id points', served.ok, id.pathname);
  ok('the served schema is the current one',
    served.ok && JSON.stringify(await served.json()) === JSON.stringify(schema));

  await b.close(); site.close();
  finish(errs);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
