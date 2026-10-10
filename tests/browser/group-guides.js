/*
 * Group guides: in prose, a thin line down the left of each bracketed group's
 * rows, in the group's AND / OR colour, so a row can be traced to its group.
 * Pointing at a group's AND / OR word, or one of its brackets, strengthens
 * that group's line.
 *
 * Judged by what is painted: the guide's extent against the rows it must
 * span and the rows it must not, its computed colour, its opacity at rest and
 * when lit, and that it never takes the pointer.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'a', label: 'Assigned To', type: 'text' },
  { name: 'p', label: 'Priority', type: 'text' },
  { name: 't', label: 'Tier', type: 'text' }
];
const c = (f, v) => ({ type: 'condition', field: f, operator: 'eq', values: [{ source: 'literal', value: v }] });

// ben AND FL AND (high OR urgent OR NOT (VIP AND EMEA)) AND sam
//   r.2   the OR group      — rows high, urgent, VIP, EMEA
//   r.2.2 the NOT AND group — rows VIP, EMEA
const RULE = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  c('a', 'ben'), c('a', 'FL'),
  { type: 'group', operator: 'or', children: [c('p', 'high'), c('p', 'urgent'),
    { type: 'group', operator: 'and', negate: true, children: [c('t', 'VIP'), c('t', 'EMEA')] }] },
  c('a', 'sam')
] } };

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; background: #fff; } #box { width: 680px; }</style>
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
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
    window.__ed.setOpen(true);
    return document.querySelectorAll('.kce-guide').length;
  };

  const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const row = (v) => Array.from(document.querySelectorAll('.kce-condition')).find((r) => r.querySelector('.kce-input').value === v);
  const token = (name) => {
    const s = document.createElement('span');
    s.style.color = 'var(--kce-' + name + ')';
    document.querySelector('.kce-tree').appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  };

  /** One guide, judged against the rows it must and must not span. */
  window.__guide = function (id, inside, outside) {
    const g = document.querySelector('.kce-guide[data-group="' + id + '"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const cs = getComputedStyle(g);
    const textLeft = Math.min.apply(null, inside.map((v) => row(v).querySelector('.kce-sel-field .kce-sel-label').getBoundingClientRect().left));
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const op = g.classList.contains('is-or') ? 'or' : 'and';
    // Exactly the lines strictly between the group's own brackets, as they
    // stand now (a nested group's closing bracket is inside it) — loose enough
    // to tolerate rounding, not a line's worth of staleness.
    const lineOf = (el) => { let n = el; while (n && !n.classList.contains('kce-line')) n = n.parentElement; return n; };
    const firstLine = lineOf(document.querySelector('.kce-paren-open[data-node="' + id + '"]')).nextElementSibling.getBoundingClientRect();
    const lastLine = lineOf(document.querySelector('.kce-paren-close[data-node="' + id + '"]')).previousElementSibling.getBoundingClientRect();
    return {
      exact: Math.abs(r.top - (firstLine.top + 3)) <= 2 && Math.abs(r.bottom - (lastLine.bottom - 3)) <= 2,
      spans: inside.every((v) => { const y = mid(row(v)); return y >= r.top && y <= r.bottom; }),
      excludes: outside.every((v) => { const y = mid(row(v)); return y < r.top || y > r.bottom; }),
      clearOfText: r.right <= textLeft - 4,
      colour: (cs.borderLeftStyle === 'dashed' ? cs.borderLeftColor : cs.backgroundColor) === token(op),
      dashed: cs.borderLeftStyle === 'dashed',
      opacity: parseFloat(cs.opacity),
      takesPointer: !!hit && (hit === g || g.contains(hit))
    };
  };

  window.__centre = function (sel) {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
}

(async () => {
  const site = await serve();
  scratch('group-guides.html', PAGE);
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  watchErrors(p, errs);
  await p.goto(site.url + scratch.url('group-guides.html'));
  await p.evaluate(install, FIELDS);

  const OR = ['r.2', ['high', 'urgent', 'VIP', 'EMEA'], ['FL', 'sam']];
  const NOT = ['r.2.2', ['VIP', 'EMEA'], ['urgent', 'sam']];
  const judge = (g) => p.evaluate(([id, i, o]) => window.__guide(id, i, o), g);
  const park = async () => { await p.mouse.move(2, 2); await p.waitForTimeout(200); };

  for (const width of [680, 545]) {
    await p.evaluate((w) => { document.getElementById('box').style.width = w + 'px'; }, width);
    const count = await p.evaluate(([d]) => window.__mk(d, { skin: 'prose' }), [RULE]);
    ok(`@${width} one guide per bracketed group, plus the rule's own`, count === 3, count);
    await park();
    for (const [name, g] of [['OR group', OR], ['NOT group', NOT]]) {
      const r = await judge(g);
      ok(`@${width} ${name}: spans exactly its rows`, r && r.exact && r.spans && r.excludes, r);
      ok(`@${width} ${name}: clear of the text`, r && r.clearOfText, r);
      ok(`@${width} ${name}: in its operator's colour`, r && r.colour, r);
      ok(`@${width} ${name}: faint at rest`, r && r.opacity > 0.2 && r.opacity < 0.6, r);
      ok(`@${width} ${name}: never takes the pointer`, r && !r.takesPointer, r);
    }
    ok(`@${width} a negated group's guide is dashed, the other is not`,
      (await judge(NOT)).dashed && !(await judge(OR)).dashed);
  }

  // Pointing at a group's AND / OR word lights its guide, and only its guide.
  await p.evaluate(([d]) => window.__mk(d, { skin: 'prose' }), [RULE]);
  await park();
  let pt = await p.evaluate(() => window.__centre('.kce-connector[data-conn-group="r.2"] .kce-connector-btn'));
  await p.mouse.move(pt.x, pt.y);
  await p.waitForTimeout(250);
  ok('pointing at the OR lights its group', (await judge(OR)).opacity > 0.95, await judge(OR));
  ok('…and not the group inside it', (await judge(NOT)).opacity < 0.6, await judge(NOT));
  pt = await p.evaluate(() => window.__centre('.kce-connector[data-conn-group="r.2.2"] .kce-connector-btn'));
  await p.mouse.move(pt.x, pt.y);
  await p.waitForTimeout(250);
  ok('moving to the inner AND hands the light over',
    (await judge(NOT)).opacity > 0.95 && (await judge(OR)).opacity < 0.6);
  await park();
  ok('leaving puts both back', (await judge(NOT)).opacity < 0.6 && (await judge(OR)).opacity < 0.6);

  // A bracket does the same.
  pt = await p.evaluate(() => window.__centre('.kce-paren-close[data-node="r.2"]'));
  await p.mouse.move(pt.x, pt.y);
  await p.waitForTimeout(250);
  ok('pointing at a closing bracket lights its group', (await judge(OR)).opacity > 0.95);
  await park();

  // So does keyboard focus on the AND / OR.
  await p.evaluate(() => document.querySelector('.kce-connector[data-conn-group="r.2.2"] .kce-connector-btn').focus());
  await p.waitForTimeout(250);
  ok('focusing the AND / OR lights its group', (await judge(NOT)).opacity > 0.95);
  await p.evaluate(() => document.activeElement.blur());

  // Guides follow lines that move under a preview: hovering an add button
  // inserts a ghost line, and the guides must still span their rows.
  await p.evaluate(() => { const r = Array.from(document.querySelectorAll('.kce-condition')).find((x) => x.querySelector('.kce-input').value === 'high'); r.scrollIntoView(); });
  const hb = await p.evaluate(() => {
    const r = Array.from(document.querySelectorAll('.kce-condition')).find((x) => x.querySelector('.kce-input').value === 'high');
    const s = r.querySelector('.kce-sel-field').getBoundingClientRect();
    return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  });
  await p.mouse.move(hb.x, hb.y);
  await p.waitForTimeout(200);
  pt = await p.evaluate(() => window.__centre('[data-fk="r.2:add-or-0"]'));
  await p.mouse.move(pt.x, pt.y);
  await p.waitForTimeout(250);
  const ghost = await p.evaluate(() => !!document.querySelector('.kce-ghost'));
  ok('a preview ghost is up', ghost);
  const during = await judge(OR);
  ok('guides re-place around a preview ghost', during && during.exact && during.spans && during.excludes, during);
  await park();
  const after = await judge(OR);
  ok('…and back when it goes', after && after.exact && after.spans && after.excludes, after);

  // The rule itself has no brackets, but pointing at one of its AND / OR
  // draws its line down the whole rule — hidden at rest. Reported from
  // KAStrack: "a AND b AND c" showed no line at all, and in
  // "a AND b AND (c OR d)" the top-level ANDs showed nothing.
  const FLAT = { version: '1.0', root: { type: 'group', operator: 'and', children: [c('a', 'a'), c('a', 'b'), c('a', 'c')] } };
  const MIXED = { version: '1.0', root: { type: 'group', operator: 'and', children: [
    c('a', 'a'), c('a', 'b'), { type: 'group', operator: 'or', children: [c('p', 'c'), c('p', 'd')] }] } };
  const rootGuide = (rows) => p.evaluate((rows) => {
    const g = document.querySelector('.kce-guide-root');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const all = Array.from(document.querySelectorAll('.kce-condition'));
    const rowsMid = all.map((x) => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; });
    const textLeft = Math.min.apply(null, all.map((x) => x.querySelector('.kce-sel-field .kce-sel-label').getBoundingClientRect().left));
    const parens = Array.from(document.querySelectorAll('.kce-paren')).map((x) => x.getBoundingClientRect());
    return {
      opacity: parseFloat(getComputedStyle(g).opacity),
      spansAll: rowsMid.length === rows && rowsMid.every((y) => y >= r.top && y <= r.bottom),
      clear: r.right <= textLeft - 4 && parens.every((q) => r.right <= q.left || r.left >= q.right),
      colour: getComputedStyle(g).backgroundColor
    };
  }, rows);

  for (const [name, d, rows] of [['a AND b AND c', FLAT, 3], ['a AND b AND (c OR d)', MIXED, 4]]) {
    await p.evaluate(([doc]) => window.__mk(doc, { skin: 'prose' }), [d]);
    await park();
    const rest = await rootGuide(rows);
    ok(`${name}: the rule's line exists, hidden at rest`, rest && rest.opacity < 0.05, rest);
    pt = await p.evaluate(() => window.__centre('.kce-connector[data-conn-group="r"] .kce-connector-btn'));
    await p.mouse.move(pt.x, pt.y);
    await p.waitForTimeout(250);
    const lit = await rootGuide(rows);
    ok(`${name}: pointing at a top-level AND draws it down the whole rule`, lit && lit.opacity > 0.95 && lit.spansAll, lit);
    ok(`${name}: clear of the text and the brackets`, lit && lit.clear, lit);
    if (name !== 'a AND b AND c') {
      ok(`${name}: …and does not light the OR group's line`, (await judge(['r.2', ['c', 'd'], ['b']])).opacity < 0.6);
      pt = await p.evaluate(() => window.__centre('.kce-connector[data-conn-group="r.2"] .kce-connector-btn'));
      await p.mouse.move(pt.x, pt.y);
      await p.waitForTimeout(250);
      ok(`${name}: pointing at the OR lights its line, not the rule's`,
        (await judge(['r.2', ['c', 'd'], ['b']])).opacity > 0.95 && (await rootGuide(rows)).opacity < 0.05);
    }
    await park();
    ok(`${name}: leaving hides it again`, (await rootGuide(rows)).opacity < 0.05);
  }
  ok('a rule of one condition has no line to draw',
    await p.evaluate(([doc]) => { window.__mk(doc, { skin: 'prose' }); return document.querySelectorAll('.kce-guide-root').length; },
      [{ version: '1.0', root: { type: 'group', operator: 'and', children: [c('a', 'solo')] } }]) === 0);

  // The option, and the layouts that do not use guides.
  ok('groupGuides: false draws none', await p.evaluate(([d]) => window.__mk(d, { skin: 'prose', groupGuides: false }), [RULE]) === 0);
  ok('tree skins draw their own group edges, and no guides',
    await p.evaluate(([d]) => window.__mk(d, { skin: 'equation' }), [RULE]) === 0);

  finish(errs);
  await b.close();
  site.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
