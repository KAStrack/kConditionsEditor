/*
 * dist/ verification.
 *
 * Minifying is a semantics-preserving claim, so it gets tested like one:
 *  1. the shared conformance fixtures run through the MINIFIED evaluator and
 *     SQL builder and must agree with the sources character for character;
 *  2. the CommonJS shape of every dist file;
 *  3. the single-file bundle driving a real editor in a browser — build a rule,
 *     undo it, hover the previews — with nothing else loaded.
 */
const { chromium } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');

// dist/ is committed from 0.1.2, but a working copy can still lack it (it was
// deleted, or this is an older checkout). Say that plainly rather than failing
// with a stack trace about a missing file.
const DIST = require('path').resolve(__dirname, '..', '..', 'dist');
if (!require('fs').existsSync(require('path').join(DIST, 'k-conditions.min.js'))) {
  console.log('FAIL dist/ is missing — run `npm run build` first');
  console.log('failures: 1');
  console.log('ERRORS: none');
  process.exit(1);
}
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = require('path').resolve(__dirname, '..', '..');
const srcK = require(path.join(ROOT, 'src/k-conditions-evaluator.js'));
require(path.join(ROOT, 'src/k-conditions-sql.js'));
const minK = require(path.join(ROOT, 'dist/k-conditions-evaluator.min.js'));
require(path.join(ROOT, 'dist/k-conditions-sql.min.js'));
const bundle = require(path.join(ROOT, 'dist/k-conditions.min.js'));

const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/cases.json'), 'utf8'));
let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log('  FAIL ' + what); } };

/* ---- 1. fixtures through the minified build -------------------------- */
function runEval(K, c) {
  try {
    const ev = new K.Evaluator(c.options || {});
    (c.register || []).forEach((name) => ev.registerOperator(name, () => true));
    return JSON.stringify(ev.evaluate(c.document, c.data || {}));
  } catch (e) { return 'ERR:' + e.name; }
}
function runSql(K, c) {
  try { return JSON.stringify(K.toSql(c.document, c.options || {})); }
  catch (e) { return 'ERR:' + e.name; }
}

let evalCount = 0, sqlCount = 0, evalRight = 0, sqlRight = 0;
(cases.cases || []).forEach((c) => {
  evalCount++;
  const a = runEval(srcK, c), b = runEval(minK, c);
  ok(a === b, 'evaluation drift: ' + c.name + ' (' + a + ' vs ' + b + ')');
  // and still the documented answer, not merely the same wrong one
  if (c.expected !== undefined && b === JSON.stringify(c.expected)) evalRight++;
});
(cases.sqlCases || []).forEach((c) => {
  sqlCount++;
  const a = runSql(srcK, c), b = runSql(minK, c);
  ok(a === b, 'sql drift: ' + c.name);
  if (c.expectedSql !== undefined) {
    let got = null;
    try { got = minK.toSql(c.document, c.options || {}).sql; } catch (e) { got = 'ERR'; }
    if (got === c.expectedSql) sqlRight++;
  }
});
console.log('fixtures  : ' + evalCount + ' evaluation (' + evalRight + ' matched expected) + '
  + sqlCount + ' SQL (' + sqlRight + ' matched expected), minified vs source');

/* ---- 2. CommonJS shapes --------------------------------------------- */
ok(typeof minK.Evaluator === 'function', 'dist evaluator exports Evaluator');
ok(typeof minK.toSql === 'function', 'dist sql attaches toSql to the evaluator');
ok(bundle && typeof bundle.KConditions.Evaluator === 'function', 'bundle exports KConditions');
ok(bundle && typeof bundle.KConditionsEditor.attach === 'function', 'bundle exports KConditionsEditor');
ok(typeof bundle.KConditions.toSql === 'function', 'bundle wires SQL onto its evaluator');
ok(minK.SPEC_VERSION === srcK.SPEC_VERSION, 'spec version survives minification');
ok(bundle.KConditionsEditor.VERSION === require(path.join(ROOT, 'package.json')).version,
   'bundle VERSION matches package.json');
console.log('exports   : checked');

/* ---- 3. the bundle in a browser, on its own -------------------------- */
const server = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  fs.readFile(path.join(ROOT, u), (e, d) => {
    if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(u)] || 'text/plain' });
    s.end(d);
  });
});

const C = (f, v) => ({ type: 'condition', field: f, operator: 'eq', values: [{ source: 'literal', value: v }] });
// A nested group, so the bundled CSS has brackets and a NOT to paint too.
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', negate: false, children: [
  C('name', 'A'),
  { type: 'group', operator: 'or', negate: true, children: [C('state', 'CA'), C('name', 'B')] }
] } };

const PAGE = (css, js) => `<!doctype html><meta charset=utf-8>
${css.map((u) => '<link rel=stylesheet href="' + u + '">').join('\n')}
<body style="font-family:system-ui;padding:20px"><textarea id=t>${JSON.stringify(DOC)}</textarea>
${js.map((u) => '<script src="' + u + '"></script>').join('\n')}
<script>
window.ed = KConditionsEditor.attach('#t', {
  fields: [{name:'name',label:'Name',type:'text'},
           {name:'state',label:'State',type:'enum',choices:{CA:'California'}}],
  startOpen: true, collapsible: false, debug: true, sql: { dialect: 'mysql' },
  // What this checks is the highlight look surviving the bundle: the pill ghost.
  previewStyle: 'highlight'
});
</script>`;

(async () => {
  await new Promise((r) => server.listen(8073, r));
  const b = await chromium.launch();
  const errs = [];

  // The bundle is one sheet and one script; the other two rows need both
  // sheets and all three scripts, which is the point of the comparison.
  const setups = [
    ['bundle    ', ['dist/k-conditions.min.css'], ['dist/k-conditions.min.js']],
    ['per-file  ', ['dist/k-conditions-editor.min.css', 'dist/k-conditions-skins.min.css'], [
      'dist/k-conditions-evaluator.min.js', 'dist/k-conditions-sql.min.js', 'dist/k-conditions-editor.min.js']],
    ['source    ', ['src/k-conditions-editor.css', 'src/k-conditions-skins.css'], [
      'src/k-conditions-evaluator.js', 'src/k-conditions-sql.js', 'src/k-conditions-editor.js']]
  ];
  const results = {};

  for (const [label, css, js] of setups) {
    SCRATCH('23.html', PAGE(css, js));
    const p = await b.newPage({ viewport: { width: 900, height: 700 } });
    p.on('pageerror', (e) => errs.push(label + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(label + ': ' + m.text()); });
    await p.goto('http://localhost:8073/tests/browser/.scratch/23.html');
    await p.waitForTimeout(600);
    if (!(await p.locator('.kce').count())) { console.log(label + 'NO EDITOR. errors so far: ' + JSON.stringify(errs)); await p.close(); continue; }

    // build: +AND on the last row, then set it
    const el = p.locator('[data-fk="r:add-and-1"]');
    const row = await el.evaluate((e) => {
      let h = e.closest('.kce-line');
      if (!h) { const c = e.closest('.kce-connector'); h = (c && c.previousElementSibling) || c; }
      const r = h.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height };
    });
    await p.mouse.move(row.x + 8, row.y + row.h / 2); await p.waitForTimeout(180);
    const bb = await el.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(200);

    const preview = await p.evaluate(() => ({
      tinted: document.querySelectorAll('.kce-will-group').length,
      ghosts: document.querySelectorAll('.kce-ghost').length,
      ghostPainted: (function () {
        const g = document.querySelector('.kce-ghost');
        return g ? getComputedStyle(g).borderStyle : null;
      }())
    }));

    await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(250);
    const after = await p.evaluate(() => window.ed.describe());
    await p.evaluate(() => window.ed.undo()); await p.waitForTimeout(200);

    results[label.trim()] = {
      summary: await p.evaluate(() => window.ed.describe()),
      afterAdd: after,
      sql: await p.evaluate(() => window.ed.getSql().sql),
      preview: preview,
      paren: await p.evaluate(() => {
        const e = document.querySelector('.kce-paren');
        return e ? getComputedStyle(e).fontWeight + '/' + getComputedStyle(e).color
                   + '/' + getComputedStyle(e).fontSize : 'MISSING';
      }),
      notMarker: await p.evaluate(() => {
        const e = document.querySelector('.kce-negate-marker');
        return e ? getComputedStyle(e).display + '/' + getComputedStyle(e).color : 'MISSING';
      })
    };
    console.log(label + JSON.stringify(results[label.trim()]));
    await p.close();
  }

  const a = results.bundle, c = results['per-file'], d = results.source;
  ok(a.summary === d.summary && c.summary === d.summary, 'summary matches the source build');
  ok(a.afterAdd === d.afterAdd, 'the +AND click behaves the same from the bundle');
  ok(a.sql === d.sql, 'SQL matches the source build');
  ok(a.preview.ghosts === 1 && a.preview.tinted > 0, 'the preview works from the bundle');
  ok(a.preview.ghostPainted === 'dashed', 'the bundled CSS paints the ghost');
  ok(a.paren === d.paren && c.paren === d.paren, 'the bundled CSS gives the same brackets');
  ok(a.paren !== 'MISSING', 'there were brackets to compare');
  ok(a.notMarker === d.notMarker, 'the bundled CSS gives the same NOT marker');
  ok(a.notMarker !== 'MISSING', 'there was a NOT marker to compare');

  SCRATCH.remove('23.html');
  await b.close(); server.close();
  console.log('\nfailures: ' + fails);
  console.log('ERRORS: ' + (errs.length ? errs.join('; ') : 'none'));
  if (fails || errs.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
