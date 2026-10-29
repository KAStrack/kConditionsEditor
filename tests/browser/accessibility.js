/*
 * axe-core (WCAG 2.1 AA) over the editor, with zero violations allowed.
 *
 * Every skin, in a light theme, theme: 'dark', and a dark reader with no
 * theme set (prefers-color-scheme), with the row controls shown at rest and
 * on hover. Each combination is checked in the states a person actually
 * meets, not only at rest: a row hovered (hover-revealed controls painted),
 * an add button hovered (the ghost row and the preview), the "Clear every
 * condition?" question, the note after brackets were taken out, the collapsed
 * summary, the debug panel and the notice for a field the editor could not
 * read. axe judges what is painted in that state, so a control at opacity 0
 * is only checked where it is shown.
 *
 *   node tests/browser/run.js accessibility
 */
const path = require('path');
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const AXE = require.resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const FIELDS = [
  { name: 'status', label: 'Status', choices: { new: 'New', accepted: 'Accepted' } },
  { name: 'name', label: 'Name' },
  { name: 'rating', label: 'Rating', type: 'number', comparableWith: ['score'] },
  { name: 'score', label: 'Score', type: 'number' },
  { name: 'arrival', label: 'Arrival', type: 'date', group: 'Application' },
  { name: 'weeks', label: 'Weeks', type: 'list', group: 'Application', choices: { w1: 'Week 1', w2: 'Week 2', w4: 'Week 4' } },
  { name: 'tags', label: 'Tags', type: 'list', group: 'Staff' }
];

const lit = (v) => ({ source: 'literal', value: v });
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'status', operator: 'eq', values: [lit('accepted')] },
  { type: 'condition', field: 'arrival', operator: 'date_within_last_days', values: [lit(7)] },
  { type: 'condition', field: 'name', operator: 'contains', values: [lit('')] },
  { type: 'group', operator: 'or', negate: true, children: [
    { type: 'condition', field: 'weeks', operator: 'includes_any', values: [lit(['w2', 'w4'])] },
    { type: 'condition', field: 'tags', operator: 'includes_all', values: [lit(['a'])] },
    { type: 'condition', field: 'rating', operator: 'between', values: [lit(3), lit(5)] },
    { type: 'condition', field: 'rating', operator: 'gt', values: [{ source: 'field', field: 'score' }] }
  ] }
] } };

const SKINS = ['prose', 'equation', 'blackboard', 'ledger', 'boxed'];
const THEMES = [
  { name: 'light', theme: 'light', scheme: 'light', bg: '#ffffff' },
  { name: 'dark', theme: 'dark', scheme: 'light', bg: '#171a1f' },
  { name: 'scheme-dark', theme: null, scheme: 'dark', bg: '#171a1f' }
];

function page(skin, t, controls, ks) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>axe</title>
${ks ? '<link rel="stylesheet" href="tests/browser/vendor/kselect/kselect.min.css"><script src="tests/browser/vendor/kselect/kselect.min.js"></script>' : ''}
<link rel="stylesheet" href="src/k-conditions-editor.css"><link rel="stylesheet" href="src/k-conditions-skins.css">
<script src="src/k-conditions-evaluator.js"></script><script src="src/k-conditions-sql.js"></script>
<script src="src/k-conditions-editor.js"></script></head>
<body style="background:${t.bg};color:${t.name === 'light' ? '#1d2530' : '#e6e9ee'};margin:0;padding:16px">
<main><h1 style="font-size:1rem">Rule</h1>
<label for="t">Rule</label><textarea id="t"></textarea>
<label for="u">Unreadable</label><textarea id="u">WHERE status = 'new'</textarea></main>
<script>
document.getElementById('t').value = ${JSON.stringify(JSON.stringify(DOC))};
var common = { fields: ${JSON.stringify(FIELDS)}, skin: '${skin}', theme: ${t.theme ? `'${t.theme}'` : 'null'},
  controls: '${controls}', allowConditionNegate: true };
window.ed = KConditionsEditor.attach('#t', Object.assign({ startOpen: true, hideTextarea: 'toggle', showJson: true, debug: true }, common));
window.collapsed = KConditionsEditor.attach('#u', Object.assign({ summaryHtml: true }, common));
</script></body></html>`;
}

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();

  // Findings in kSelect's own markup, not the editor's: its open list
  // (role=listbox) holds a live region and, when grouped, a group toggle
  // button, which a listbox may not contain. Reported upstream (kselect.js);
  // exempted here only on the list itself, and printed, so it stays seen.
  const KSELECT_UPSTREAM = [{ id: 'aria-required-children', target: /ks-dropdown/ }];
  const noted = new Set();

  async function audit(p, label) {
    let violations = await p.evaluate(async (tags) => {
      const r = await window.axe.run(document.querySelectorAll('.kce').length > 1
        ? { include: Array.prototype.map.call(document.querySelectorAll('.kce'), (n) => [n]) }
        : document.querySelector('.kce'), { runOnly: { type: 'tag', values: tags } });
      return r.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(' ') + ' — ' +
          ((n.any[0] && n.any[0].message) || n.failureSummary || '').slice(0, 140))
      }));
    }, TAGS);
    violations = violations.map((v) => {
      const upstream = KSELECT_UPSTREAM.filter((u) => u.id === v.id)[0];
      if (!upstream) return v;
      const ours = v.nodes.filter((n) => !upstream.target.test(n.split(' — ')[0]));
      if (ours.length !== v.nodes.length && !noted.has(v.id)) {
        noted.add(v.id);
        console.log('NOTE kSelect upstream: ' + v.id + ' on its open list — ' + v.nodes[0].split(' — ')[1]);
      }
      return ours.length ? { id: v.id, nodes: ours } : null;
    }).filter(Boolean);
    ok(label + ': no axe violations', violations.length === 0, violations);
  }

  for (const skin of SKINS) {
    for (const t of THEMES) {
      for (const controls of ['hover', 'always']) {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, colorScheme: t.scheme });
        const p = await ctx.newPage();
        watchErrors(p, errs);
        const name = `a11y-${skin}-${t.name}-${controls}.html`;
        scratch(name, page(skin, t, controls));
        await p.goto(site.url + scratch.url(name));
        await p.addScriptTag({ path: AXE });
        await p.waitForTimeout(150);
        const tag = `${skin} / ${t.name} / ${controls}`;

        // At rest, then with a row hovered so its hidden controls are painted.
        await audit(p, tag + ' / at rest');
        await p.hover('.kce-condition >> nth=1');
        await p.waitForTimeout(200);
        await audit(p, tag + ' / row hovered');

        // An add button hovered: the ghost row and the preview are painted.
        // In the tree skins the strip is revealed from the row above it.
        // Both colours: each has its own hover tint.
        for (const which of ['and', 'or']) {
          await p.hover('.kce-condition >> nth=2');
          await p.waitForTimeout(150);
          const add = p.locator('.kce-add-' + which).first();
          if (await add.count()) {
            await add.hover({ force: true });
            await p.waitForTimeout(200);
            await audit(p, tag + ' / +' + which.toUpperCase() + ' previewed');
          }
          await p.mouse.move(1, 1);
          await p.waitForTimeout(100);
        }

        // "Clear every condition?"
        await p.click('.kce-clear-start');
        await p.waitForTimeout(100);
        await audit(p, tag + ' / clear question');
        await p.click('.kce-clear-cancel');

        // The note after a change took out brackets: switching the negated
        // group's sibling away leaves… simplest is to un-negate the group,
        // which leaves an OR group inside AND with nothing to keep it.
        await p.evaluate(() => {
          ed.setDocument({ version: '1.0', root: { type: 'group', operator: 'and', children: [
            { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'a' }] },
            { type: 'group', operator: 'or', children: [
              { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'b' }] },
              { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'c' }] }
            ] }
          ] } });
        });
        await p.waitForTimeout(100);
        await p.evaluate(() => {
          const group = ed.doc.root.children[1];
          ed.setGroupOperator(group, 'and');
        });
        await p.waitForTimeout(150);
        const noted = await p.evaluate(() => !!document.querySelector('.kce-tidy-note'));
        ok(tag + ' / the tidy note showed', noted);
        await audit(p, tag + ' / tidy note');

        // The debug panel open.
        await p.click('.kce-devtools-toggle');
        await p.waitForTimeout(100);
        await audit(p, tag + ' / debug panel');

        // Collapsed: the summary, with the unreadable-field notice above it.
        await p.click('.kce-done');
        await p.waitForTimeout(100);
        await audit(p, tag + ' / collapsed with summary');

        await ctx.close();
      }
    }
  }

  // The editor's own kSelect: closed, and with each kind of list open (its
  // list is in the editor's layer, a .kce of its own, which the audit reads).
  for (const skin of ['prose', 'boxed', 'blackboard']) {
    for (const t of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, colorScheme: t.scheme });
      const p = await ctx.newPage();
      watchErrors(p, errs);
      const name = `a11y-kselect-${skin}-${t.name}.html`;
      scratch(name, page(skin, t, 'always', true));
      await p.goto(site.url + scratch.url(name));
      await p.addScriptTag({ path: AXE });
      await p.waitForTimeout(200);
      const tag = `kselect / ${skin} / ${t.name}`;
      ok(tag + ': kSelect is in use', await p.evaluate(() => document.querySelectorAll('.kce-sel-ks').length > 3));
      await audit(p, tag + ' / closed');
      for (const which of ['.kce-sel-field', '.kce-sel-literal', '.kce-sel-values']) {
        await p.click(`.kce-tree ${which}.kce-sel-ks .ks-control >> nth=0`);
        await p.waitForTimeout(200);
        await audit(p, tag + ' / ' + which + ' open');
        await p.keyboard.press('Escape');
        await p.waitForTimeout(100);
      }
      await ctx.close();
    }
  }

  // Translated, in part: a label that names a control must still contain the
  // control's visible text (WCAG 2.5.3) when only some labels are translated,
  // which is how a translation is rolled out.
  for (const skin of ['prose', 'boxed']) {
    const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    watchErrors(p, errs);
    const name = 'a11y-translated-' + skin + '.html';
    scratch(name, page(skin, THEMES[0], 'always').replace("window.ed = KConditionsEditor.attach('#t', Object.assign({",
      "common.labels = { and: 'OCH', or: 'ELLER', not: 'INTE', removeCondition: 'Ta bort villkor', wrapGroup: 'Gruppera allt och fortsätt med {operator}', " +
      "operators: { eq: 'är lika med', date_within_last_days: 'är inom de senaste {value} dagarna' } };\n" +
      "window.ed = KConditionsEditor.attach('#t', Object.assign({"));
    await p.goto(site.url + scratch.url(name));
    await p.addScriptTag({ path: AXE });
    await p.waitForTimeout(150);
    await audit(p, skin + ' / partly translated');
    await p.close();
  }

  await browser.close();
  site.close();
  finish(errs.filter((e) => !/favicon/.test(e)));
})();
