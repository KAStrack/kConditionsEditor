/*!
 * Where prose puts each AND / OR: `connectorPlacement`.
 *
 * 'below' (the default) gives each AND / OR a line of its own under the row,
 * starting where the field name starts, with any bracket it opens beside it
 * ("AND ("). 'inline' puts it on the row's line, just after the value — the
 * row's arrows and × no longer sit between the two, so it can.
 *
 * Either way the AND / OR must not move when the row's controls appear: every
 * line is hovered with the real pointer, and the operators re-measured. And
 * the controls must still be there to use: hit-tested where they are painted.
 * Crossed with both control modes and a dialog-sized host.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, shot, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'subject', label: 'Subject', type: 'enum', choices: { sales: 'Sales', support: 'Support' } },
  { name: 'state', label: 'State', type: 'enum', choices: { AL: 'Alabama', CA: 'California', FL: 'Florida' } },
  { name: 'signup', label: 'Signup Date', type: 'date' },
  { name: 'tel', label: 'Telephone', type: 'text' }
];
const C = (f, op, v) => ({ type: 'condition', field: f, operator: op, values: [{ source: 'literal', value: v }] });
// A row followed by a group ("AND ("), a negated group, a group closing onto
// an AND, rows of very different widths, and a lone row at the end.
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  C('name', 'eq', 'Ann Smith'),
  C('subject', 'eq', 'support'),
  { type: 'group', operator: 'or', children: [C('state', 'eq', 'AL'), C('state', 'eq', 'CA'), C('signup', 'date_after', '2024-01-01')] },
  { type: 'group', operator: 'and', negate: true, children: [C('name', 'contains', 'test'), C('tel', 'starts_with', '+1')] },
  C('tel', 'starts_with', '+44')
] } };
// Ben's two reports: an OR after a group's `)` belongs under the `)` — not
// under the next row's name, and not pushed in by the button's padding when
// there is no row at that level at all.
const NAMES = [C('name', 'eq', 'a'), C('name', 'eq', 'b')];
const DOCS = {
  mixed: DOC,
  'group then row': { version: '1.0', root: { type: 'group', operator: 'or', children: [
    { type: 'group', operator: 'and', children: NAMES }, C('name', 'eq', 'c')] } },
  'two groups': { version: '1.0', root: { type: 'group', operator: 'or', children: [
    { type: 'group', operator: 'and', children: NAMES }, { type: 'group', operator: 'and', children: NAMES }] } },
  // The same two shapes a level down: `) OR (` and `) OR` then a row.
  nested: { version: '1.0', root: { type: 'group', operator: 'and', children: [C('name', 'eq', 'x'),
    { type: 'group', operator: 'or', children: [
      { type: 'group', operator: 'and', children: NAMES }, { type: 'group', operator: 'and', children: NAMES }, C('name', 'eq', 'c')] }] } }
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; background: #fff; }</style>
</head><body><div id="box"><textarea id="t"></textarea></div>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
</body></html>`;

function mk(page, opts, width, doc) {
  return page.evaluate(({ doc, fields, opts, width }) => {
    if (window.__ed) window.__ed.destroy();
    const box = document.getElementById('box');
    box.style.width = width + 'px';
    box.innerHTML = '<textarea id="t"></textarea>';
    box.querySelector('#t').value = JSON.stringify(doc);
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields, collapsible: false }, opts));
    window.__ed.setOpen(true);
  }, { doc: doc || DOC, fields: FIELDS, opts, width });
}

/** Every AND / OR's box, and what each one is lined up against. */
function measure(page) {
  return page.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, y: b.top + b.height / 2 }; };
    const lines = Array.from(document.querySelectorAll('.kce-line'));
    return Array.from(document.querySelectorAll('.kce-line > .kce-connector')).map((c) => {
      const line = c.parentNode;
      const btn = c.querySelector('.kce-connector-btn');
      const row = line.querySelector(':scope > .kce-condition');
      const paren = line.querySelector(':scope > .kce-paren-open');
      // What follows the AND / OR in the flow: NOT, or the bracket itself.
      let next = c.nextElementSibling;
      while (next && (getComputedStyle(next).position === 'absolute' || !next.offsetWidth)) next = next.nextElementSibling;
      // Where the text directly above starts: the field name under a row,
      // the bracket under a group. Measured on the text itself (a Range),
      // not on the boxes, whose padding is exactly what can mislead.
      const glyphs = (e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect().left; };
      const above = (row && row.querySelector('.kce-sel-field .kce-sel-label')) || line.querySelector(':scope > .kce-paren-close');
      return {
        key: btn.getAttribute('data-fk'),
        box: r(btn),
        text: glyphs(btn),
        aboveText: above ? glyphs(above) : null,
        aboveIs: above ? (above.classList.contains('kce-paren-close') ? 'bracket' : 'field name') : null,
        row: row && r(row),
        values: row && r(row.querySelector('.kce-values')),
        rowHoldsTools: !!(row && row.querySelector('.kce-remove, .kce-move')),
        paren: paren && r(paren),
        close: (() => { const k = line.querySelector(':scope > .kce-paren-close'); return k && r(k); })(),
        next: next && r(next),
        nextIsAdds: !!(next && next.classList.contains('kce-adds'))
      };
    });
  });
}

/** Is this the element painted at its own centre? */
function painted(page, selector) {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return hit === e || e.contains(hit);
  }, selector);
}

(async () => {
  const site = await serve();
  scratch('connector-placement.html', PAGE);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = watchErrors(p, []);
  const { ok, finish } = checker();
  await p.goto(site.url + scratch.url('connector-placement.html'));

  for (const [docName, doc] of Object.entries(DOCS)) for (const placement of ['below', 'inline']) {
    for (const controls of ['hover', 'always']) {
      for (const width of [880, 545]) {
        const tag = '[' + docName + ': ' + placement + ' ' + controls + ' ' + width + '] ';
        await mk(p, { connectorPlacement: placement, controls }, width, doc);
        await p.mouse.move(2, 2);
        await p.waitForTimeout(200);
        const rest = await measure(p);
        ok(tag + 'the editor says where they go', await p.evaluate(() => document.querySelector('.kce').getAttribute('data-kce-connectors')) === placement);

        if (placement === 'below') {
          // Under a `)`, the AND / OR is the same distance down whether or not
          // a `(` follows it, at every level.
          const under = rest.filter((c) => c.close).map((c) => ({ key: c.key, opens: !!c.paren, gap: +(c.box.t - c.close.b).toFixed(1) }));
          if (under.length > 1) {
            const gaps = under.map((u) => u.gap);
            ok(tag + 'under a `)`, every AND / OR keeps the same space above it', Math.max(...gaps) - Math.min(...gaps) <= 1, under);
          }
          for (const c of rest) {
            ok(tag + c.key + ' starts where the ' + (c.aboveIs || 'text above') + ' above it starts',
              c.aboveText !== null && Math.abs(c.text - c.aboveText) <= 1, { text: c.text, above: c.aboveText });
            if (c.row) ok(tag + c.key + ' is on a line of its own, under its row', c.box.t >= c.row.b - 2, { conn: c.box, row: c.row });
            if (c.paren) {
              ok(tag + c.key + ' shares its line with the bracket it opens', Math.abs(c.paren.y - c.box.y) < 8, { conn: c.box, paren: c.paren });
              // With controls shown at rest, the add buttons are in the flow
              // after the AND / OR and before the bracket — visible, so they
              // count as being beside it. Hidden, nothing comes between.
              if (controls === 'hover' || !c.nextIsAdds) {
                ok(tag + c.key + ' has its NOT or bracket straight after it', c.next && c.next.l - c.box.r < 14, { conn: c.box, next: c.next });
              }
            }
          }
        } else {
          for (const c of rest) {
            if (!c.row) continue;
            ok(tag + c.key + ' is on its row\'s line', Math.abs(c.box.y - c.row.y) < 8, { conn: c.box, row: c.row });
            ok(tag + c.key + ': nothing waits between the value and the AND / OR', !c.rowHoldsTools);
          }
          // Aligned in columns, the gap is the column's: its widest row's
          // operator sits right after its value.
          const gaps = rest.filter((c) => c.values).map((c) => c.box.l - c.values.r);
          ok(tag + 'the closest AND / OR sits just after its value', Math.min.apply(null, gaps) <= 16, gaps.map(Math.round));
          if (controls === 'hover') {
            ok(tag + 'at rest, the moved × does not take the pointer', !(await painted(p, '.kce-adds > .kce-remove')));
          }
        }

        // Hover every line, as a reader would: the operators stay put.
        const lineCount = await p.evaluate(() => document.querySelectorAll('.kce-line').length);
        let moved = [];
        for (let i = 0; i < lineCount; i++) {
          const pt = await p.evaluate((i) => {
            const l = document.querySelectorAll('.kce-line')[i];
            const first = l.firstElementChild.getBoundingClientRect();
            return { x: first.left + 12, y: first.top + first.height / 2 };
          }, i);
          // From a neutral spot each time: travelling down from the line above
          // can cross its add strip, which may hang over this line on a narrow
          // host — and pointing at an add button previews, by design.
          await p.mouse.move(2, 2);
          await p.mouse.move(pt.x, pt.y);
          await p.waitForTimeout(60);
          const now = await measure(p);
          now.forEach((c, k) => {
            const was = rest[k];
            if (!was || Math.abs(c.box.l - was.box.l) > 0.5 || Math.abs(c.box.t - was.box.t) > 0.5) moved.push('line ' + i + ': ' + c.key);
          });
        }
        ok(tag + 'no AND / OR moves while any line is hovered', moved.length === 0, moved);

        // Inline, the row's controls are in the strip after its AND / OR: on
        // hover they are there, painted, and after the operator.
        if (placement === 'inline') {
          const pt = await p.evaluate(() => {
            const row = document.querySelector('.kce-line > .kce-condition');
            const f = row.querySelector('.kce-sel-field').getBoundingClientRect();
            return { x: f.left + 5, y: f.top + f.height / 2 };
          });
          await p.mouse.move(pt.x, pt.y);
          await p.waitForTimeout(150);
          const strip = await p.evaluate(() => {
            const line = document.querySelector('.kce-line > .kce-condition').parentNode;
            const x = line.querySelector('.kce-adds > .kce-remove');
            const conn = line.querySelector('.kce-connector-btn');
            const b = x.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            // After the operator — or, when the line has no room for it, in the
            // strip hanging just below the line, as every add strip may.
            const hanging = x.parentNode.classList.contains('kce-adds-below');
            return { painted: hit === x, after: hanging || b.left >= conn.getBoundingClientRect().right, hanging, opacity: getComputedStyle(x).opacity };
          });
          ok(tag + "hovered, the row's × is painted after its AND / OR (or just below the line)", strip.painted && strip.after && strip.opacity === '1', strip);
        }

        await p.mouse.move(2, 2);
        await p.waitForTimeout(100);
        if (width === 880 && controls === 'hover') {
          await p.locator('.kce').screenshot({ path: shot('connector-placement-' + placement + (docName === 'mixed' ? '' : '-' + docName.replace(/ /g, '-')) + '.png') });
        }
      }
    }
  }

  // Switching live: the layout changes, the document does not.
  await mk(p, {}, 880);
  const before = await p.evaluate(() => document.getElementById('t').value);
  await p.evaluate(() => window.__ed.setConnectorPlacement('inline'));
  await p.waitForTimeout(150);
  const live = await measure(p);
  ok('setConnectorPlacement switches live', live.every((c) => !c.row || Math.abs(c.box.y - c.row.y) < 8), live.map((c) => c.key));
  ok('switching leaves the field untouched', await p.evaluate(() => document.getElementById('t').value) === before);
  ok('an unknown placement falls back to below',
    await p.evaluate(() => { window.__ed.setConnectorPlacement('sideways'); return document.querySelector('.kce').getAttribute('data-kce-connectors'); }) === 'below');

  await b.close();
  site.close();
  scratch.remove('connector-placement.html');
  finish(errs);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
