/*
 * Every skin's text reads against its background, in every combination of
 * the `theme` option and the reader's own colour scheme.
 *
 * Reported from use: with `theme: 'dark'` on a machine in light mode, prose
 * drew its field names in near-black on the dark background. The prose and
 * ledger skins redefine the field, operator and value colours, but gave the
 * dark values only under `prefers-color-scheme: dark`, so the theme option
 * never reached them. A colour needs a value in every place the theme can
 * come from; this checks the result rather than the places.
 *
 * Judged on computed colours: the text tokens as each skin resolves them,
 * against the background the editor sits on (its own --kce-bg, which the
 * page here is given, as a page using a dark theme would be dark).
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [{ name: 'a', label: 'Assigned To', type: 'text' }];
const RULE = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'a', operator: 'eq', values: [{ source: 'literal', value: 'ben' }] },
  { type: 'condition', field: 'a', operator: 'eq', values: [{ source: 'literal', value: 'sam' }] }
] } };

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; } #box { width: 680px; }</style>
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

  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  /** The text the rule is written in, against the ground it is written on. */
  window.__contrast = function () {
    const kce = document.querySelector('.kce');
    const probe = (prop, name) => {
      const s = document.createElement('span');
      s.style[prop] = 'var(--kce-' + name + ')';
      kce.querySelector('.kce-tree').appendChild(s);
      const v = getComputedStyle(s)[prop];
      s.remove();
      return v;
    };
    // Whatever the editor paints itself, otherwise its own background token —
    // which the page is given, as a host using the theme would be.
    const bg = probe('backgroundColor', 'bg');
    document.body.style.background = bg;
    let ground = 'rgba(0, 0, 0, 0)';
    for (let n = document.querySelector('.kce-condition'); n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { ground = c; break; }
    }
    const field = getComputedStyle(document.querySelector('.kce-sel-field .kce-sel-label')).color;
    const op = getComputedStyle(document.querySelector('.kce-sel-operator .kce-sel-label')).color;
    const value = getComputedStyle(document.querySelector('.kce-input')).color;
    const and = getComputedStyle(document.querySelector('.kce-connector-btn')).color;
    return {
      ground,
      field: ratio(field, ground),
      op: ratio(op, ground),
      value: ratio(value, ground),
      and: ratio(and, ground)
    };
  };
}

(async () => {
  const site = await serve();
  scratch('theme-contrast.html', PAGE);
  const browser = await chromium.launch();
  const { ok, finish } = checker();
  const errs = [];

  for (const scheme of ['light', 'dark']) {
    const p = await browser.newPage({ viewport: { width: 900, height: 500 }, colorScheme: scheme });
    watchErrors(p, errs);
    await p.goto(site.url + scratch.url('theme-contrast.html'));
    await p.evaluate(install, FIELDS);
    for (const skin of ['prose', 'equation', 'blackboard', 'ledger', 'boxed']) {
      for (const theme of [null, 'light', 'dark']) {
        await p.evaluate(([d, o]) => window.__mk(d, o), [RULE, Object.assign({ skin }, theme ? { theme } : {})]);
        const c = await p.evaluate(() => window.__contrast());
        const tag = `${skin}, theme ${theme || 'unset'}, reader in ${scheme} mode`;
        // Text needs 4.5:1. The operator is set in italics as secondary text,
        // and the AND / OR is bold small caps; both still need the 3:1 that
        // large or non-essential text gets, and in practice clear it easily.
        ok(tag + ': field names read (4.5:1)', c.field >= 4.5, c);
        ok(tag + ': values read (4.5:1)', c.value >= 4.5, c);
        ok(tag + ': operators read (3:1)', c.op >= 3, c);
        ok(tag + ': AND / OR read (3:1)', c.and >= 3, c);
      }
    }
    await p.close();
  }

  await browser.close();
  site.close();
  finish(errs);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
