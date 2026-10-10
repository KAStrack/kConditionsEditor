const { chromium } = require('playwright');
const { serve, shot: SHOT } = require('./harness.js');
// Read the version rather than hardcoding it, so a release bump does not leave
// this script red for a reason that has nothing to do with what it tests.
const VERSION = require('../../package.json').version;
(async () => {
  const site = await serve();
  const PAGE = (name) => site.url + '/' + name;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(String(e)));
  let fail = 0;
  const ok = (n, c, x) => { if (!c) { fail++; console.log('FAIL ' + n, x); } };

  await p.goto(PAGE('docs/docs.html'));
  await p.waitForTimeout(300);

  // the live sample is styled
  const s = await p.evaluate(() => {
    const el = document.querySelector('#describe .kcd');
    const g = q => getComputedStyle(el.querySelector(q));
    return {
      present: !!el,
      fieldWeight: g('.kcd-field').fontWeight,
      valueColour: g('.kcd-value').color,
      valueUnderline: g('.kcd-value').borderBottomStyle,
      opStyle: g('.kcd-op').fontStyle,
      andColour: g('.kcd-logic.kcd-and').color,
      orColour: g('.kcd-logic.kcd-or').color,
      parenWeight: g('.kcd-paren').fontWeight,
      // sanity: the AND and OR must not be the same colour
      text: el.textContent
    };
  });
  console.log('live sample:', JSON.stringify(s));
  ok('sample present', s.present);
  ok('field bold', parseInt(s.fieldWeight, 10) >= 600, s.fieldWeight);
  ok('value underlined', s.valueUnderline === 'dashed', s.valueUnderline);
  ok('op italic', s.opStyle === 'italic', s.opStyle);
  ok('and != or', s.andColour !== s.orColour, s.andColour);
  ok('paren bold', parseInt(s.parenWeight, 10) >= 600, s.parenWeight);

  // the added stylesheet must not have restyled the docs chrome: measure a sample
  // of elements, disable the sheet, measure again, and require them identical.
  const drift = await p.evaluate(() => {
    const props = ['display','color','backgroundColor','fontFamily','fontSize','fontWeight',
                   'margin','padding','border','overflowX','lineHeight'];
    const sample = [...document.querySelectorAll('body, header, table, th, td, pre, code, h1, h2, h3, p, ul, li, a, .note')]
      .filter(e => !e.closest('#describe'));
    const snap = () => sample.map(e => {
      const cs = getComputedStyle(e);
      return props.map(k => cs[k]).join('|');
    });
    const before = snap();
    const sheet = [...document.styleSheets].find(s => /k-conditions-editor(\.min)?\.css$/.test(s.href || ''));
    sheet.disabled = true;
    const after = snap();
    sheet.disabled = false;
    const changed = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) changed.push(sample[i].tagName + '.' + sample[i].className);
    }
    return { sampled: sample.length, changed };
  });
  console.log('style drift:', JSON.stringify(drift));
  ok('sampled enough', drift.sampled > 20, drift.sampled);
  ok('no style bleed onto the docs chrome', drift.changed.length === 0, drift.changed);

  // TOC link resolves
  const anchor = await p.evaluate(() => {
    const a = document.querySelector('a[href="#describe"]');
    return !!a && !!document.getElementById('describe');
  });
  ok('toc anchor resolves', anchor);

  // every other doc page still error-free with its own version string
  for (const page of ['index.html', 'demo.html', 'skins.html']) {
    await p.goto(PAGE('docs/') + page);
    await p.waitForTimeout(400);
    const v = await p.evaluate(() => document.querySelector('.brand-version')?.textContent);
    ok(page + ' version', v === VERSION, { got: v, want: VERSION });
  }

  await p.goto(PAGE('docs/docs.html'));
  await p.waitForTimeout(200);
  const box = await p.evaluate(() => {
    document.getElementById('describe').scrollIntoView();
    return true;
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: SHOT('docs-describe.png') });

  console.log('\nfailures: ' + fail);
  console.log('ERRORS: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  site.close();
})();
