/*
 * A row is one line: its arrows, × and AND / OR never go below it.
 *
 * Reported from KAStrack: depending on the length of the field, the operator
 * and the value, the move arrows, the × and the AND / OR after a row would
 * sometimes drop below it. In prose the AND / OR wrapped onto a line of its
 * own whenever the row filled the line; and a value of several parts (between,
 * a tag list) wrapped inside the row, which then centred its controls on a
 * tall block, below the field name.
 *
 * Also the `controls` option: 'hover' reveals the row controls on hover,
 * 'always' shows them at rest, and a screen with no hover gets 'always'.
 *
 * Judged by what is painted, after a real hover where hover matters.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'a', label: 'Assigned To', type: 'text' },
  { name: 'long', label: 'Person In Charge Of This Ticket Escalation', type: 'text' },
  { name: 'team', label: 'Team', type: 'enum', choices: { emea: 'Customer Success Escalation Team (EMEA)', us: 'US' } },
  { name: 'n', label: 'Amount', type: 'number' },
  { name: 'd', label: 'Due date', type: 'date' }
];
const cv = (f, op, vals) => ({ type: 'condition', field: f, operator: op, values: vals.map((v) => ({ source: 'literal', value: v })) });
const VARIANTS = {
  longValue: cv('a', 'eq', ['x'.repeat(40)]),
  longField: cv('long', 'eq', ['abc']),
  enumLong: cv('team', 'eq', ['emea']),
  between: cv('n', 'between', [100000, 250000]),
  tags: cv('a', 'in_list', [['refund', 'cancel', 'chargeback', 'dispute', 'fraud']]),
  dateBetween: cv('d', 'date_between', ['2026-01-01', '2026-12-31']),
  // An operator label with a {value} slot: the words after the operand ride
  // the row too, after the value.
  slotted: cv('d', 'date_more_than_days_ahead', [365])
};
// The variant at depth 0 and again inside a group, where it is not last.
const rule = (v) => ({ version: '1.0', root: { type: 'group', operator: 'and', children: [
  v, cv('a', 'eq', ['y']), { type: 'group', operator: 'or', children: [v, cv('a', 'eq', ['z'])] }
] } });

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
    return document.querySelector('.kce').getAttribute('data-kce-controls');
  };

  window.__opacity = function (el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  };

  /** Everything about row i that this script judges. */
  window.__row = function (i) {
    const row = document.querySelectorAll('.kce-condition')[i];
    const label = row.querySelector('.kce-sel-field .kce-sel-label');
    const lab = label.getBoundingClientRect();
    const band = [lab.top - 4, lab.bottom + 4];
    const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
    const own = ':scope > .kce-remove, :scope > .kce-move .kce-move-btn:not(:disabled)';
    let controls = Array.from(row.querySelectorAll(own));
    const line = row.parentElement.classList.contains('kce-line') ? row.parentElement : null;
    // Inline prose: the arrows and × ride in the strip after the AND / OR —
    // on this line, unless the line is full and the strip hangs below it.
    const strip = line && line.querySelector(':scope > .kce-adds');
    if (!controls.length && strip && !strip.classList.contains('kce-adds-below')) controls = Array.from(strip.querySelectorAll(own));
    // Below (the default), the AND / OR is meant to be under the row: on the
    // line below the field's, not on it.
    const below = !!line && getComputedStyle(line).flexWrap === 'wrap';
    if (line && !below) controls.push(...line.querySelectorAll(':scope > .kce-connector'));
    // The value's first line counts too: a tag list may wrap, but its first
    // chip sits on the field name's line, not the name halfway down the chips.
    const first = row.querySelector('.kce-values .kce-tag, .kce-values .kce-input, .kce-values .kce-sel');
    if (first) controls.push(first);
    const off = controls.filter((c) => { const y = mid(c); return y < band[0] || y > band[1]; })
      .map((c) => c.className.split(' ').pop());
    if (below) {
      line.querySelectorAll(':scope > .kce-connector').forEach((c) => { if (mid(c) <= band[1]) off.push('kce-connector (not below)'); });
    }
    const values = row.querySelector('.kce-values');
    const fs = parseFloat(getComputedStyle(row.querySelector('.kce-sel-field')).fontSize);
    const natural = label.scrollWidth;
    const input = row.querySelector('.kce-value > input');
    return {
      off,
      overflow: row.scrollWidth - row.clientWidth,
      clipped: values.scrollWidth - values.clientWidth,
      nameShort: Math.round(Math.min(natural, 2.5 * fs) - lab.width),
      input: input ? (() => { const r = input.getBoundingClientRect(); return [r.left, r.top, r.width]; })() : null
    };
  };

  window.__point = function (i) {
    const s = document.querySelectorAll('.kce-condition .kce-sel-field')[i].getBoundingClientRect();
    return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  };
}

(async () => {
  const site = await serve();
  scratch('one-line-rows.html', PAGE);
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();

  async function open(ctxOpts) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1100, height: 800 } }, ctxOpts || {}));
    const p = await ctx.newPage();
    watchErrors(p, errs);
    await p.goto(site.url + scratch.url('one-line-rows.html'));
    await p.evaluate(install, FIELDS);
    return p;
  }

  const p = await open();

  // prose twice: AND / OR below each row (the default), and inline.
  for (const variant of ['prose', 'prose-inline', 'equation', 'boxed']) {
    const skin = variant === 'prose-inline' ? 'prose' : variant;
    const placement = variant === 'prose-inline' ? { connectorPlacement: 'inline' } : {};
    for (const controls of ['hover', 'always']) {
      for (const width of [545, 640, 760]) {
        for (const [name, v] of Object.entries(VARIANTS)) {
          const tag = `${variant}/${controls}@${width} ${name}`;
          await p.evaluate(([d, o, w]) => window.__mk(d, o, w), [rule(v), Object.assign({ skin, controls }, placement), width]);
          const rows = await p.evaluate(() => document.querySelectorAll('.kce-condition').length);
          for (let i = 0; i < rows; i++) {
            await p.mouse.move(2, 2);
            await p.waitForTimeout(30);
            const rest = await p.evaluate((k) => window.__row(k), i);
            const pt = await p.evaluate((k) => window.__point(k), i);
            await p.mouse.move(pt.x, pt.y);
            await p.waitForTimeout(150);
            const hov = await p.evaluate((k) => window.__row(k), i);

            ok(`${tag} row ${i}: arrows, ×, AND / OR and the value's first line on the field's line`, hov.off.length === 0, hov.off);
            ok(`${tag} row ${i}: nothing spills out of the row`, hov.overflow <= 1 && hov.clipped <= 1, hov);
            ok(`${tag} row ${i}: names keep a readable floor`, hov.nameShort <= 1, hov.nameShort);
            if (hov.input) {
              ok(`${tag} row ${i}: pointing at the row moves nothing`,
                rest.input.every((n, k) => Math.abs(n - hov.input[k]) < 0.5), { rest: rest.input, hover: hov.input });
            }
          }

          // A line that cannot fit scrolls rather than overlapping. Down to
          // 545px that should not be needed — except a date range, whose two
          // dates need 16em, in a nested row with the add buttons shown.
          const allowed = name === 'dateBetween' && width === 545 && controls === 'always' && skin === 'prose';
          if (!allowed) {
            const over = await p.evaluate(() => { const t = document.querySelector('.kce-tree'); return t.scrollWidth - t.clientWidth; });
            ok(`${tag}: no sideways scroll`, over <= 1, over);
          }
        }
      }
    }
  }

  // Hover mode, prose: the add buttons float. Shown on hover where the pointer
  // can reach them; at rest, a strip hanging over the next line must not take
  // the pointer from it.
  await p.evaluate(([d]) => window.__mk(d, { skin: 'prose' }, 545), [rule(VARIANTS.longValue)]);
  await p.mouse.move(2, 2);
  await p.waitForTimeout(50);
  const restHits = await p.evaluate(() => Array.from(document.querySelectorAll('.kce-adds-float')).map((a) => {
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && a.contains(hit);
  }));
  ok('hover mode: floats exist', restHits.length > 0, restHits.length);
  ok('hover mode: an invisible strip does not take the pointer', restHits.every((h) => !h), restHits);
  const pt0 = await p.evaluate(() => window.__point(0));
  await p.mouse.move(pt0.x, pt0.y);
  await p.waitForTimeout(200);
  const shown = await p.evaluate(() => {
    const a = document.querySelector('.kce-line .kce-adds-float .kce-add');
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { opacity: window.__opacity(a), hit: hit === a || a.contains(hit) };
  });
  ok('hover mode: the revealed add button is painted and reachable', shown.opacity > 0.95 && shown.hit, shown);

  // The option.
  const attr = () => p.evaluate(() => document.querySelector('.kce').getAttribute('data-kce-controls'));
  ok('default controls are hover', await p.evaluate(([d]) => window.__mk(d, {}, 640), [rule(VARIANTS.between)]) === 'hover');
  await p.evaluate(() => window.__ed.setControls('always'));
  ok('setControls switches live', await attr() === 'always');
  await p.evaluate(() => window.__ed.setControls('sometimes'));
  ok('an unknown mode falls back to hover', await attr() === 'hover');

  for (const skin of ['prose', 'equation', 'boxed']) {
    await p.evaluate(([d, s]) => window.__mk(d, { skin: s, controls: 'always' }, 640), [rule(VARIANTS.between), skin]);
    await p.mouse.move(2, 2);
    await p.waitForTimeout(150);
    const rest = await p.evaluate(() => {
      const row = document.querySelector('.kce-condition');
      return {
        grip: window.__opacity(row.querySelector('.kce-grip')),
        move: window.__opacity(row.querySelector('.kce-move')),
        remove: window.__opacity(row.querySelector(':scope > .kce-remove')),
        adds: Array.from(document.querySelectorAll('.kce-add')).some((a) => a.getBoundingClientRect().width > 2 && window.__opacity(a) > 0.95)
      };
    });
    ok(`always/${skin}: row controls shown at rest`, rest.grip > 0.95 && rest.move > 0.95 && rest.remove > 0.95 && rest.adds, rest);
  }

  // A screen with no hover gets 'always', whatever the option says.
  const t = await open({ viewport: { width: 700, height: 700 }, hasTouch: true, isMobile: true });
  const touch = await t.evaluate(([d]) => window.__mk(d, { controls: 'hover' }, 545), [rule(VARIANTS.between)]);
  ok('a screen with no hover gets always', touch === 'always', touch);

  finish(errs);
  await b.close();
  site.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
