/*
 * A text field with its own blank values (`countAsBlank`).
 *
 * KAStrack offers its multi-user fields as text, on the names column, which
 * holds `[]` when nobody is assigned. With `countAsBlank: 'json'` the field
 * must still look and work as a text field — the text operators offered, a
 * text box for their values — while "is not empty" leaves out `[]`. "is set"
 * means the same as "is not empty" there, so it is not offered twice; a rule
 * saved with it still shows it. Judged by the text the shells paint, the
 * document, and the SQL, summary and evaluation the editor's own fields give.
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'Assigned To', label: 'Assigned To', type: 'text', countAsBlank: 'json' },
  { name: 'Phone', label: 'Phone', type: 'text', countAsBlank: ['N/A', '-'] },
  { name: 'Title', label: 'Title', type: 'text' }
];

const cond = (field, operator, values) => ({ type: 'condition', field, operator, values: values || [] });
const doc = (...children) => ({ version: '1.0', root: { type: 'group', operator: 'and', children } });

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="src/k-conditions-editor.css">
<link rel=stylesheet href="src/k-conditions-skins.css">
<body style="font-family:system-ui;padding:20px;width:900px">
<textarea id="ta"></textarea>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-sql.js"></script>
<script src="src/k-conditions-editor.js"></script>
<script>
window.FIELDS = ${JSON.stringify(FIELDS)};
window.load = function (doc, opts) {
  if (window.ed) window.ed.destroy();
  var ta = document.getElementById('ta');
  ta.value = JSON.stringify(doc);
  window.saved = ta.value;
  window.ed = KConditionsEditor.attach('#ta', Object.assign({ fields: FIELDS, startOpen: true, kselect: false }, opts || {}));
};
</script>`;

const VIS = `(el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}`;

const row = (p, i) => p.evaluate(`(() => {
  const vis = ${VIS};
  const r = document.querySelectorAll('.kce-condition')[${i}];
  const shell = (cls) => r.querySelector('.kce-sel-' + cls);
  const op = shell('operator') && shell('operator').querySelector('select');
  const input = r.querySelector('input.kce-literal');
  return {
    field: shell('field') && shell('field').querySelector('.kce-sel-label').textContent,
    operator: shell('operator') && shell('operator').querySelector('.kce-sel-label').textContent,
    operatorPainted: vis(shell('operator')),
    offered: op ? [...op.options].map(o => o.value) : [],
    textBox: !!input && vis(input),
    valueSelect: !!r.querySelector('.kce-value select, select.kce-tag-input'),
    fieldValueUnchanged: JSON.stringify(JSON.parse(document.getElementById('ta').value).root) ===
      JSON.stringify(JSON.parse(window.saved).root)
  };
})()`);

(async () => {
  const site = await serve();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  const errs = watchErrors(p, []);
  const { ok, finish } = checker();
  scratch('count-as-blank.html', PAGE);
  await p.goto(site.url + scratch.url('count-as-blank.html'));

  /* 1. The KAStrack rule: "is not empty" on the names column. */
  await p.evaluate((d) => window.load(d), doc(cond('Assigned To', 'is_not_empty')));
  let r = await row(p, 0);
  ok('the rule loads as "is not empty"', r.operator === 'is not empty' && r.operatorPainted, r);
  ok('loading it leaves the rule in the field as it was', r.fieldValueUnchanged, r);
  ok('the text operators are offered, as for any text field', ['eq', 'contains', 'starts_with', 'is_empty', 'is_not_empty'].every((o) => r.offered.includes(o)), r);
  ok('"is set" and "is not set" are not offered twice over', !r.offered.includes('is_set') && !r.offered.includes('is_not_set'), r);
  let out = await p.evaluate(() => {
    const d = window.ed.getDocument();
    return {
      sql: window.ed.getSql({ dialect: 'mysql' }).sql,
      text: window.ed.describe(),
      nobody: KConditions.evaluate(d, { 'Assigned To': '[]' }, { fields: window.FIELDS }),
      ben: KConditions.evaluate(d, { 'Assigned To': '["Ben Holness"]' }, { fields: window.FIELDS })
    };
  });
  ok('its SQL leaves out [] and every other spelling of empty',
    out.sql === "(`Assigned To` IS NOT NULL AND CAST(CAST(`Assigned To` AS CHAR) AS BINARY) NOT IN ('', '[]', '[\"[]\"]', '[\"\"]', '[null]', 'null', '\"[]\"', '\"\"', '\"[\\\\\"\\\\\"]\"'))", out);
  ok('the summary reads as before', out.text === '[Assigned To] is not empty', out);
  ok('the evaluator agrees, from the same fields', out.nobody === false && out.ben === true, out);

  /* 2. A text operator: a text box, and SQL on the raw text. */
  await p.locator('.kce-condition .kce-sel-operator select').selectOption('contains');
  await p.locator('.kce-condition input.kce-literal').fill('Ben');
  await p.locator('.kce-condition input.kce-literal').blur();
  r = await row(p, 0);
  ok('"contains" takes a text box, not a picker', r.operator === 'contains' && r.textBox && !r.valueSelect, r);
  out = await p.evaluate(() => ({ sql: window.ed.getSql({ dialect: 'mysql' }).sql }));
  ok('its SQL is the plain LIKE, nothing refused', out.sql === "`Assigned To` LIKE '%Ben%' ESCAPE '\\\\'", out);

  /* 3. A saved "is set" still shows; choosing another operator drops it. */
  await p.evaluate((d) => window.load(d), doc(cond('Phone', 'is_set')));
  r = await row(p, 0);
  ok('a saved "is set" shows "is set", not the first operator', r.operator === 'is set' && r.operatorPainted, r);
  ok('…and is not changed by loading', r.fieldValueUnchanged, r);
  out = await p.evaluate(() => ({ sql: window.ed.getSql({ dialect: 'mysql' }).sql }));
  ok('…and its SQL is the "is not empty" test, with the host\'s values',
    out.sql === "(`Phone` IS NOT NULL AND CAST(CAST(`Phone` AS CHAR) AS BINARY) NOT IN ('', 'N/A', '-'))", out);
  await p.locator('.kce-condition .kce-sel-operator select').selectOption('is_empty');
  r = await row(p, 0);
  ok('choosing "is empty" replaces it, and "is set" goes from the list', r.operator === 'is empty' && !r.offered.includes('is_set'), r);

  /* 4. A field without the option is untouched. */
  await p.evaluate((d) => window.load(d), doc(cond('Title', 'is_not_empty')));
  r = await row(p, 0);
  ok('a text field without the option still offers "is set"', r.offered.includes('is_set') && r.offered.includes('is_not_set'), r);
  out = await p.evaluate(() => ({ sql: window.ed.getSql({ dialect: 'mysql' }).sql }));
  ok('…and its SQL is as it was', out.sql === "(`Title` IS NOT NULL AND `Title` <> '')", out);

  await b.close();
  site.close();
  finish(errs);
})();
