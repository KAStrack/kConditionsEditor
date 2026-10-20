/*
 * Redundant brackets are taken out the moment they would appear.
 *
 * Reported from real use: removing a group's sibling left the group alone in
 * its own brackets, so `AND[ OR[ AND[a, b, OR[e, f]] ], d ]` drew two extra
 * pairs and pushed the last AND out to the left of everything above it.
 *
 * Driven the way a person gets there — a real × click and a real AND / OR
 * click — and judged by the brackets actually painted, the document written to
 * the field, a single undo step, and the rule still evaluating the same for
 * every combination of inputs.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ name: n, label: n.toUpperCase(), type: 'text' }));
const c = (f) => ({ type: 'condition', field: f, operator: 'eq', values: [{ source: 'literal', value: 'y' }] });
const g = (operator, children, negate) => ({ type: 'group', operator, negate: !!negate, children });
const doc = (root) => ({ version: '1.0', root });

// The reported shape, as it was on screen.
const REPORTED = doc(g('and', [g('or', [g('and', [c('a'), c('b'), g('or', [c('e'), c('f')])])]), c('d')]));
// How it got there: the OR group had a second child, and it was removed.
const BEFORE_REMOVAL = doc(g('and', [g('or', [g('and', [c('a'), c('b'), g('or', [c('e'), c('f')])]), c('c')]), c('d')]));

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; background: #fff; } #box { width: 760px; }</style>
</head><body><div id="box"></div>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
</body></html>`;

function install(FIELDS) {
  window.__mk = function (d, opts) {
    if (window.__ed) window.__ed.destroy();
    const box = document.getElementById('box');
    box.innerHTML = '<textarea id="t"></textarea>';
    box.querySelector('#t').value = JSON.stringify(d);
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
    window.__ed.setOpen(true);
  };
  // The rule's shape, compactly: and[a,b,or[e,f]], with ! for NOT.
  window.__shape = function (n) {
    n = n || JSON.parse(document.getElementById('t').value).root;
    if (n.type === 'condition') return (n.negate ? '!' : '') + n.field;
    return (n.negate ? '!' : '') + (n.operator || 'and') + '[' + n.children.map(window.__shape).join(',') + ']';
  };
  // Opening brackets a reader can see: hit-tested, not counted in markup.
  window.__painted = function () {
    return Array.from(document.querySelectorAll('.kce-tree .kce-paren-open')).filter(function (p) {
      const r = p.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === p || p.contains(hit));
    }).length;
  };
  // Same result for every combination of inputs.
  window.__sameResults = function (a, b) {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let m = 0; m < 64; m++) {
      const data = {};
      names.forEach(function (n, i) { data[n] = (m >> i) & 1 ? 'y' : 'n'; });
      if (KConditions.evaluate(a, data) !== KConditions.evaluate(b, data)) return false;
    }
    return true;
  };
}

(async () => {
  const site = await serve();
  scratch('redundant-brackets.html', PAGE);
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = watchErrors(p, []);
  const { ok, finish } = checker();

  await p.goto(site.url + scratch.url('redundant-brackets.html'));
  await p.evaluate(install, FIELDS);
  const shape = () => p.evaluate(() => window.__shape());
  const painted = () => p.evaluate(() => window.__painted());
  const written = () => p.evaluate(() => JSON.parse(document.getElementById('t').value));
  const same = (a, b) => p.evaluate(([x, y]) => window.__sameResults(x, y), [a, b]);
  const park = async () => { await p.mouse.move(890, 890); await p.waitForTimeout(120); };

  // 1. The reported rule, loaded as it was saved: drawn without the extra pairs.
  await p.evaluate((d) => window.__mk(d), REPORTED);
  ok('a saved rule with redundant brackets loads without them', await shape() === 'and[a,b,or[e,f],d]', await shape());
  ok('only the OR group is bracketed on screen', await painted() === 1, await painted());
  ok('loading changes nothing it evaluates to', await same(REPORTED, await written()));

  // 2. How it happened: × on the OR group's second child.
  for (const placement of ['below', 'inline']) {
    await p.evaluate(([d, cp]) => window.__mk(d, { connectorPlacement: cp }), [BEFORE_REMOVAL, placement]);
    ok(placement + ': the starting rule is as built', await shape() === 'and[or[and[a,b,or[e,f]],c],d]', await shape());
    const row = p.locator('.kce-condition[data-node="r.0.1"]');
    await row.hover();
    // Found by its focus key: on hover the × may sit in the add strip, not the row.
    await p.locator('[data-fk="r.0.1:rm"]').click({ timeout: 5000 });
    await park();
    ok(placement + ': removing the sibling leaves no group of one and no AND inside AND',
      await shape() === 'and[a,b,or[e,f],d]', await shape());
    ok(placement + ': one bracket pair painted after the removal', await painted() === 1, await painted());
    // Focus is wherever the click left it, which is what a person has.
    await p.keyboard.press('Control+z');
    await park();
    ok(placement + ': one undo brings the removed condition back',
      await shape() === 'and[or[and[a,b,or[e,f]],c],d]', await shape());
  }

  // 3. Flipping a group's OR to its parent's AND folds it into the parent.
  const FLIP = doc(g('and', [c('a'), g('or', [c('b'), c('c')]), c('d')]));
  await p.evaluate((d) => window.__mk(d), FLIP);
  const conn = p.locator('.kce-connector[data-conn-group="r.1"] .kce-connector-btn').first();
  await p.locator('.kce-condition[data-node="r.1.0"]').hover();
  await conn.click({ timeout: 5000 });
  await park();
  ok('an OR group switched to AND inside an AND joins its parent', await shape() === 'and[a,b,c,d]', await shape());
  ok('no brackets painted after the switch', await painted() === 0, await painted());

  // 4. NOT is kept wherever it is carried by the brackets.
  const cases = [
    // [label, document, options, expected shape]
    ['a negated group sharing its parent\'s AND keeps its brackets',
      doc(g('and', [c('a'), g('and', [c('b'), c('c')], true)])), {}, 'and[a,!and[b,c]]'],
    ['NOT on a group of one condition stays a group when conditions cannot be negated',
      doc(g('and', [c('a'), g('or', [c('b')], true)])), {}, 'and[a,!or[b]]'],
    ['NOT on a group of one condition moves to the condition when it can carry it',
      doc(g('and', [c('a'), g('or', [c('b')], true)])), { allowConditionNegate: true }, 'and[a,!b]'],
    ['NOT on a group of one group moves to the inner group',
      doc(g('and', [c('a'), g('and', [g('or', [c('b'), c('c')])], true)])), {}, 'and[a,!or[b,c]]'],
    ['two NOTs on a group of one cancel',
      doc(g('and', [c('a'), g('and', [g('or', [c('b'), c('c')], true)], true)])), {}, 'and[a,or[b,c]]'],
    ['a root holding only one group adopts it',
      doc(g('or', [g('and', [c('a'), c('b')])])), {}, 'and[a,b]'],
    ['a root holding only a negated group keeps it',
      doc(g('and', [g('or', [c('a'), c('b')], true)])), {}, 'and[!or[a,b]]'],
    ['a root holding one condition is left alone',
      doc(g('or', [c('a')])), {}, 'or[a]'],
    ['an empty group is dropped',
      doc(g('and', [c('a'), g('or', []), c('b')])), {}, 'and[a,b]'],
    ['groups of one nested deep collapse all the way',
      doc(g('and', [g('or', [g('and', [g('or', [c('a'), c('b')])])]), c('c')])), {}, 'and[or[a,b],c]']
  ];
  for (const [label, d, opts, want] of cases) {
    await p.evaluate(([x, o]) => window.__mk(x, o), [d, opts]);
    const got = await shape();
    ok(label, got === want, { got, want });
    ok(label + ' — and evaluates the same', await same(d, await written()));
  }

  // 5. Shapes that are not redundant are left exactly as they are.
  const KEEP = doc(g('and', [c('a'), g('or', [c('b'), g('and', [c('c'), c('d')])]), c('e')]));
  await p.evaluate((d) => window.__mk(d), KEEP);
  ok('alternating AND / OR nesting is untouched', await shape() === 'and[a,or[b,and[c,d]],e]', await shape());

  await browser.close();
  site.close();
  finish(errs);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
