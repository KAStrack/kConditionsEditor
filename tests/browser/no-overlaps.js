/*
 * Nothing the editor draws lands on a control.
 *
 * Reported from KAStrack: a vertical line ran under the add buttons. It was
 * the preview bar, stretched to reach a ghost row shown one line low, through
 * the line holding the buttons. Looking for the general case turned up four
 * more, each a mark or a float placed by measurement without regard to what
 * was already there:
 *   - a group guide running past a ghost row that does not belong to its group;
 *   - a hover-mode add strip hanging over the ghost row placed under it;
 *   - the same strip covering the next line's AND / OR, aligned in a column
 *     beneath it;
 *   - a group's tool rails overlapping, with every rail shown at rest;
 * and one older one: the tree skins' header grip overlapping the ↑ beside it.
 *
 * So this checks the property, not the cases. Across rules, skins, widths,
 * preview styles and both control modes, at rest and while each add and ×
 * button is hovered for real (which is when the previews, ghosts and strips
 * are drawn), nothing visible may overlap: no guide or preview bar may cross
 * a control or the ghost, and no two controls may overlap each other.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [{ name: 'p', label: 'Package Ref', type: 'text' }];
const c = () => ({ type: 'condition', field: 'p', operator: 'eq', values: [{ source: 'literal', value: '' }] });
const g = (op, kids, negate) => ({ type: 'group', operator: op, negate: !!negate, children: kids });
const RULES = {
  // The reported shape: a group whose last child is a group.
  last: { version: '1.0', root: g('and', [c(), c(), g('or', [c(), c(), g('and', [c(), c()])])]) },
  // A negated group in the middle of another.
  middle: { version: '1.0', root: g('and', [c(), g('or', [c(), g('and', [c(), c()], true), c()]), c()]) },
  // Groups that open with a group: their rails start on the same line.
  first: { version: '1.0', root: g('and', [g('or', [g('and', [c(), c()]), c()]), c()]) }
};

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; background: #fff; }</style>
</head><body><div id="box"></div>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
</body></html>`;

function install(FIELDS) {
  window.__mk = function (doc, opts, width) {
    if (window.__ed) window.__ed.destroy();
    const box = document.getElementById('box');
    box.style.width = width + 'px';
    box.innerHTML = '<textarea id="t"></textarea>';
    box.querySelector('#t').value = JSON.stringify(doc);
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts));
    window.__ed.setOpen(true);
    // The add and × buttons draw previews; the AND / OR words light guides.
    return Array.from(document.querySelectorAll('.kce-add, .kce-remove, .kce-connector-btn'))
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => b.getAttribute('data-fk')).filter(Boolean);
  };

  const visible = (e) => {
    let o = 1;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o > 0.5 && getComputedStyle(e).visibility !== 'hidden';
  };
  const box = (e) => e.getBoundingClientRect();
  const meets = (a, b, slack) => a.left < b.right - slack && a.right > b.left + slack && a.top < b.bottom - slack && a.bottom > b.top + slack;
  const name = (e) => e.className.split(' ')[0] + (e.textContent.trim() ? '(' + e.textContent.trim().slice(0, 8) + ')' : '');

  /** Everything visible that overlaps something it must not. */
  window.__overlaps = function () {
    const controls = Array.from(document.querySelectorAll(
      '.kce-add, .kce-icon-btn:not(:disabled), .kce-connector-btn, .kce-grip, .kce-tree .kce-btn, .kce-paren, .kce-ghost'))
      .filter((e) => { const r = box(e); return r.width > 0 && r.height > 0 && visible(e); });
    const text = Array.from(document.querySelectorAll('.kce-sel-label, .kce-tree .kce-input'))
      .filter((e) => { const r = box(e); return r.width > 0 && r.height > 0; });
    const lines = Array.from(document.querySelectorAll('.kce-guide, .kce-preview-mark'))
      .filter((m) => box(m).width < 8 && visible(m));
    const found = [];
    lines.forEach((l) => controls.concat(text).forEach((e) => {
      if (meets(box(l), box(e), 0.5)) found.push(name(l) + ' × ' + name(e));
    }));
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i], b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (meets(box(a), box(b), 1)) found.push(name(a) + ' × ' + name(b));
      }
    }
    return found;
  };

  /** Where to point to reveal a control: the row (or header) it belongs to. */
  window.__reveal = function (fk) {
    const b = document.querySelector('[data-fk="' + fk + '"]');
    let host = null;
    for (let n = b; n && !host; n = n.parentElement) {
      if (n.classList.contains('kce-line')) host = n.querySelector('.kce-condition') || n.firstElementChild;
      else if (n.classList.contains('kce-connector')) host = n.previousElementSibling;
      else if (n.classList.contains('kce-condition') || n.classList.contains('kce-group-head')) host = n;
    }
    if (host && host.classList.contains('kce-group')) host = host.querySelector('.kce-condition') || host;
    const r = box(host || b);
    return { x: r.left + Math.min(8, r.width / 2), y: r.top + Math.min(r.height / 2, 12) };
  };

  window.__at = function (fk) {
    const r = box(document.querySelector('[data-fk="' + fk + '"]'));
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
}

(async () => {
  const site = await serve();
  scratch('no-overlaps.html', PAGE);
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  watchErrors(p, errs);
  await p.goto(site.url + scratch.url('no-overlaps.html'));
  await p.evaluate(install, FIELDS);

  const configs = [];
  for (const rule of Object.keys(RULES)) {
    for (const controls of ['hover', 'always']) {
      for (const width of [545, 760]) {
        for (const previewStyle of ['bar', 'highlight']) configs.push({ rule, skin: 'prose', width, controls, previewStyle });
        // Inline, the row's arrows and × float in the strip after the AND / OR.
        configs.push({ rule, skin: 'prose', width, controls, previewStyle: 'bar', placement: 'inline' });
      }
      for (const skin of ['equation', 'boxed']) configs.push({ rule, skin, width: 760, controls, previewStyle: 'bar' });
    }
  }

  for (const cfg of configs) {
    const tag = `${cfg.rule} ${cfg.skin}${cfg.placement ? '-' + cfg.placement : ''}@${cfg.width} ${cfg.previewStyle}/${cfg.controls}`;
    const buttons = await p.evaluate(([d, o, w]) => window.__mk(d, o, w),
      [RULES[cfg.rule], Object.assign({ skin: cfg.skin, controls: cfg.controls, previewStyle: cfg.previewStyle },
        cfg.placement ? { connectorPlacement: cfg.placement } : {}), cfg.width]);
    await p.mouse.move(2, 2);
    await p.waitForTimeout(60);
    const found = (await p.evaluate(() => window.__overlaps())).map((f) => 'rest: ' + f);
    for (const fk of buttons) {
      await p.mouse.move(2, 2);
      await p.waitForTimeout(30);
      const r = await p.evaluate((k) => window.__reveal(k), fk);
      await p.mouse.move(r.x, r.y);
      await p.waitForTimeout(40);
      const at = await p.evaluate((k) => window.__at(k), fk);
      await p.mouse.move(at.x, at.y);
      await p.waitForTimeout(60);
      (await p.evaluate(() => window.__overlaps())).forEach((f) => found.push(fk + ': ' + f));
    }
    ok(tag + ': nothing visible overlaps', found.length === 0, [...new Set(found)].slice(0, 8));
  }

  finish(errs);
  await b.close();
  site.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
