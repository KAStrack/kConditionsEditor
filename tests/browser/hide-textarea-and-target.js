/*
 * hideTextarea: 'toggle' and hideTarget.
 *
 * The trap worth testing: with a hideTarget that WRAPS the textarea, inserting
 * the editor after the textarea would put it inside the element about to be
 * hidden, and the editor would never be seen. So every case checks that the
 * editor is actually visible, not merely present.
 */
const { chromium } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');

const server = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  fs.readFile(path.join(ROOT, u), (e, d) => {
    if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(u)] || 'text/plain' });
    s.end(d);
  });
});

const DOC = { version: '1.0', root: { type: 'group', operator: 'and', negate: false, children: [
  { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'A' }] }] } };

// Ben's markup exactly: a row carrying the label and the field.
const PAGE = (opts) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="src/k-conditions-editor.css">
<link rel=stylesheet href="src/k-conditions-skins.css">
<body style="font-family:system-ui;padding:20px">
<form id=f>
  <div class="row" id="row">
    <label for="textareaid" id="lab">Conditions</label>
    <textarea id="textareaid" name="conditions">${JSON.stringify(DOC)}</textarea>
  </div>
</form>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
<script>
window.ed = KConditionsEditor.attach('#textareaid', Object.assign(
  { fields: [{ name: 'name', label: 'Name', type: 'text' }], startOpen: true, collapsible: false },
  ${opts}));
</script>`;

/* Visibility has to be judged by what is painted, not by geometry. The
   concealment clips an ancestor, and a clipped ancestor still leaves its
   children with a full-size bounding rect and a non-null offsetParent — so the
   obvious check reports a hidden label as visible. Hit-test the centre point
   instead: if the element (or a descendant) is what is painted there, it is
   really on screen. */
const probe = (p) => p.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  };
  const ta = document.getElementById('textareaid');
  const row = document.getElementById('row');
  const kce = document.querySelector('.kce');
  return {
    editorVisible: vis(kce),
    editorInsideRow: !!(kce && row.contains(kce)),
    textareaVisible: vis(ta),
    rowVisible: vis(row),
    labelVisible: vis(document.getElementById('lab')),
    toggle: (function () { const b = document.querySelector('.kce-source-toggle'); return b ? b.textContent : null; }()),
    // the field must still be in the form and still carry the rule
    inForm: !!document.getElementById('f').elements.conditions,
    posts: (document.getElementById('f').elements.conditions.value || '').indexOf('"root"') !== -1
  };
});

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log('  FAIL ' + what); } };

(async () => {
  await new Promise((r) => server.listen(8071, r));
  const b = await chromium.launch();
  const errs = [];

  async function run(label, opts) {
    SCRATCH('24.html', PAGE(opts));
    const p = await b.newPage({ viewport: { width: 900, height: 700 } });
    p.on('pageerror', (e) => errs.push(label + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(label + ': ' + m.text()); });
    await p.goto('http://localhost:8071/tests/browser/.scratch/24.html');
    await p.waitForTimeout(400);
    const state = await probe(p);
    console.log('  ' + label.padEnd(34), JSON.stringify(state));
    return { p, state };
  }

  console.log('\n-- hideTextarea --');
  let r = await run('true (default)', '{}');
  ok(r.state.editorVisible && !r.state.textareaVisible, 'default hides the field, shows the editor');
  ok(r.state.posts, 'the field still carries the rule');
  ok(r.state.toggle === null, 'no toggle button by default');
  await r.p.close();

  r = await run('false', '{ hideTextarea: false }');
  ok(r.state.editorVisible && r.state.textareaVisible, 'false leaves the field visible');
  await r.p.close();

  r = await run("'toggle'", "{ hideTextarea: 'toggle' }");
  ok(r.state.editorVisible && !r.state.textareaVisible, "'toggle' starts hidden");
  ok(r.state.toggle === 'Show source', 'the toggle offers to show it');
  await r.p.locator('.kce-source-toggle').click();
  await r.p.waitForTimeout(250);
  let after = await probe(r.p);
  console.log('  ' + 'after clicking the toggle'.padEnd(34), JSON.stringify(after));
  ok(after.textareaVisible, 'clicking the toggle reveals the field');
  ok(after.toggle === 'Hide source', 'and the button now offers to hide it');
  await r.p.locator('.kce-source-toggle').click();
  await r.p.waitForTimeout(250);
  after = await probe(r.p);
  ok(!after.textareaVisible && after.toggle === 'Show source', 'clicking again hides it');
  // the API path
  await r.p.evaluate(() => window.ed.setSourceVisible(true));
  await r.p.waitForTimeout(200);
  ok((await probe(r.p)).textareaVisible, 'setSourceVisible(true) works from code');
  ok(await r.p.evaluate(() => window.ed.isSourceVisible()) === true, 'isSourceVisible reports it');
  await r.p.close();

  console.log('\n-- hideTarget --');
  r = await run('selector', "{ hideTarget: '#row' }");
  ok(r.state.editorVisible, 'THE TRAP: the editor is visible, not buried in the hidden row');
  ok(!r.state.editorInsideRow, 'the editor was inserted after the row, not inside it');
  ok(!r.state.rowVisible && !r.state.labelVisible, 'the whole row went, label included');
  ok(r.state.posts, 'the field still carries the rule');
  await r.p.close();

  r = await run('element (closest)', "{ hideTarget: document.querySelector('#textareaid').closest('.row') }");
  ok(r.state.editorVisible && !r.state.editorInsideRow && !r.state.rowVisible, 'an element works the same');
  await r.p.close();

  r = await run('array of elements', "{ hideTarget: [document.getElementById('lab'), document.getElementById('textareaid')] }");
  ok(r.state.editorVisible, 'an array works');
  ok(!r.state.labelVisible && !r.state.textareaVisible, 'both listed elements are hidden');
  ok(r.state.rowVisible, 'and the row itself is left alone');
  await r.p.close();

  r = await run('target that excludes the field', "{ hideTarget: '#lab' }");
  ok(!r.state.labelVisible && !r.state.textareaVisible,
     'a target that does not cover the field still hides the field');
  await r.p.close();

  r = await run('toggle + hideTarget', "{ hideTextarea: 'toggle', hideTarget: '#row' }");
  ok(r.state.editorVisible && !r.state.rowVisible, 'they combine');
  await r.p.locator('.kce-source-toggle').click();
  await r.p.waitForTimeout(250);
  after = await probe(r.p);
  console.log('  ' + 'after clicking the toggle'.padEnd(34), JSON.stringify(after));
  ok(after.rowVisible && after.labelVisible && after.textareaVisible, 'the toggle reveals the whole row');
  await r.p.close();

  r = await run('selector matching nothing', "{ hideTarget: '#nope' }");
  ok(r.state.editorVisible && !r.state.textareaVisible,
     'a target that matches nothing falls back to hiding the textarea');
  await r.p.close();

  console.log('\n-- destroy restores everything --');
  r = await run('destroy after hideTarget', "{ hideTarget: '#row' }");
  await r.p.evaluate(() => window.ed.destroy());
  await r.p.waitForTimeout(200);
  const gone = await r.p.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const r2 = el.getBoundingClientRect();
      if (r2.width < 2 || r2.height < 2) return false;
      const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    };
    return {
      editors: document.querySelectorAll('.kce').length,
      rowVisible: vis(document.getElementById('row')),
      textareaVisible: vis(document.getElementById('textareaid')),
      leftoverClasses: document.querySelectorAll('.kce-concealed, .kce-hidden-textarea').length,
      leftoverAria: document.querySelectorAll('[aria-hidden="true"]').length
    };
  });
  console.log('  ' + 'after destroy'.padEnd(34), JSON.stringify(gone));
  ok(gone.editors === 0 && gone.rowVisible && gone.textareaVisible, 'destroy puts the row back');
  ok(gone.leftoverClasses === 0 && gone.leftoverAria === 0, 'and leaves no attributes behind');
  await r.p.close();

  SCRATCH.remove('24.html');
  await b.close(); server.close();
  console.log('\nfailures: ' + fails);
  console.log('ERRORS: ' + (errs.length ? errs.join('; ') : 'none'));
  if (fails || errs.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
