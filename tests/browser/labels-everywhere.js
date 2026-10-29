/*
 * Every word the editor shows, says or puts in a tooltip comes from `labels`.
 *
 * Each label is replaced with a marker naming its key — ‹edit›, ‹op:eq›,
 * ‹grp:date›, ‹prob:unknownField "{field}"› — and the editor is driven
 * through the states a person meets: a rule with every kind of value, the
 * add previews, the clear question, the note after brackets go (and the live
 * region that reads it out), undo and redo, an incomplete rule, the notice for
 * a field it could not read, the source toggle, the JSON box, the debug panel
 * and the collapsed summary. Then every text node and every aria-label,
 * title, placeholder, option and optgroup in the editor is read, and anything
 * left after taking out the markers, the rule's own data and punctuation is
 * a string that bypassed `labels` — which is a string a translated host
 * cannot translate.
 *
 * Both layouts: prose (flow) and boxed (tree), which draw different controls.
 * The debug panel's body is developer output (SQL, JSON) and is not read.
 *
 *   node tests/browser/run.js labels-everywhere
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'status', label: 'Statusfält', choices: { new: 'Nyval', accepted: 'Antagenval' } },
  { name: 'name', label: 'Namnfält' },
  { name: 'rating', label: 'Betygfält', type: 'number', comparableWith: ['score'] },
  { name: 'score', label: 'Poängfält', type: 'number' },
  { name: 'arrival', label: 'Ankomstfält', type: 'date', group: 'Ansökangrupp' },
  { name: 'typed', label: 'Datumtextfält', type: 'date', input: { type: 'text' }, group: 'Ansökangrupp' },
  { name: 'weeks', label: 'Veckorfält', type: 'list', group: 'Ansökangrupp', choices: { w1: 'Veckaett', w2: 'Veckatvå' } },
  { name: 'tags', label: 'Taggfält', type: 'list', group: 'Personalgrupp' }
];
// Every word the rule itself contributes, which is data, not interface.
const DATA = ['Statusfält', 'Nyval', 'Antagenval', 'Namnfält', 'Betygfält', 'Poängfält', 'Ankomstfält',
  'Datumtextfält', 'Ansökangrupp', 'Veckorfält', 'Veckaett', 'Veckatvå', 'Taggfält', 'Personalgrupp',
  'ghostfield', 'bogus', 'textvärde', 'taggvärde', 'WHERE status'];

const lit = (v) => ({ source: 'literal', value: v });
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'status', operator: 'eq', values: [lit('accepted')] },
  { type: 'condition', field: 'arrival', operator: 'date_within_last_days', values: [lit(7)] },
  { type: 'condition', field: 'typed', operator: 'date_before', values: [lit('')] },
  { type: 'condition', field: 'name', operator: 'contains', values: [lit('textvärde')], negate: true },
  { type: 'group', operator: 'or', negate: true, children: [
    { type: 'condition', field: 'weeks', operator: 'includes_any', values: [lit(['w2'])] },
    { type: 'condition', field: 'tags', operator: 'includes_all', values: [lit(['taggvärde'])] },
    { type: 'condition', field: 'rating', operator: 'between', values: [lit(3), lit(5)] },
    { type: 'condition', field: 'rating', operator: 'gt', values: [{ source: 'field', field: 'score' }] }
  ] }
] } };

const BAD_DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'ghostfield', operator: 'eq', values: [lit(1)] },
  { type: 'condition', field: 'name', operator: 'bogus', values: [] }
] } };

const page = (skin, ks) => `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>labels</title>
${ks ? '<link rel="stylesheet" href="tests/browser/vendor/kselect/kselect.min.css"><script src="tests/browser/vendor/kselect/kselect.min.js"></script>' : ''}
<link rel="stylesheet" href="src/k-conditions-editor.css"><link rel="stylesheet" href="src/k-conditions-skins.css">
<script src="src/k-conditions-evaluator.js"></script><script src="src/k-conditions-sql.js"></script>
<script src="src/k-conditions-editor.js"></script></head><body>
<textarea id="t"></textarea><textarea id="u">WHERE status = 1</textarea>
<script>
// Every key becomes a marker naming it; templates keep their placeholders, so
// a filled one still shows which key it came from.
var d = KConditionsEditor.defaultLabels();
var labels = {};
Object.keys(d).forEach(function (k) {
  if (typeof d[k] !== 'string') return;
  var holes = (d[k].match(/\\{[a-z]+\\}/gi) || []).join(' ');
  labels[k] = '‹' + k + (holes ? ' ' + holes : '') + '›';
});
labels.operators = {}; labels.groups = {}; labels.problems = {};
Object.keys(d.operators).forEach(function (k) {
  labels.operators[k] = d.operators[k].indexOf('{value}') === -1 ? '‹op:' + k + '›' : '‹op:' + k + '› {value} ‹tail:' + k + '›';
});
Object.keys(d.groups).forEach(function (k) { labels.groups[k] = '‹grp:' + k + '›'; });
Object.keys(d.problems).forEach(function (k) {
  var holes = (d.problems[k].match(/\\{[a-z]+\\}/gi) || []).join(' ');
  labels.problems[k] = '‹prob:' + k + (holes ? ' ' + holes : '') + '›';
});
document.getElementById('t').value = ${JSON.stringify(JSON.stringify(DOC))};
var common = { fields: ${JSON.stringify(FIELDS)}, labels: labels, skin: '${skin}', controls: 'always', allowConditionNegate: true };
window.ed = KConditionsEditor.attach('#t', Object.assign({ startOpen: true, hideTextarea: 'toggle', showJson: true, debug: true }, common));
window.other = KConditionsEditor.attach('#u', Object.assign({ summaryHtml: true }, common));
</script></body></html>`;

/** Every string in the editors that a person can see, hear or hover. */
function harvest() {
  const out = [];
  const roots = document.querySelectorAll('.kce');
  roots.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement;
      // Developer output, and the field's own content, are not interface.
      if (host.closest('.kce-devtools-body, .kce-json, .kce-preserved-source')) continue;
      if (n.nodeValue.trim()) out.push({ where: host.className || host.tagName, text: n.nodeValue });
    }
    root.querySelectorAll('[aria-label], [title], [placeholder]').forEach((elm) => {
      ['aria-label', 'title', 'placeholder'].forEach((a) => {
        if (elm.hasAttribute(a) && elm.getAttribute(a).trim()) out.push({ where: a + ' on ' + elm.className, text: elm.getAttribute(a) });
      });
    });
    root.querySelectorAll('optgroup').forEach((og) => out.push({ where: 'optgroup', text: og.label }));
  });
  return out;
}

/** What is left of a harvest once the markers, the data and punctuation go. */
function strays(seen) {
  const out = [];
  seen.forEach((s) => {
    // Innermost first: a template's filled placeholder is a marker too.
    let rest = s.text;
    for (let before = null; before !== rest;) { before = rest; rest = rest.replace(/‹[^‹›]*›/g, ' '); }
    DATA.forEach((w) => { rest = rest.split(w).join(' '); });
    rest = rest.replace(/[\s()[\]×↑↓⠿…,.:"'\-0-9]/g, '');
    if (rest) out.push(s.state + ' · ' + s.where + ' · ' + JSON.stringify(s.text));
  });
  return Array.from(new Set(out));
}

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();

  for (const skin of ['prose', 'boxed']) {
    const p = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    watchErrors(p, errs);
    scratch('labels-' + skin + '.html', page(skin));
    await p.goto(site.url + scratch.url('labels-' + skin + '.html'));
    await p.waitForTimeout(150);
    const seen = [];
    const take = async (state) => {
      (await p.evaluate(harvest)).forEach((s) => seen.push(Object.assign({ state }, s)));
    };

    await take('open');
    // The add previews: the ghost row and its words.
    for (const which of ['and', 'or']) {
      await p.hover('.kce-condition >> nth=3');
      await p.locator('.kce-add-' + which).last().hover({ force: true });
      await p.waitForTimeout(150);
      await take('+' + which + ' previewed');
      await p.mouse.move(1, 1);
    }
    // The wrap button's preview.
    const wrap = p.locator('.kce-add-wrap').first();
    if (await wrap.count()) {
      await wrap.hover({ force: true });
      await p.waitForTimeout(150);
      await take('wrap previewed');
      await p.mouse.move(1, 1);
    }
    // The clear question.
    await p.click('.kce-clear-start');
    await take('clear question');
    await p.click('.kce-clear-cancel');
    // Brackets taken out by a change: the note, and the live region.
    await p.evaluate(() => {
      ed.setDocument({ version: '1.0', root: { type: 'group', operator: 'and', children: [
        { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'textvärde' }] },
        { type: 'group', operator: 'or', children: [
          { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'textvärde' }] },
          { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'textvärde' }] }
        ] }
      ] } });
      ed.setGroupOperator(ed.doc.root.children[1], 'and');
    });
    await p.waitForTimeout(100);
    const live = await p.evaluate(() => document.querySelector('.kce-live').textContent);
    ok(skin + ': the live region reads a label', live === '‹bracketsRemoved›', { live });
    await take('tidy note');
    // Undo and redo, enabled.
    await p.evaluate(() => ed.undo());
    await take('after undo');
    // An incomplete rule: every problem through labels.problems.
    await p.evaluate((bad) => ed.setDocument(bad), BAD_DOC);
    await p.waitForTimeout(100);
    const problems = await p.evaluate(() => Array.from(document.querySelectorAll('.kce-problems li')).map((li) => li.textContent));
    ok(skin + ': problems are read from labels.problems, params filled in',
      problems.includes('‹prob:unknownField ghostfield›') && problems.includes('‹prob:unknownOperator bogus›'), { problems });
    await take('incomplete rule');
    // An empty rule: the empty text and the starter.
    await p.evaluate(() => ed.clear());
    await take('empty');
    // The source toggle, the debug panel and its tabs.
    await p.evaluate((d) => ed.setDocument(d), DOC);
    await p.click('.kce-source-toggle');
    await p.click('.kce-devtools-toggle');
    await take('source and debug shown');
    // Collapsed: both summaries.
    await p.click('.kce-done');
    await take('collapsed');

    // What is left once the markers, the data and the punctuation are gone.
    const strays = [];
    seen.forEach((s) => {
      // Innermost first: a template's filled placeholder is a marker too.
      let rest = s.text;
      for (let before = null; before !== rest;) { before = rest; rest = rest.replace(/‹[^‹›]*›/g, ' '); }
      DATA.forEach((w) => { rest = rest.split(w).join(' '); });
      // Punctuation, glyphs and numbers: brackets, ×, arrows, the grip, the
      // ellipsis, the list separators and the values 3 / 5 / 7.
      rest = rest.replace(/[\s()[\]×↑↓⠿…,.:"'\-0-9]/g, '');
      if (rest) strays.push(s.state + ' · ' + s.where + ' · ' + JSON.stringify(s.text));
    });
    const unique = Array.from(new Set(strays));
    ok(skin + ': no string bypasses labels', unique.length === 0, unique.slice(0, 20));
    ok(skin + ': the harvest read something', seen.length > 100, { count: seen.length });
    await p.close();
  }

  // The editor's own kSelect: its words (search, no matches, a tag's remove,
  // the count) come from labels too. Its lists are in the editor's layer, a
  // .kce of its own, which the harvest reads.
  for (const skin of ['prose', 'boxed']) {
    const p = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    watchErrors(p, errs);
    scratch('labels-ks-' + skin + '.html', page(skin, true));
    await p.goto(site.url + scratch.url('labels-ks-' + skin + '.html'));
    await p.waitForTimeout(200);
    const seen = [];
    const take = async (state) => { (await p.evaluate(harvest)).forEach((x) => seen.push(Object.assign({ state }, x))); };
    ok(skin + ' kSelect: in use', await p.evaluate(() => document.querySelectorAll('.kce-sel-ks').length > 3));
    await take('kselect open');
    for (const which of ['.kce-sel-field', '.kce-sel-literal', '.kce-sel-values']) {
      await p.click(`.kce-tree ${which}.kce-sel-ks .ks-control >> nth=0`);
      await p.waitForTimeout(150);
      await take('kselect ' + which + ' list');
      await p.keyboard.type('zzzz');
      await p.waitForTimeout(150);
      await take('kselect ' + which + ' no match');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(100);
    }
    const left = strays(seen);
    ok(skin + ' kSelect: no string bypasses labels', left.length === 0, left.slice(0, 20));
    await p.close();
  }

  await browser.close();
  site.close();
  finish(errs);
})();
