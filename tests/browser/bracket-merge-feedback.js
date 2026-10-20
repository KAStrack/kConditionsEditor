/*
 * When a change takes out brackets, it says so: before the click, after it,
 * and with the way back.
 *
 * 0.0.35 began taking out brackets that do nothing. Switching a group to its
 * parent's AND / OR therefore merges it, and switching back then switches the
 * parent. Ben asked how obvious Undo was when that happens: not very. So:
 *
 *   - the preview: pointing at (or focusing) a control whose click would
 *     merge a group marks that group's brackets as going, in every layout;
 *   - the tint: after the click, the rows that came out of the brackets are
 *     tinted, fading;
 *   - the note: "Removed unneeded brackets · Undo", beside the change where
 *     there is room and in the footer by Undo where there is not.
 *
 * Judged by what is painted: computed colours, hit-testing, positions before
 * and after, and the rule the field ends up holding. Time is driven by the
 * page clock, so the note's and the tint's timers are checked exactly.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'a', label: 'Assigned To', type: 'text' },
  { name: 'b', label: 'Priority', type: 'text' },
  { name: 'c', label: 'Priority', type: 'text' },
  { name: 'd', label: 'Status', type: 'text' }
];
const c = (f, v) => ({ type: 'condition', field: f, operator: 'eq', values: [{ source: 'literal', value: v }] });
const g = (operator, children, negate) => ({ type: 'group', operator, negate: !!negate, children });
const doc = (root) => ({ version: '1.0', root });

// a AND (b OR c) AND d — r.1 is the OR group.
const RULE = doc(g('and', [c('a', 'ben'), g('or', [c('b', 'high'), c('c', 'urgent')]), c('d', 'Open')]));
// a AND NOT (b AND c) — un-negating r.1 merges it.
const NEGATED = doc(g('and', [c('a', 'ben'), g('and', [c('b', 'high'), c('c', 'urgent')], true)]));
// (a AND b) OR c — removing c leaves the AND group alone, so it goes.
const REMOVAL = doc(g('or', [g('and', [c('a', 'ben'), c('b', 'high')]), c('c', 'urgent')]));
// Nothing to merge: switching a flat rule's AND drops no brackets.
const FLAT = doc(g('and', [c('a', 'ben'), c('b', 'high')]));

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
  window.__mk = function (d, opts, width) {
    if (window.__ed) window.__ed.destroy();
    const box = document.getElementById('box');
    box.style.width = (width || 680) + 'px';
    box.innerHTML = '<textarea id="t"></textarea>';
    box.querySelector('#t').value = JSON.stringify(d);
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
    window.__ed.setOpen(true);
  };
  window.__shape = function (n) {
    n = n || JSON.parse(document.getElementById('t').value).root;
    if (n.type === 'condition') return (n.negate ? '!' : '') + n.field;
    return (n.negate ? '!' : '') + (n.operator || 'and') + '[' + n.children.map(window.__shape).join(',') + ']';
  };
  // A colour token as the browser resolves it.
  window.__token = function (name) {
    const s = document.createElement('span');
    s.style.color = 'var(--kce-' + name + ')';
    document.querySelector('.kce').appendChild(s);
    const v = getComputedStyle(s).color;
    s.remove();
    return v;
  };
  window.__marked = function () {
    return Array.from(document.querySelectorAll('.kce-will-unbracket')).map(function (e) {
      return (e.classList.contains('kce-paren') ? 'paren' : e.classList.contains('kce-guide') ? 'guide' : 'group') +
        ':' + (e.getAttribute('data-node') || e.getAttribute('data-group'));
    }).sort();
  };
  window.__parenStyle = function (id) {
    return Array.from(document.querySelectorAll('.kce-paren[data-node="' + id + '"]')).map(function (p) {
      const cs = getComputedStyle(p);
      return { color: cs.color, line: cs.textDecorationLine, opacity: cs.opacity };
    });
  };
  window.__rects = function () {
    return Array.from(document.querySelectorAll('.kce-condition, .kce-connector-btn, .kce-paren')).map(function (e) {
      const r = e.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width)].join(',');
    }).join(' ');
  };
  window.__centre = function (sel) {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  // Painted: the centre of the element hit-tests to it or inside it.
  window.__painted = function (sel) {
    const e = document.querySelector(sel);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || parseFloat(getComputedStyle(e).opacity) < 0.5) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === e || e.contains(hit));
  };
  // The controls a note must not touch, judged as no-overlaps.js judges them.
  window.__noteOverlaps = function () {
    const note = document.querySelector('.kce-tree .kce-tidy-note');
    if (!note) return [];
    const n = note.getBoundingClientRect();
    const visible = function (e) {
      let o = 1;
      for (let x = e; x && x.nodeType === 1; x = x.parentElement) o *= parseFloat(getComputedStyle(x).opacity);
      return o > 0.5;
    };
    return Array.from(document.querySelectorAll(
      '.kce-add, .kce-icon-btn:not(:disabled), .kce-connector-btn, .kce-grip, .kce-paren, .kce-sel-label, .kce-tree .kce-input'))
      .filter(function (e) {
        const r = e.getBoundingClientRect();
        return r.width && r.height && visible(e) &&
          r.left < n.right - 1 && r.right > n.left + 1 && r.top < n.bottom - 1 && r.bottom > n.top + 1;
      })
      .map(function (e) { return e.className.split(' ')[0] + '(' + e.textContent.trim().slice(0, 8) + ')'; });
  };
}

(async () => {
  const site = await serve();
  scratch('bracket-merge-feedback.html', PAGE);
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = watchErrors(p, []);
  const { ok, finish } = checker();

  await p.clock.install();
  await p.goto(site.url + scratch.url('bracket-merge-feedback.html'));
  await p.evaluate(install, FIELDS);

  const mk = (d, opts, width) => p.evaluate(([x, o, w]) => window.__mk(x, o, w), [d, opts || {}, width]);
  const shape = () => p.evaluate(() => window.__shape());
  const marked = () => p.evaluate(() => window.__marked());
  const rects = () => p.evaluate(() => window.__rects());
  const centre = (sel) => p.evaluate((s) => window.__centre(s), sel);
  const painted = (sel) => p.evaluate((s) => window.__painted(s), sel);
  const park = async () => { await p.mouse.move(890, 690); await p.clock.runFor(150); };
  // Point at a row first, so its line's controls are revealed, then at the control.
  const point = async (rowSel, sel) => {
    const r = await centre(rowSel);
    await p.mouse.move(r.left + 6, r.y);
    await p.clock.runFor(50);
    const at = await centre(sel);
    await p.mouse.move(at.x, at.y);
    await p.clock.runFor(50);
    return at;
  };
  const danger = await (async () => { await mk(RULE); return p.evaluate(() => window.__token('danger')); })();

  /* ---------------- 1. the preview ---------------- */

  for (const placement of ['below', 'inline']) {
    await mk(RULE, { connectorPlacement: placement });
    await park();
    const before = await rects();
    await point('.kce-condition[data-node="r.1.0"]', '.kce-connector[data-conn-group="r.1"] .kce-connector-btn');
    const m = await marked();
    ok(placement + ': pointing at the OR that would merge marks that group\'s brackets and guide',
      JSON.stringify(m) === JSON.stringify(['guide:r.1', 'paren:r.1', 'paren:r.1']), m);
    const ps = await p.evaluate(() => window.__parenStyle('r.1'));
    ok(placement + ': both brackets are painted in the removal colour, struck through, at full strength',
      ps.length === 2 && ps.every((x) => x.color === danger && /line-through/.test(x.line) && x.opacity === '1'), { ps, danger });
    const guide = await p.evaluate(() => getComputedStyle(document.querySelector('.kce-guide[data-group="r.1"]')).backgroundColor);
    ok(placement + ': the group\'s guide is painted in the removal colour', guide === danger, { guide, danger });
    // Re-measure after moving away: the preview may move nothing.
    await park();
    ok(placement + ': the preview moved nothing', await rects() === before);
    ok(placement + ': leaving the button takes the marks away', (await marked()).length === 0, await marked());
  }

  // Switching the parent merges a child that has the other operator.
  await mk(RULE);
  await park();
  await point('.kce-condition[data-node="r.0"]', '.kce-connector[data-conn-group="r"] .kce-connector-btn');
  ok('pointing at the rule\'s own AND marks the OR group it would absorb',
    JSON.stringify(await marked()) === JSON.stringify(['guide:r.1', 'paren:r.1', 'paren:r.1']), await marked());

  // A switch that merges nothing marks nothing.
  await mk(FLAT);
  await park();
  await point('.kce-condition[data-node="r.0"]', '.kce-connector[data-conn-group="r"] .kce-connector-btn');
  ok('a switch that merges nothing marks nothing', (await marked()).length === 0, await marked());

  // Focus previews as hover does.
  await mk(RULE);
  await park();
  await p.evaluate(() => document.querySelector('.kce-connector[data-conn-group="r.1"] .kce-connector-btn').focus());
  ok('focusing the OR marks the brackets too', (await marked()).length === 3, await marked());
  await p.evaluate(() => document.activeElement.blur());
  ok('blurring it takes them away', (await marked()).length === 0, await marked());

  // × on a child whose removal leaves a group of one, in every preview style
  // that paints rows: the removal tint and the bracket marks together, and a
  // fading style does not fade the marked brackets.
  for (const previewStyle of ['bar', 'fade', 'highlight']) {
    await mk(REMOVAL, { previewStyle });
    await park();
    await point('.kce-condition[data-node="r.1"]', '[data-fk="r.1:rm"]');
    const m = await marked();
    ok(previewStyle + ': × on the sibling marks the group that would be left alone',
      JSON.stringify(m) === JSON.stringify(['guide:r.0', 'paren:r.0', 'paren:r.0']), m);
    ok(previewStyle + ': and still marks the row being removed',
      await p.evaluate(() => document.querySelector('.kce-condition[data-node="r.1"]').classList.contains('kce-will-remove')));
    const ps = await p.evaluate(() => window.__parenStyle('r.0'));
    ok(previewStyle + ': the marked brackets are not faded', ps.every((x) => x.opacity === '1' && x.color === danger), ps);
  }

  // NOT on a group: switching it off merges the group.
  await mk(NEGATED);
  await park();
  await point('.kce-condition[data-node="r.1.0"]', '[data-fk="r.1:not"]');
  ok('pointing at a group\'s NOT that would merge it marks its brackets',
    JSON.stringify(await marked()) === JSON.stringify(['guide:r.1', 'paren:r.1', 'paren:r.1']), await marked());

  // The tree skins draw brackets on the group's box.
  const TREE = {
    equation: () => getComputedStyle(document.querySelector('.kce-group[data-node="r.1"] > .kce-group-children'), '::before').borderTopColor,
    blackboard: () => getComputedStyle(document.querySelector('.kce-group[data-node="r.1"] > .kce-group-children'), '::before').borderTopColor,
    ledger: () => getComputedStyle(document.querySelector('.kce-group[data-node="r.1"] > .kce-group-children')).borderLeftColor,
    boxed: () => getComputedStyle(document.querySelector('.kce-group[data-node="r.1"]')).borderTopColor
  };
  // Each through the control it shows: equation, blackboard and ledger switch
  // a group with its AND / OR words, boxed with the AND / OR in its header.
  for (const skin of Object.keys(TREE)) {
    await mk(RULE, { skin });
    await park();
    const skinDanger = await p.evaluate(() => window.__token('danger'));
    const rest = await p.evaluate(TREE[skin]);
    const control = skin === 'boxed' ? '[data-fk="r.1:logic-and"]' : '.kce-connector[data-conn-group="r.1"] .kce-connector-btn';
    await point('.kce-condition[data-node="r.1.0"]', control);
    ok(skin + ': pointing at the switch marks the group', JSON.stringify(await marked()) === JSON.stringify(['group:r.1']), await marked());
    const lit = await p.evaluate(TREE[skin]);
    ok(skin + ': and paints its brackets in the removal colour',
      lit === skinDanger && rest !== skinDanger, { rest, lit, skinDanger });
  }

  // Boxed also shows a group's NOT as a checkbox in its header.
  await mk(NEGATED, { skin: 'boxed' });
  await park();
  await point('.kce-condition[data-node="r.1.0"]', '.kce-group[data-node="r.1"] > .kce-group-head .kce-not');
  ok('boxed: pointing at a group\'s NOT that would merge it marks the group',
    JSON.stringify(await marked()) === JSON.stringify(['group:r.1']), await marked());

  // What the preview marks is what the click takes away.
  for (const [label, d, row, sel] of [
    ['the OR', RULE, '.kce-condition[data-node="r.1.0"]', '.kce-connector[data-conn-group="r.1"] .kce-connector-btn'],
    ['the rule\'s AND', RULE, '.kce-condition[data-node="r.0"]', '.kce-connector[data-conn-group="r"] .kce-connector-btn'],
    ['the ×', REMOVAL, '.kce-condition[data-node="r.1"]', '[data-fk="r.1:rm"]'],
    ['the NOT', NEGATED, '.kce-condition[data-node="r.1.0"]', '[data-fk="r.1:not"]']
  ]) {
    await mk(d);
    await park();
    const before = await p.evaluate(() => document.querySelectorAll('.kce-paren').length);
    await point(row, sel);
    const groups = new Set((await marked()).filter((x) => x.startsWith('paren:')).map((x) => x.slice(6))).size;
    await p.mouse.down();
    await p.mouse.up();
    await p.clock.runFor(50);
    const after = await p.evaluate(() => document.querySelectorAll('.kce-paren').length);
    ok('clicking ' + label + ' takes away exactly the brackets it marked', groups > 0 && before - after === groups * 2, { before, after, groups });
  }

  /* ---------------- 2. the tint ---------------- */

  await mk(RULE);
  await park();
  await point('.kce-condition[data-node="r.1.0"]', '.kce-connector[data-conn-group="r.1"] .kce-connector-btn');
  await p.mouse.down();
  await p.mouse.up();
  await p.clock.runFor(20);
  ok('the click merged the group', await shape() === 'and[a,b,c,d]', await shape());
  const flash = await p.evaluate(() => {
    const f = Array.from(document.querySelectorAll('.kce-flash'));
    if (f.length !== 1) return { count: f.length };
    const r = f[0].getBoundingClientRect();
    const inside = (sel) => {
      const e = document.querySelector(sel).getBoundingClientRect();
      const y = e.top + e.height / 2;
      return y > r.top && y < r.bottom;
    };
    return {
      count: 1,
      hue: f[0].classList.contains('is-and'),
      bg: getComputedStyle(f[0]).backgroundColor,
      pointer: getComputedStyle(f[0]).pointerEvents,
      b: inside('.kce-condition[data-node="r.1"]'),
      c: inside('.kce-condition[data-node="r.2"]'),
      a: inside('.kce-condition[data-node="r.0"]'),
      d: inside('.kce-condition[data-node="r.3"]')
    };
  });
  ok('one tint, in the AND colour, over the two rows that came out of the brackets and no others',
    flash.count === 1 && flash.hue && flash.b && flash.c && !flash.a && !flash.d, flash);
  ok('the tint is painted and takes no pointer', flash.bg !== 'rgba(0, 0, 0, 0)' && flash.pointer === 'none', flash);

  /* ---------------- 3. the note ---------------- */

  const note = '.kce-tidy-note';
  ok('the note appears in the tree, beside the change', await p.evaluate(() => !!document.querySelector('.kce-tree .kce-tidy-note')));
  ok('its words are painted', await painted('.kce-tidy-note-text'));
  const level = await p.evaluate(() => {
    const n = document.querySelector('.kce-tidy-note').getBoundingClientRect();
    const conn = document.querySelector('.kce-connector[data-conn-group="r"][data-conn-index="1"] .kce-connector-btn').getBoundingClientRect();
    return { noteMid: (n.top + n.bottom) / 2, connMid: (conn.top + conn.bottom) / 2, gap: n.left - conn.right };
  });
  ok('it sits level with the AND between the two moved rows, just after it',
    Math.abs(level.noteMid - level.connMid) < 2 && level.gap > 0 && level.gap < 40, level);
  ok('it touches no control at rest', (await p.evaluate(() => window.__noteOverlaps())).length === 0, await p.evaluate(() => window.__noteOverlaps()));
  const live = await p.evaluate(() => document.querySelector('.kce-live').textContent);
  ok('a screen reader hears it', live === 'Removed unneeded brackets', live);
  // Every line hovered in turn: what the hover reveals must not land on it.
  const lineCount = await p.evaluate(() => document.querySelectorAll('.kce-condition').length);
  const hovered = [];
  for (let i = 0; i < lineCount; i++) {
    const r = await centre('.kce-condition[data-node="r.' + i + '"]');
    await p.mouse.move(r.left + 6, r.y);
    await p.clock.runFor(30);
    (await p.evaluate(() => window.__noteOverlaps())).forEach((f) => hovered.push('r.' + i + ': ' + f));
  }
  ok('nothing revealed by hovering a line lands on it', hovered.length === 0, hovered);
  // Its Undo is a 24px target.
  const u = await centre('.kce-tidy-note-undo');
  const reach = await p.evaluate(([x, y]) => [-11.5, 11.5].map((dy) => {
    const hit = document.elementFromPoint(x, y + dy);
    return !!hit && hit.classList.contains('kce-tidy-note-undo');
  }), [u.x, u.y]);
  ok('its Undo answers 24px tall', reach.every(Boolean), reach);

  // It waits while pointed at, then goes on its own.
  await park();
  await p.clock.runFor(6000);
  ok('it is still there after 6s', await p.evaluate(() => !!document.querySelector('.kce-tidy-note')));
  ok('the tint has gone by then', await p.evaluate(() => !document.querySelector('.kce-flash')));
  await p.mouse.move(u.x, u.y);
  await p.clock.runFor(20000);
  ok('pointed at, it does not go', await p.evaluate(() => !!document.querySelector('.kce-tidy-note')));
  await park();
  await p.clock.runFor(8500);
  ok('left alone, it goes', await p.evaluate(() => !document.querySelector('.kce-tidy-note')));
  ok('and the screen-reader text with it', await p.evaluate(() => document.querySelector('.kce-live').textContent === ''));

  // Its Undo restores the group, in one step.
  await mk(RULE);
  await park();
  await point('.kce-condition[data-node="r.1.0"]', '.kce-connector[data-conn-group="r.1"] .kce-connector-btn');
  await p.mouse.down();
  await p.mouse.up();
  await p.clock.runFor(20);
  const undoAt = await centre('.kce-tidy-note-undo');
  await p.mouse.click(undoAt.x, undoAt.y);
  await p.clock.runFor(20);
  ok('the note\'s Undo brings the group back', await shape() === 'and[a,or[b,c],d]', await shape());
  ok('and the note goes with it', await p.evaluate(() => !document.querySelector('.kce-tidy-note')));

  // The next change takes it away.
  await mk(RULE);
  await p.evaluate(() => window.__ed.setGroupOperator(window.__ed.doc.root.children[1], 'and'));
  ok('a merge by any route brings up the note', await p.evaluate(() => !!document.querySelector('.kce-tidy-note')));
  await p.evaluate(() => window.__ed.removeNode(window.__ed.doc.root.children[3], window.__ed.doc.root));
  ok('the next change, which merges nothing, takes it away', await p.evaluate(() => !document.querySelector('.kce-tidy-note')));

  // Where there is no room beside the change, it waits in the footer by Undo.
  for (const [label, opts, width] of [['narrow', {}, 380], ['inline', { connectorPlacement: 'inline' }, 680], ['equation', { skin: 'equation' }, 680]]) {
    await mk(RULE, opts, width);
    await p.evaluate(() => window.__ed.setGroupOperator(window.__ed.doc.root.children[1], 'and'));
    const where = await p.evaluate(() => {
      const n = document.querySelector('.kce-tidy-note');
      return n ? { footer: n.parentNode.classList.contains('kce-footer'), next: n.nextElementSibling && n.nextElementSibling.className } : null;
    });
    ok(label + ': the note sits in the footer, just before Undo', where && where.footer && /kce-history/.test(where.next), where);
    ok(label + ': and is painted', await painted('.kce-tidy-note-text'));
    ok(label + ': and nothing overflows the editor', await p.evaluate(() => {
      const box = document.getElementById('box').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.kce *')).every((e) => e.getBoundingClientRect().right <= box.right + 1);
    }));
  }

  // Quiet where nothing was taken from the person: on load, on setDocument,
  // and for the AND(…) / OR(…) button, whose own plan is the merge.
  await mk(doc(g('and', [g('or', [g('and', [c('a', 'x'), c('b', 'y')])]), c('d', 'z')])));
  ok('loading a rule with redundant brackets brings up no note', await p.evaluate(() => !document.querySelector('.kce-tidy-note')));
  await p.evaluate((d) => window.__ed.setDocument(d), doc(g('or', [g('or', [c('a', 'x'), c('b', 'y')])])));
  ok('nor does setDocument()', await p.evaluate(() => !document.querySelector('.kce-tidy-note')));
  await mk(RULE);
  await park();
  await point('.kce-condition[data-node="r.1.1"]', '[data-fk="r.1:wrap-and"]');
  await p.mouse.down();
  await p.mouse.up();
  await p.clock.runFor(20);
  ok('AND(…) merged as planned', await shape() === 'and[a,or[b,c],a,d]', await shape());
  ok('and said nothing about it', await p.evaluate(() => !document.querySelector('.kce-tidy-note') && !document.querySelector('.kce-flash')));

  // With history off there is no Undo to offer, but the note still explains.
  await mk(RULE, { history: false });
  await p.evaluate(() => window.__ed.setGroupOperator(window.__ed.doc.root.children[1], 'and'));
  ok('with history off the note has no Undo', await p.evaluate(() =>
    !!document.querySelector('.kce-tidy-note') && !document.querySelector('.kce-tidy-note-undo')));

  // Reduced motion: no fade, but the tint still goes.
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await mk(RULE);
  await p.evaluate(() => window.__ed.setGroupOperator(window.__ed.doc.root.children[1], 'and'));
  ok('with reduced motion the tint does not animate',
    await p.evaluate(() => getComputedStyle(document.querySelector('.kce-flash')).animationName === 'none'));
  await p.clock.runFor(1700);
  ok('and is still taken away', await p.evaluate(() => !document.querySelector('.kce-flash')));
  await p.emulateMedia({ reducedMotion: 'no-preference' });

  await browser.close();
  site.close();
  finish(errs);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
