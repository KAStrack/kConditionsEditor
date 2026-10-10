/*
 * describeHtml(): the markup, the styling, and — the part that matters — that
 * a hostile value stays text in a real DOM rather than becoming an element.
 */
const { chromium } = require('playwright');
const { scratch: SCRATCH, shot: SHOT } = require('./harness.js');
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

const C = (f, op, v) => ({ type: 'condition', field: f, operator: op,
  values: [].concat(v).map((x) => (x && x.source ? x : { source: 'literal', value: x })) });
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', negate: false, children: [
  C('name', 'regex', '^ben'),
  { type: 'group', operator: 'or', negate: true, children: [C('state', 'eq', 'FL'), C('score', 'gt', 10)] }
] } };
const EVIL = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  C('name', 'eq', '<img src=x onerror="window.__pwned=1">')] } };

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="dist/k-conditions.min.css">
<body style="font-family:system-ui;padding:20px">
<!-- standalone: the rendering with no editor on the page at all -->
<div id="standalone"></div>
<div id="evil"></div>
<hr>
<textarea id="t">${JSON.stringify(DOC)}</textarea>
<script src="dist/k-conditions.min.js"></script>
<script>
var FIELDS=[{name:'name',label:'Name'},{name:'state',label:'State',choices:{FL:'Florida',TX:'Texas'}},{name:'score',label:'Score'}];
document.getElementById('standalone').innerHTML =
  KConditions.describeHtml(${JSON.stringify(DOC)}, { fields: FIELDS });
document.getElementById('evil').innerHTML =
  KConditions.describeHtml(${JSON.stringify(EVIL)}, { fields: FIELDS });
window.ed = KConditionsEditor.attach('#t', { fields: FIELDS, summaryHtml: true, startOpen: false });
</script>`;

let fails = 0;
const ok = (c, w) => { if (!c) { fails++; console.log('  FAIL ' + w); } };

(async () => {
  await new Promise((r) => server.listen(8069, r));
  const b = await chromium.launch();
  const errs = [];
  const p = await b.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  SCRATCH('25.html', PAGE);
  await p.goto('http://localhost:8069/tests/browser/.scratch/25.html');
  await p.waitForTimeout(400);

  const shape = await p.evaluate(() => {
    const s = document.getElementById('standalone');
    const cs = (sel) => { const e = s.querySelector(sel); return e ? getComputedStyle(e) : null; };
    return {
      text: s.textContent,
      fields: s.querySelectorAll('strong.kcd-field').length,
      values: s.querySelectorAll('.kcd-value').length,
      ops: s.querySelectorAll('.kcd-op').length,
      logic: Array.from(s.querySelectorAll('.kcd-logic')).map((e) => e.textContent),
      fieldWeight: cs('strong.kcd-field').fontWeight,
      valueColour: cs('.kcd-value').color,
      valueUnderline: cs('.kcd-value').borderBottomStyle,
      opStyle: cs('.kcd-op').fontStyle,
      orColour: cs('.kcd-logic.kcd-or') ? cs('.kcd-logic.kcd-or').color : null,
      andColour: cs('.kcd-logic.kcd-and') ? cs('.kcd-logic.kcd-and').color : null
    };
  });
  console.log('standalone:', JSON.stringify(shape, null, 0));

  ok(shape.fields === 3, 'three fields marked up with <strong>');
  ok(shape.fieldWeight === '650' || Number(shape.fieldWeight) >= 600, 'fields render bold');
  ok(shape.valueUnderline === 'dashed', 'values carry a dashed underline');
  ok(shape.valueColour !== shape.andColour, 'values are not the AND colour');
  ok(shape.opStyle === 'italic', 'operators are italic');
  ok(shape.logic.join(',') === 'AND,OR', 'both connectors present and labelled');
  ok(shape.andColour !== shape.orColour, 'AND and OR are told apart by colour');
  ok(shape.text.indexOf('Florida') !== -1, 'choice labels are used');

  // the escaping, in a real DOM
  const evil = await p.evaluate(() => ({
    pwned: !!window.__pwned,
    imgs: document.querySelectorAll('#evil img').length,
    text: document.getElementById('evil').textContent
  }));
  console.log('hostile value:', JSON.stringify(evil));
  ok(!evil.pwned, 'the onerror payload did not run');
  ok(evil.imgs === 0, 'no <img> element was created');
  ok(evil.text.indexOf('<img src=x') !== -1, 'and it is visible as text instead');

  // the editor's collapsed summary
  const summary = await p.evaluate(() => {
    const s = document.querySelector('.kce-summary-text');
    return { html: s.innerHTML.indexOf('kcd-field') !== -1, text: s.textContent };
  });
  console.log('editor summary:', JSON.stringify(summary));
  ok(summary.html, 'summaryHtml renders the marked-up summary');
  ok(summary.text.indexOf('Name') !== -1, 'and reads the same as the text version');

  await p.locator('#standalone').screenshot({ path: SHOT('describe-html.png') });
  SCRATCH.remove('25.html');
  await b.close(); server.close();
  console.log('\nfailures: ' + fails);
  console.log('ERRORS: ' + (errs.length ? errs.join('; ') : 'none'));
  if (fails || errs.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
