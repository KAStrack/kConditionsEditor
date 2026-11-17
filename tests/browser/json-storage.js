/*
 * A field stored as a JSON array (`storage: 'json'`), and a saved rule that
 * no longer fits the field it names.
 *
 * KAStrack's multi-user fields were declared `type: 'text'`, so their rules
 * were saved with text operators — `is not empty` above all, and possibly
 * `contains`. Declared as JSON-stored lists, those rules must still load as
 * what they are: the row shows the operator the rule holds (not the first one
 * the field now offers, which is what a select with nothing chosen paints),
 * loading it does not change the rule in the field, and the rule keeps working
 * until someone changes it. Judged by the text the shells paint, by the
 * document, and by the SQL and summary the editor produces.
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const ASSIGNED = {
  name: 'Assigned To', label: 'Assigned To', type: 'list', storage: 'json', column: '--ID_FOR_Assigned To',
  choices: { 3184: 'Ben Holness', 3152: 'claude claudesson (claude)' }
};
const FIELDS = [
  { name: 'Title', label: 'Title', type: 'text' },
  ASSIGNED,
  // No type: storage alone makes it a list.
  { name: 'Watchers', label: 'Watchers', storage: 'json', choices: { 1: 'One', 2: 'Two' } }
];

const cond = (field, operator, values) => ({ type: 'condition', field, operator, values: values || [] });
const doc = (...children) => ({ version: '1.0', root: { type: 'group', operator: 'and', children } });
const lit = (value) => ({ source: 'literal', value });

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

// What row `i` shows: the painted field and operator, the operator list, the
// value controls, and what the document and the field hold.
const row = (p, i) => p.evaluate(`(() => {
  const vis = ${VIS};
  const r = document.querySelectorAll('.kce-condition')[${i}];
  const shell = (cls) => r.querySelector('.kce-sel-' + cls);
  const sel = (cls) => shell(cls) && shell(cls).querySelector('select');
  const op = sel('operator');
  return {
    field: shell('field') && shell('field').querySelector('.kce-sel-label').textContent,
    fieldPainted: vis(shell('field')),
    operator: shell('operator') && shell('operator').querySelector('.kce-sel-label').textContent,
    operatorPainted: vis(shell('operator')),
    operatorValue: op && op.value,
    offered: op ? [...op.options].map(o => o.value) : [],
    headings: op ? [...op.querySelectorAll('optgroup')].map(g => g.label) : [],
    input: (r.querySelector('input.kce-literal') || {}).value,
    chips: [...r.querySelectorAll('.kce-tag')].map(t => t.firstChild.textContent),
    document: JSON.stringify(window.ed.getDocument().root),
    // The editor writes a readable rule back pretty-printed, as it always
    // has; what must not change is the rule itself.
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
  scratch('json-storage.html', PAGE);
  await p.goto(site.url + scratch.url('json-storage.html'));

  /* 1. The KAStrack rule as saved: `is not empty`, from when the field was text. */
  await p.evaluate((d) => window.load(d), doc(cond('Assigned To', 'is_not_empty')));
  let r = await row(p, 0);
  ok('a saved "is not empty" loads as "is not empty"', r.operator === 'is not empty' && r.operatorPainted, r);
  ok('the field is shown by its label', r.field === 'Assigned To' && r.fieldPainted, r);
  ok('a JSON-stored list offers the list operators and is / is not empty',
    JSON.stringify(r.offered) === JSON.stringify(['includes_any', 'includes_all', 'is_empty', 'is_not_empty']), r);
  ok('loading the rule leaves the rule in the field as it was', r.fieldValueUnchanged, r);
  let out = await p.evaluate(() => ({ sql: window.ed.getSql({ dialect: 'mysql' }).sql, text: window.ed.describe() }));
  ok('its SQL now reads [] and every other empty spelling as empty',
    out.sql === "(`--ID_FOR_Assigned To` IS NOT NULL AND CAST(`--ID_FOR_Assigned To` AS CHAR) NOT IN ('', '[]', '[\"[]\"]', '[\"\"]', '[null]', 'null', '\"[]\"', '\"\"', '\"[\\\\\"\\\\\"]\"'))", out);

  /* 2. Storage alone makes a field a list. */
  await p.evaluate((d) => window.load(d), doc(cond('Watchers', 'is_empty')));
  r = await row(p, 0);
  ok('a JSON-stored field with no type is a list',
    JSON.stringify(r.offered) === JSON.stringify(['includes_any', 'includes_all', 'is_empty', 'is_not_empty']), r);

  /* 3. An operator the field no longer offers: shown, kept, then replaceable. */
  const legacy = doc(cond('Assigned To', 'contains', [lit('claude')]));
  await p.evaluate((d) => window.load(d), legacy);
  r = await row(p, 0);
  ok('a saved "contains" on a now-list field shows "contains", not the first list operator',
    r.operator === 'contains' && r.operatorValue === 'contains' && r.operatorPainted, r);
  ok('its value is still there to read', r.input === 'claude', r);
  ok('it sits under its own heading after the field\'s own operators',
    r.offered[r.offered.length - 1] === 'contains' && r.headings[r.headings.length - 1] === 'Alphanumeric', r);
  const held = JSON.parse(r.document).children[0];
  ok('loading it leaves the rule, in the editor and in the field, as it was',
    r.fieldValueUnchanged && held.operator === 'contains' && JSON.stringify(held.values) === '[{"source":"literal","value":"claude"}]', r);
  out = await p.evaluate(() => {
    try { return { sql: window.ed.getSql({ dialect: 'mysql' }).sql }; } catch (e) { return { error: e.message }; }
  });
  ok('its SQL is refused rather than guessed at (the unsupported policy decides)',
    out.error && /cannot be expressed/.test(out.error), out);
  const skipped = await p.evaluate(() => window.ed.getSql({ dialect: 'mysql', unsupportedPolicy: 'skip' }));
  ok('…and with unsupportedPolicy: skip it drops out', skipped.sql === '1 = 1' && skipped.skipped.length === 1, skipped);

  // Choosing another operator: the stray goes, as any choice the field does not offer.
  await p.locator('.kce-condition .kce-sel-operator select').selectOption('includes_any');
  r = await row(p, 0);
  ok('choosing "includes any of" replaces it', r.operator === 'includes any of' && JSON.parse(r.document).children[0].operator === 'includes_any', r);
  ok('…and "contains" is no longer offered', !r.offered.includes('contains'), r);
  ok('…and the field now holds the new rule', !r.fieldValueUnchanged, r);

  /* 4. Picking people by name stores their IDs; the summary names them. */
  await p.locator('.kce-condition select.kce-tag-input').selectOption({ label: 'Ben Holness' });
  await p.locator('.kce-condition select.kce-tag-input').selectOption({ label: 'claude claudesson (claude)' });
  r = await row(p, 0);
  ok('the chips show names', JSON.stringify(r.chips) === JSON.stringify(['Ben Holness', 'claude claudesson (claude)']), r);
  ok('the document stores the IDs', JSON.stringify(JSON.parse(r.document).children[0].values[0].value) === '["3184","3152"]', r);
  out = await p.evaluate(() => {
    const d = window.ed.getDocument();
    return {
      text: window.ed.describe(),
      sql: window.ed.getSql({ dialect: 'mysql' }).sql,
      // The same field list, handed to the evaluator, decodes the stored text.
      ben: KConditions.evaluate(d, { 'Assigned To': '["3184"]' }, { fields: window.FIELDS }),
      nobody: KConditions.evaluate(d, { 'Assigned To': '["[]"]' }, { fields: window.FIELDS }),
      notJson: KConditions.evaluate(d, { 'Assigned To': 'Ben Holness' }, { fields: window.FIELDS })
    };
  });
  ok('the summary names the people', out.text === '[Assigned To] includes any of ["Ben Holness", "claude claudesson (claude)"]', out);
  ok('the SQL looks for the IDs, guarded against text that is not JSON',
    out.sql === "CASE WHEN JSON_VALID(`--ID_FOR_Assigned To`) THEN JSON_CONTAINS(`--ID_FOR_Assigned To`, '\"3184\"') OR JSON_CONTAINS(`--ID_FOR_Assigned To`, '\"3152\"') ELSE 0 END", out);
  ok('the evaluator agrees, from the same fields', out.ben === true && out.nobody === false && out.notJson === false, out);

  /* 5. A field the host no longer lists, and an operator nobody defines. */
  await p.evaluate((d) => window.load(d), doc(cond('Old Field', 'eq', [lit('x')]), cond('Assigned To', 'bogus_op')));
  r = await row(p, 0);
  ok('a field the host no longer lists is shown by its name, not as the first field',
    r.field === 'Old Field' && r.fieldPainted && r.operator === 'is equal to', r);
  const r2 = await row(p, 1);
  ok('an operator nobody defines is shown by its name', r2.operator === 'bogus_op' && r2.operatorPainted, r2);
  ok('neither is changed by loading', r.fieldValueUnchanged, r);

  /* 6. A host that lists is_set in `operators` still gets it. */
  await p.evaluate((d) => window.load(d, { fields: [Object.assign({}, window.FIELDS[1], { operators: ['includes_any', 'is_set'] })] }),
    doc(cond('Assigned To', 'is_set')));
  r = await row(p, 0);
  ok('an explicit operators list is honoured', JSON.stringify(r.offered) === JSON.stringify(['includes_any', 'is_set']) && r.operator === 'is set', r);

  await b.close();
  site.close();
  finish(errs);
})();
