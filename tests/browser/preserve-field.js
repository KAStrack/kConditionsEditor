/*
 * A field the editor cannot read is kept, not replaced.
 *
 * The bug this guards: attach to a textarea holding hand-written SQL and the
 * editor wrote `1 = 1` (or an empty JSON document) over it in the constructor,
 * before anyone had touched anything — so an untouched form submitted a
 * destroyed rule, and there was nowhere to see what had been there. Now the
 * field stays byte-identical until the first change, and the content is shown
 * in a notice until dismissed. Judged by the field's value, by input events
 * seen by the page, and by what is painted.
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors, shot } = require('./harness.js');

const SQL = "`field`='Value' OR field  = 'Value2'";
const JSON_DOC = JSON.stringify({ version: '1.0', root: { type: 'group', operator: 'and', negate: false, children: [
  { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'A' }] }] } });

const page = (content, opts, extra) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="src/k-conditions-editor.css">
<link rel=stylesheet href="src/k-conditions-skins.css">
<body style="font-family:system-ui;padding:20px">
<h1>Page</h1>
<form id=f>
  <textarea id="ta" name="conditions">${content}</textarea>
  ${extra || ''}
</form>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-sql.js"></script>
<script src="src/k-conditions-editor.js"></script>
<script>
window.original = document.getElementById('ta').value;
window.inputEvents = 0;
document.getElementById('ta').addEventListener('input', function () { window.inputEvents++; });
window.OPTS = Object.assign({ fields: [{ name: 'name', label: 'Name', type: 'text' }] }, ${JSON.stringify(opts)});
window.ed = KConditionsEditor.attach('#ta', OPTS);
</script>`;

const VIS = `(el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}`;

const state = (p) => p.evaluate(`(() => {
  const vis = ${VIS};
  const n = document.querySelector('.kce-preserved');
  return {
    notices: document.querySelectorAll('.kce-preserved').length,
    painted: vis(n),
    source: n ? n.querySelector('.kce-preserved-source').textContent : null,
    value: document.getElementById('ta').value,
    untouched: document.getElementById('ta').value === window.original,
    inputEvents: window.inputEvents,
    pristine: window.ed.pristine,
    preserved: window.ed.preserved,
    summary: document.querySelector('.kce-summary-text').textContent,
    summaryPainted: vis(document.querySelector('.kce-summary-text')),
    roots: document.querySelectorAll('.kce').length
  };
})()`);

(async () => {
  const site = await serve();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const errs = watchErrors(p, []);
  const { ok, finish } = checker();
  const open = async (name, content, opts, extra) => {
    scratch(name, page(content, opts, extra));
    await p.goto(site.url + scratch.url(name));
    await p.waitForSelector('.kce');
  };

  // -- (a) SQL output, open ----------------------------------------------
  await open('preserve-a.html', SQL, { output: 'sql', startOpen: true, collapsible: false });
  let s = await state(p);
  ok('a: notice painted', s.painted);
  ok('a: notice shows the original text', s.source === SQL, { source: s.source });
  ok('a: field untouched after attach', s.untouched, { value: s.value });
  ok('a: no input events fired on attach', s.inputEvents === 0, { inputEvents: s.inputEvents });
  ok('a: editor is pristine', s.pristine === true);
  ok('a: editor.preserved carries the text', s.preserved && s.preserved.text === SQL);
  ok('a: summary describes the empty rule', s.summary === 'Always', { summary: s.summary });
  await p.screenshot({ path: shot('preserve-notice.png'), fullPage: true });

  await p.click('.kce-preserved-dismiss');
  s = await state(p);
  ok('a: dismissed notice is not painted', !s.painted);
  ok('a: dismiss does not touch the field', s.untouched && s.inputEvents === 0);
  ok('a: dismiss keeps pristine', s.pristine === true);

  await p.click('.kce-adds-starter .kce-add');
  await p.waitForTimeout(150);
  s = await state(p);
  ok('a: first change rewrites the field', !s.untouched, { value: s.value });
  ok('a: first change fires input', s.inputEvents > 0);
  ok('a: no longer pristine', s.pristine === false);
  ok('a: notice stays dismissed', !s.painted);

  // (d) undo back to empty is the editor's empty output, not the original.
  await p.evaluate(() => { let n = 0; while (window.ed.canUndo() && n++ < 20) window.ed.undo(); });
  s = await state(p);
  ok('d: undo to empty writes the editor output', s.value === '1 = 1' && !s.untouched, { value: s.value });

  // -- (b) JSON output (default) ---------------------------------------------
  await open('preserve-b.html', SQL, { startOpen: true, collapsible: false });
  s = await state(p);
  ok('b: json mode keeps the field untouched', s.untouched && s.inputEvents === 0, { value: s.value });
  ok('b: json mode shows the notice', s.painted);
  await p.click('.kce-adds-starter .kce-add');
  await p.waitForTimeout(150);
  s = await state(p);
  ok('b: first change writes JSON', s.value.charAt(0) === '{', { value: s.value.slice(0, 20) });

  // -- (c) collapsed start, then re-attach ------------------------------------
  await open('preserve-c.html', SQL, { output: 'sql', startOpen: false });
  s = await state(p);
  ok('c: notice painted while collapsed', s.painted);
  ok('c: summary painted while collapsed', s.summaryPainted && s.summary === 'Always');
  ok('c: field untouched while collapsed', s.untouched && s.inputEvents === 0);
  await p.click('.kce-edit');
  await p.waitForTimeout(150);
  s = await state(p);
  ok('c: opening keeps the notice', s.painted);
  ok('c: opening does not touch the field', s.untouched && s.inputEvents === 0 && s.pristine);
  await p.evaluate(() => { window.ed = KConditionsEditor.attach('#ta', OPTS); });
  s = await state(p);
  ok('c: re-attach leaves one root', s.roots === 1, { roots: s.roots });
  ok('c: re-attach leaves the field untouched', s.untouched && s.inputEvents === 0);
  ok('c: re-attach shows the notice again', s.painted);

  // -- documentInput present but empty ---------------------------------------
  await open('preserve-di.html', SQL, { output: 'sql', startOpen: true, documentInput: '#di' },
    '<textarea id="di"></textarea>');
  s = await state(p);
  const di = await p.evaluate(() => document.getElementById('di').value);
  ok('documentInput: SQL in the field is preserved', s.painted && s.untouched);
  ok('documentInput: the document field is not written while pristine', di === '', { di });

  // -- (e) nothing to preserve ----------------------------------------------
  for (const [name, content] of [['empty', ''], ['json', JSON_DOC],
      ['comment', '1 = 1\n/* kconditions:1.0 ' + JSON_DOC + ' */']]) {
    await open('preserve-e-' + name + '.html', content, { output: name === 'comment' ? 'sql' : 'json', startOpen: true });
    s = await state(p);
    ok('e: ' + name + ' field shows no notice', s.notices === 0 && s.pristine === false && s.preserved === null,
      { notices: s.notices, pristine: s.pristine });
  }

  await b.close();
  site.close();
  finish(errs);
})();
