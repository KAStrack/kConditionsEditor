/*
 * Long field names, with the built-in kSelect, at a host's own text size.
 *
 * HDC (0.1.4): about 80 fields, many of them whole questions, and a rating
 * grid's items named "{question}: {item}" — so what tells two fields apart
 * is the end of the name. Two things went wrong there on the first day:
 *
 * - The rows never settled. With `--kce-font-size: 1rem` and a short
 *   operator ("is yes"), fitRows() read the min-width it had set on the last
 *   pass as part of the shell, added a fraction of a pixel to it, and the
 *   shell watch (for late widgets) ran it again — every frame, for ever, the
 *   operator growing and the field shrinking.
 * - The open field list cut every option at the same "…", so "…: Cooking"
 *   and "…: Baking" could not be told apart without choosing them.
 *
 * Judged by what is painted: shell widths over time, how many layout passes
 * run at rest, which option text is cut, where the list is on screen, and
 * what the closed field offers on hover.
 *
 *   node tests/browser/run.js kselect-long-names
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const Q = 'Do you have skills and/or professional experience in any of the following areas';
const AREAS = ['Cooking', 'Baking', 'Carpentry', 'Electrical work', 'First aid', 'Sound engineering',
  'Photography', 'Bar work', 'Childcare', 'Cleaning', 'Driving a minibus', 'Plumbing', 'Gardening',
  'Sewing', 'Painting', 'Lighting', 'Stage management', 'Translation', 'Accounting', 'Massage', 'Yoga'];
const ANSWER = { none: 'None', some: 'Some, as a hobby', pro: 'Yes, and I have done it professionally for more than five years' };

const FIELDS = AREAS.map((a, i) => ({ name: 'skill' + i, label: Q + ': ' + a, group: 'Skills', choices: ANSWER }));
FIELDS.push({ name: 'before', label: 'Have you been to Herräng before?', type: 'boolean' });
FIELDS.push({ name: 'age', label: 'Age', type: 'number' });

const lit = (v) => ({ source: 'literal', value: v });
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  // Far enough down the list that showing it means scrolling to it.
  { type: 'condition', field: 'skill9', operator: 'eq', values: [lit('pro')] },
  { type: 'condition', field: 'before', operator: 'is_true', values: [] }
] } };

/**
 * HDC's shape: body text at 16px, the editor told so, in a column narrower
 * than the rule. `ks`: whether kSelect is on the page; `below` pushes the
 * editor to the foot of a tall page, so a list opens upwards.
 */
function page(opts) {
  const ks = opts.ks !== false;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>long names</title>
${ks ? '<link rel="stylesheet" href="tests/browser/vendor/kselect/kselect.min.css">' : ''}
<link rel="stylesheet" href="src/k-conditions-editor.css"><link rel="stylesheet" href="src/k-conditions-skins.css">
<style>html { font-size: 16px; } body { margin: 20px; font: 16px/1.5 system-ui, sans-serif; }
  .col { width: ${opts.width || 640}px; ${opts.right ? 'margin-left: auto;' : ''} }
  .kce, .kce[data-kce-theme] { --kce-font-size: 1rem; }</style>
${ks ? '<script src="tests/browser/vendor/kselect/kselect.min.js"></script>' : ''}
<script src="src/k-conditions-evaluator.js"></script><script src="src/k-conditions-editor.js"></script></head>
<body>${opts.below ? '<div style="height: 1400px"></div>' : ''}<div class="col"><textarea id="t"></textarea></div>
${opts.below ? '' : '<div style="height: 1400px"></div>'}
<script>
// The list that is open: the one its control says it controls.
window.openList = function () {
  var c = document.querySelector('.kce .ks-control[aria-expanded="true"]');
  return c && document.getElementById(c.getAttribute('aria-controls')).closest('.ks-dropdown');
};
document.getElementById('t').value = ${JSON.stringify(JSON.stringify(DOC))};
window.ed = KConditionsEditor.attach('#t', {
  fields: ${JSON.stringify(FIELDS)}, collapsible: false, startOpen: true, controls: 'always', skin: 'prose',
  labels: { operators: { eq: 'is', is_true: 'is yes' } }
});
// Count layout passes from here on.
window.passes = 0;
var fit = ed.fitLayout;
ed.fitLayout = function () { window.passes++; return fit.apply(this, arguments); };
</script></body></html>`;
}

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  let n = 0;

  async function open(opts, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1000, height: 760 } });
    const p = await ctx.newPage();
    watchErrors(p, errs);
    const name = 'kselect-long-names-' + (++n) + '.html';
    scratch(name, page(opts || {}));
    await p.goto(site.url + scratch.url(name));
    await p.evaluate(() => document.fonts.ready);
    p.ctx = ctx;
    return p;
  }

  const widths = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.kce-condition > .kce-sel'))
    .map((s) => Math.round(s.getBoundingClientRect().width * 10) / 10));

  /** The shells' widths now and a second later, and how many passes ran between. */
  async function still(p) {
    await p.waitForTimeout(300);
    const a = await widths(p);
    const passes = await p.evaluate(() => (window.passes = 0));
    await p.waitForTimeout(1000);
    const b = await widths(p);
    return { a, b, passes: await p.evaluate(() => window.passes) };
  }

  /* --- 1. The rows settle ------------------------------------------------ */
  let p = await open();
  let s = await still(p);
  ok('on load: every shell keeps its width for a second', JSON.stringify(s.a) === JSON.stringify(s.b), s);
  ok('on load: no layout pass runs at rest', s.passes === 0, s);
  const fontSizes = await p.evaluate(() => ({
    ks: getComputedStyle(document.querySelector('.kce-sel-ks .ks-single-value')).fontSize,
    native: getComputedStyle(document.querySelector('.kce-sel-operator .kce-sel-label')).fontSize
  }));
  ok('the closed kSelect is at the host\'s --kce-font-size, as the rest of the row is', fontSizes.ks === '16px' && fontSizes.native === '16px', fontSizes);

  // Pick another field from the list, by pointer.
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
  await p.click('.kce-ks-layer .ks-option:has-text("Baking")');
  s = await still(p);
  ok('after a pick: every shell keeps its width for a second', JSON.stringify(s.a) === JSON.stringify(s.b), s);
  ok('after a pick: no layout pass runs at rest', s.passes === 0, s);

  // And again from the reload: the rule as the form would bring it back.
  await p.reload();
  await p.evaluate(() => document.fonts.ready);
  s = await still(p);
  ok('after a reload: every shell keeps its width for a second', JSON.stringify(s.a) === JSON.stringify(s.b), s);

  // fitRows() alone, run over and over, gives the same answer: it never
  // reads its own result.
  const again = await p.evaluate(() => {
    const read = () => Array.from(document.querySelectorAll('.kce-condition > .kce-sel')).map((c) => c.style.minWidth).join(' ');
    const first = read();
    for (let i = 0; i < 20; i++) ed.fitRows();
    return { first, last: read() };
  });
  ok('fitRows() run twenty times leaves every minimum where the first run put it', again.first === again.last && again.first.trim() !== '', again);
  // Whatever minimum a shell holds going in, fitRows() comes to the same one.
  const stale = await p.evaluate(() => {
    const shells = Array.from(document.querySelectorAll('.kce-condition > .kce-sel'));
    const read = () => shells.map((c) => c.style.minWidth).join(' ');
    const clean = read();
    shells.forEach((c) => { c.style.minWidth = '300px'; });
    ed.fitRows();
    return { clean, after: read() };
  });
  ok('fitRows() never reads its own result: a stale minimum changes nothing', stale.clean === stale.after, stale);

  // A layout pass that does change a watched shell — the worst case, a pass
  // that is never the same twice — still runs only when something else
  // changes, not off its own writes.
  const feeding = await p.evaluate(async () => {
    const shell = document.querySelector('.kce-sel-ks');
    let grow = 0;
    const fitRows = ed.fitRows;
    ed.fitRows = function () { fitRows.call(this); shell.style.paddingRight = (++grow % 40) + 'px'; };
    ed.fitLayout();
    window.passes = 0;
    await new Promise((r) => setTimeout(r, 1000));
    delete ed.fitRows;
    return window.passes;
  });
  ok('a layout pass that resizes a watched shell does not run itself again', feeding <= 1, { passes: feeding });

  // A change the layout did not make still re-runs it: the watch is there
  // for a widget that changes size by itself.
  const outside = await p.evaluate(async () => {
    window.passes = 0;
    // As a widget that redraws smaller would: the second row's field, at
    // half the size.
    const widget = document.querySelector('.kce-condition[data-node="r.1"] .kce-sel-ks .ks-wrapper');
    widget.style.fontSize = '50%';
    await new Promise((r) => setTimeout(r, 300));
    const passes = window.passes;
    widget.style.fontSize = '';
    return passes;
  });
  ok('a widget that changes size by itself still re-runs the layout', outside >= 1, { passes: outside });
  await p.ctx.close();

  /* --- 2. Long names, closed: the whole name on hover ------------------- */
  for (const ks of [true, false]) {
    const tag = ks ? 'kSelect' : 'native';
    p = await open({ ks, width: 520 });
    const t = await p.evaluate(() => {
      const row = document.querySelector('.kce-condition[data-node="r.0"]');
      const field = row.querySelector('.kce-sel-field');
      const control = field.querySelector('.ks-control') || field.querySelector('select');
      return {
        title: field.getAttribute('title'),
        operator: row.querySelector('.kce-sel-operator').getAttribute('title'),
        value: row.querySelector('.kce-sel-literal').getAttribute('title'),
        controlTitle: control.getAttribute('title'),
        bare: document.querySelector('.kce-condition[data-node="r.1"] .kce-sel-field').getAttribute('title')
      };
    });
    ok(tag + ': a field name cut with "…" shows the whole name on hover', t.title === FIELDS[9].label, t);
    ok(tag + ': a choice cut with "…" shows itself whole too', t.value === ANSWER.pro, t);
    ok(tag + ': a name shown whole has no tooltip repeating it', t.operator === null, t);
    ok(tag + ': the tooltip is not on the control, where a screen reader would hear the name twice', t.controlTitle === null, t);
    // A screen reader hears the whole name: it is the control's value, cut
    // only in paint. kSelect's combobox is named by its text; a native
    // select's value is its chosen option's.
    const heard = ks
      ? await p.locator('.kce-condition[data-node="r.0"] .kce-sel-field').ariaSnapshot()
      : await p.evaluate(() => { const s = document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-field select'); return s.options[s.selectedIndex].text; });
    ok(tag + ': assistive technology gets the whole field name', heard.indexOf(FIELDS[9].label) !== -1, heard);
    // Widen the column: nothing is cut, so the tooltip goes.
    await p.evaluate(() => { document.querySelector('.col').style.width = '1600px'; });
    await p.waitForTimeout(250);
    const gone = await p.evaluate(() => document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-field').getAttribute('title'));
    ok(tag + ': given room, the name is whole and the tooltip goes', gone === null, { title: gone });
    await p.ctx.close();
  }

  /* --- 3. Long names, open: the list ------------------------------------ */
  p = await open({ width: 640 });
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
  await p.waitForTimeout(150);
  const list = await p.evaluate(() => {
    const dd = openList();
    const r = dd.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(dd).fontSize);
    const texts = Array.from(dd.querySelectorAll('.ks-option .ks-option-text'));
    const cut = texts.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent);
    const one = texts.find((t) => /Cooking$/.test(t.textContent));
    const lh = parseFloat(getComputedStyle(one).lineHeight) || em * 1.45;
    const sel = dd.querySelector('[aria-selected="true"]');
    const box = dd.querySelector('.ks-options').getBoundingClientRect();
    const sr = sel.getBoundingClientRect();
    return {
      width: r.width, em, right: r.right, viewport: document.documentElement.clientWidth,
      cut, wrapped: one.getBoundingClientRect().height > lh * 1.5,
      optionFont: getComputedStyle(one).fontSize,
      selectedInView: sr.top >= box.top - 1 && sr.bottom <= box.bottom + 1,
      // kSelect centres it; how far from the middle it ended up.
      offCentre: Math.abs((sr.top + sr.bottom) / 2 - (box.top + box.bottom) / 2), boxHeight: box.height
    };
  });
  ok('open list: no option is cut with "…"', list.cut.length === 0, list.cut);
  ok('open list: wider than the 14em floor, up to 36em', list.width > 14 * list.em + 1 && list.width <= 36 * list.em + 1, list);
  ok('open list: a question too long for 36em wraps to show its end', list.wrapped, list);
  ok('open list: options at the host\'s --kce-font-size', list.optionFont === '16px', list);
  ok("open list: the current choice is in view, where kSelect put it (the middle)", list.selectedInView && list.offCentre < list.boxHeight / 6, list);
  ok('open list: on screen', list.right <= list.viewport - 7.5, list);

  // Searching narrows the options, not the list.
  await p.keyboard.type('bak');
  await p.waitForTimeout(150);
  const searched = await p.evaluate(() => openList().getBoundingClientRect().width);
  ok('a search does not change the list\'s width', Math.abs(searched - list.width) < 0.5, { before: list.width, after: searched });
  await p.keyboard.press('Escape');
  await p.ctx.close();

  // A list opened from the right of a row, with long answers, near the right
  // edge of the window: kSelect places it at its control's left, so it would
  // run off screen by the difference.
  p = await open({ width: 640, right: true }, { width: 800, height: 760 });
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-literal .ks-control');
  await p.waitForTimeout(150);
  const edge = () => p.evaluate(() => {
    const r = openList().getBoundingClientRect();
    const c = document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-literal .ks-control').getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, controlBottom: c.bottom, viewport: document.documentElement.clientWidth };
  });
  let e = await edge();
  ok('a list opened near the right edge stays on screen', e.right <= e.viewport - 7.5 && e.left >= 7.5, e);
  // kSelect places the list again as the page scrolls; it stays on screen.
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(200);
  e = await edge();
  ok('…and stays on screen, under its control, as the page scrolls', e.right <= e.viewport - 7.5 && Math.abs(e.top - e.controlBottom) < 6, e);
  await p.ctx.close();

  // At the foot of the page the list opens upwards. The answers' list is
  // short enough not to scroll, so widened it is shorter than kSelect placed
  // it — and it keeps its foot on the control.
  p = await open({ width: 640, below: true });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(150);
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-literal .ks-control');
  await p.waitForTimeout(150);
  const up = await p.evaluate(() => {
    const dd = openList();
    const r = dd.getBoundingClientRect();
    const c = document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-literal .ks-control').getBoundingClientRect();
    return { up: dd.classList.contains('ks-dropup'), bottom: r.bottom, controlTop: c.top };
  });
  ok('a list opening upwards keeps its foot on the control', up.up && Math.abs(up.bottom - up.controlTop) < 6, up);
  await p.ctx.close();

  await browser.close();
  site.close();
  finish(errs);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
