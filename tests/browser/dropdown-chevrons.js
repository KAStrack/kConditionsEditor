/*
 * A dropdown looks like one.
 *
 * Reported from KAStrack: in the written-out skins a field, an operator or a
 * choice value reads as a word in the sentence, and nothing said it could be
 * opened. Each now carries a small down chevron after its label (boxed draws
 * its own). Judged by what is painted: the chevron's computed style, its
 * contrast, and that the spot where it sits opens the select.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'a', label: 'Assigned To', type: 'text', comparableWith: ['b'] },
  { name: 'b', label: 'Owner', type: 'text' },
  { name: 'st', label: 'Status', type: 'enum', choices: { open: 'Open', done: 'Done' } }
];
const RULE = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'st', operator: 'eq', values: [{ source: 'literal', value: 'open' }] },
  { type: 'condition', field: 'a', operator: 'eq', values: [{ source: 'field', field: 'b' }] }
] } };

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; background: #fff; } #box { width: 700px; }</style>
</head><body><div id="box"></div>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
</body></html>`;

function install(FIELDS) {
  window.__mk = function (doc, opts) {
    if (window.__ed) window.__ed.destroy();
    const box = document.getElementById('box');
    box.innerHTML = '<textarea id="t"></textarea>';
    box.querySelector('#t').value = JSON.stringify(doc);
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts));
    window.__ed.setOpen(true);
  };

  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ground = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const g = /gradient/.test(cs.backgroundImage) && rgb(cs.backgroundImage);
      if (g) return g;
      const c = rgb(cs.backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return { r: 255, g: 255, b: 255 };
  };

  /** The chevron on one select shell, as painted. */
  window.__chevron = function (sel) {
    const shell = document.querySelector(sel);
    if (!shell) return null;
    const after = getComputedStyle(shell, '::after');
    const label = shell.querySelector('.kce-sel-label');
    const l = label.getBoundingClientRect(), s = shell.getBoundingClientRect();
    const room = s.right - l.right;
    const hit = document.elementFromPoint(l.right + room / 2, s.top + s.height / 2);
    const ls = getComputedStyle(label);
    const fg = rgb(after.borderRightColor), bg = ground(shell);
    const a = fg ? lum(fg) : 0, b = lum(bg);
    return {
      drawn: after.content !== 'none' && after.borderRightStyle === 'solid' && parseFloat(after.width) > 2,
      boxedChevron: /gradient/.test(ls.backgroundImage),
      room: Math.round(room),
      opens: !!hit && hit.tagName === 'SELECT' && shell.contains(hit),
      contrast: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      colour: after.borderRightColor
    };
  };
}

(async () => {
  const site = await serve();
  scratch('dropdown-chevrons.html', PAGE);
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  watchErrors(p, errs);
  await p.goto(site.url + scratch.url('dropdown-chevrons.html'));
  await p.evaluate(install, FIELDS);

  const KINDS = [
    ['field', '.kce-condition .kce-sel-field'],
    ['operator', '.kce-condition .kce-sel-operator'],
    ['choice value', '.kce-condition .kce-sel-literal'],
    ['field as a value', '.kce-sel-fieldvalue']
  ];

  for (const skin of ['prose', 'equation', 'ledger', 'blackboard']) {
    await p.evaluate(([d, s]) => window.__mk(d, { skin: s }), [RULE, skin]);
    await p.mouse.move(2, 2);
    for (const [kind, sel] of KINDS) {
      const c = await p.evaluate((s) => window.__chevron(s), sel);
      ok(`${skin} ${kind}: a chevron is drawn`, c && c.drawn, c);
      ok(`${skin} ${kind}: it has room after the label`, c && c.room >= 6, c);
      ok(`${skin} ${kind}: clicking the chevron opens the list`, c && c.opens, c);
      ok(`${skin} ${kind}: readable (≥ 3:1)`, c && c.contrast >= 3, c);
    }
    // The value/field switch is a chevron already; it gets no second one.
    const src = await p.evaluate(() => {
      const s = document.querySelector('.kce-sel-source');
      return s ? getComputedStyle(s, '::after').content : 'absent';
    });
    ok(`${skin}: the value/field switch gets no second chevron`, src === 'none', src);

    // Pointing at it says it is live.
    const rest = await p.evaluate((s) => window.__chevron(s).colour, KINDS[0][1]);
    const pt = await p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; }, KINDS[0][1]);
    await p.mouse.move(pt.x, pt.y);
    await p.waitForTimeout(150);
    const hover = await p.evaluate((s) => window.__chevron(s).colour, KINDS[0][1]);
    ok(`${skin}: the chevron takes the accent on hover`, hover !== rest, { rest, hover });
  }

  // Boxed draws its own chevron on the label, and no second one.
  await p.evaluate(([d]) => window.__mk(d, { skin: 'boxed' }), [RULE]);
  for (const [kind, sel] of KINDS) {
    const c = await p.evaluate((s) => window.__chevron(s), sel);
    ok(`boxed ${kind}: its own chevron, not a second`, c && c.boxedChevron && !c.drawn, c);
  }

  finish(errs);
  await b.close();
  site.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
