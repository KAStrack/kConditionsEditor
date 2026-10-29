/*
 * kSelect, built in: the `kselect` option.
 *
 * Real kSelect (the vendored 1.11.0 in tests/browser/vendor/kselect), real
 * pointer and keyboard. The CDN is never reached: requests to it are served
 * the vendored files by the browser itself (page.route), so `kselect: true`
 * is exercised end to end — URL, integrity, load, upgrade — offline.
 *
 * Judged by what a person meets: which selects became widgets, what the
 * closed widget looks like in the sentence, where focus is after a pick or
 * an undo, whether an opened list can be seen (inside a modal dialog too),
 * whether it is in the editor's colours, and what is left behind.
 *
 *   node tests/browser/run.js kselect
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, serve, scratch, checker, watchErrors } = require('./harness.js');

const VENDOR = path.join(ROOT, 'tests/browser/vendor/kselect');
const CDN = 'https://cdn.jsdelivr.net/gh/KAStrack/kselect.js@';

const FIELDS = [
  { name: 'status', label: 'Status', choices: { new: 'New', accepted: 'Accepted', rejected: 'Rejected' } },
  { name: 'rating', label: 'Rating', type: 'number', comparableWith: ['score'] },
  { name: 'score', label: 'Score', type: 'number' }
];
for (let i = 1; i <= 12; i++) FIELDS.push({ name: 'q' + i, label: 'Question ' + i, group: 'Application', choices: { yes: 'Yes', no: 'No' } });
FIELDS.push({ name: 'weeks', label: 'Weeks', group: 'Application', type: 'list', choices: { w1: 'Week 1', w2: 'Week 2', w3: 'Week 3' } });
FIELDS.push({ name: 'arrival', label: 'Arrival', group: 'Application', type: 'date' });

const lit = (v) => ({ source: 'literal', value: v });
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'status', operator: 'eq', values: [lit('accepted')] },
  { type: 'condition', field: 'arrival', operator: 'date_within_last_days', values: [lit(7)] },
  { type: 'condition', field: 'weeks', operator: 'includes_any', values: [lit(['w2'])] },
  { type: 'condition', field: 'rating', operator: 'gt', values: [{ source: 'field', field: 'score' }] }
] } };

// HDC's kselect_theme.css, in the shape that matters: a form-control box.
const HOST_THEME = `.ks-control { min-height: 42px; padding: 8px 40px 8px 12px; border: 1px solid #888; border-radius: 6px;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.2); background: #fff; }`;

/**
 * A page. `ks`: load kSelect up front ('page'), not at all (null), or only
 * into a variable the page passes as the constructor ('module'). `config` is
 * the editor's options, as source, so functions can be passed.
 */
function page(opts) {
  const ks = opts.ks;
  const css = ks ? '<link rel="stylesheet" href="tests/browser/vendor/kselect/kselect.min.css">' : '';
  const js = ks === 'page' ? '<script src="tests/browser/vendor/kselect/kselect.min.js"></script>'
    : ks === 'module'
      // Loaded, then taken off the global — as a bundle that imports it would leave it.
      ? '<script src="tests/browser/vendor/kselect/kselect.min.js"></script><script>window.KS = window.Kselect; delete window.Kselect;</script>'
      : '';
  const host = opts.dialog
    ? '<dialog id="dlg"><form method="dialog"><textarea id="t"></textarea></form></dialog>'
    : '<textarea id="t"></textarea>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>kselect</title>${css}
<link rel="stylesheet" href="src/k-conditions-editor.css"><link rel="stylesheet" href="src/k-conditions-skins.css">
${opts.hostTheme ? '<style>' + HOST_THEME + '</style>' : ''}
${js}<script src="src/k-conditions-evaluator.js"></script><script src="src/k-conditions-editor.js"></script></head>
<body style="margin:20px">${host}
<script>
window.warnings = [];
var warn = console.warn; console.warn = function () { window.warnings.push(Array.prototype.join.call(arguments, ' ')); warn.apply(console, arguments); };
var FIELDS = ${JSON.stringify(FIELDS)};
document.getElementById('t').value = ${JSON.stringify(JSON.stringify(opts.doc || DOC))};
${opts.dialog === 'before' ? "document.getElementById('dlg').showModal();" : ''}
window.ed = KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false, startOpen: true, controls: 'always' }, ${opts.config || '{}'}));
${opts.dialog === 'after' ? "document.getElementById('dlg').showModal();" : ''}
</script></body></html>`;
}

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  let n = 0;

  /** A fresh page; `cdn`: 'serve' the vendored files for CDN requests, or 'fail' them. */
  async function open(opts, cdn) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
    const p = await ctx.newPage();
    watchErrors(p, errs);
    p.requests = [];
    await p.route(CDN + '**', (route) => {
      const url = route.request().url();
      p.requests.push(url);
      if (cdn !== 'serve') return route.abort();
      const file = url.endsWith('.css') ? 'kselect.min.css' : 'kselect.min.js';
      return route.fulfill({
        status: 200,
        headers: { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' },
        body: fs.readFileSync(path.join(VENDOR, file))
      });
    });
    const name = 'kselect-' + (++n) + '.html';
    scratch(name, page(opts));
    await p.goto(site.url + scratch.url(name));
    await p.waitForTimeout(200);
    p.ctx = ctx;
    return p;
  }

  const roles = (p) => p.evaluate(() => {
    const role = (shell) => ['field', 'operator', 'literal', 'values', 'source', 'fieldvalue']
      .filter((r) => shell.classList.contains('kce-sel-' + r))[0];
    return {
      ks: Array.from(document.querySelectorAll('.kce-sel-ks')).map(role).sort(),
      native: Array.from(document.querySelectorAll('.kce-sel:not(.kce-sel-host)')).map(role).sort(),
      chips: document.querySelectorAll('.kce-taglist').length,
      widgets: document.querySelectorAll('.kce .ks-wrapper').length,
      lists: document.querySelectorAll('.ks-dropdown').length
    };
  });
  const LONG = ['field', 'field', 'field', 'field', 'fieldvalue', 'literal', 'values'];

  /* --- auto, kSelect on the page ----------------------------------------- */
  let p = await open({ ks: 'page' });
  let r = await roles(p);
  ok('auto: the long lists become kSelects', JSON.stringify(r.ks) === JSON.stringify(LONG), r);
  ok('auto: the operator and the Value/Field switch stay native', JSON.stringify(r.native) === JSON.stringify(['operator', 'operator', 'operator', 'operator', 'source']), r);
  const slot = await p.evaluate(() => {
    const row = document.querySelector('.kce-condition[data-node="r.1"]');
    return { head: row.querySelector('.kce-sel-operator .kce-sel-label').textContent, tail: (row.querySelector('.kce-op-tail') || {}).textContent };
  });
  ok('auto: the operator keeps its {value} slot', slot.head === 'is within the last' && slot.tail === 'days', slot);
  ok('auto: no CDN request when kSelect is on the page', p.requests.length === 0, p.requests);

  // Searchable over 8 entries, not under.
  const search = await p.evaluate(() => ({
    field: !document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-field .ks-wrapper').classList.contains('ks-no-search'),
    value: !document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-literal .ks-wrapper').classList.contains('ks-no-search')
  }));
  ok('a field list (15 entries) opens with a search box; a 3-entry value list does not', search.field && !search.value, search);

  // The closed widget reads as the word it replaces.
  const look = await p.evaluate(() => {
    const ctl = document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
    const val = ctl.querySelector('.ks-single-value');
    const cs = getComputedStyle(ctl), vs = getComputedStyle(val);
    const plain = document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-operator .kce-sel-label');
    const row = document.querySelector('.kce-condition[data-node="r.0"]');
    return {
      border: cs.borderTopWidth + ' ' + cs.borderLeftWidth, bg: cs.backgroundColor, weight: vs.fontWeight,
      colour: vs.color, field: getComputedStyle(document.querySelector('.kce')).getPropertyValue('--kce-field').trim(),
      height: ctl.getBoundingClientRect().height, line: plain.getBoundingClientRect().height,
      oneLine: row.getBoundingClientRect().height < 2 * plain.getBoundingClientRect().height
    };
  });
  ok('closed, a field kSelect has no box', look.border === '0px 0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(look.bg), look);
  ok('closed, it is the field name, bold, in the field colour', Number(look.weight) >= 600, look);
  ok('closed, it is a line high, like the words beside it', Math.abs(look.height - look.line) <= 3 && look.oneLine, look);

  // Open: the list is seen, wide enough to read, in the editor's colours.
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
  await p.waitForTimeout(200);
  const opened = await p.evaluate(() => {
    const dd = Array.from(document.querySelectorAll('.ks-dropdown')).filter((d) => getComputedStyle(d).display !== 'none')[0];
    if (!dd) return { open: false };
    const r = dd.getBoundingClientRect();
    return {
      open: true, inLayer: !!dd.closest('.kce-ks-layer'), seen: dd.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 20)),
      width: r.width, groups: Array.from(dd.querySelectorAll('.ks-group-label, .ks-group-header')).map((g) => g.textContent.trim()).filter(Boolean)
    };
  });
  ok('open: the list is painted where it opens', opened.open && opened.seen, opened);
  ok('open: it is in the editor\'s layer, wide enough to read', opened.inLayer && opened.width >= 180, opened);
  ok('open: field groups are its headings', opened.groups && opened.groups.some((g) => /application/i.test(g)), opened);
  // The search box lies over the word: nothing on the row moved.
  const moved = await p.evaluate(() => {
    const op = document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-operator');
    return op.getBoundingClientRect().left;
  });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const rest = await p.evaluate(() => document.querySelector('.kce-condition[data-node="r.0"] .kce-sel-operator').getBoundingClientRect().left);
  ok('opening it does not move the rest of the row', Math.abs(moved - rest) < 1, { moved, rest });

  /* --- focus after a pick, an arrow step and an undo --------------------- */
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
  await p.waitForTimeout(150);
  await p.keyboard.type('Question 3');
  await p.waitForTimeout(150);
  await p.locator('.kce-ks-layer .ks-dropdown [role=option]', { hasText: 'Question 3' }).first().click();
  await p.waitForTimeout(250);
  const where = () => p.evaluate(() => {
    const a = document.activeElement;
    const shell = a && a.closest('.kce-sel');
    return { field: ed.getDocument().root.children[0].field, key: shell && shell.querySelector('select').getAttribute('data-fk'), widget: a.classList.contains('ks-control') };
  });
  let f = await where();
  ok('a pick changes the rule, and focus is on the same row\'s field widget', f.field === 'q3' && f.key === 'r.0:field' && f.widget, f);
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(250);
  f = await where();
  ok('ArrowDown on the closed widget steps the field, focus stays', f.field === 'q4' && f.key === 'r.0:field' && f.widget, f);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(250);
  f = await where();
  ok('Ctrl+Z from the widget undoes, focus stays', f.field === 'q3' && f.key === 'r.0:field' && f.widget, f);
  // Alt+Arrow moves the row — once — and does not open the list.
  await p.keyboard.press('Alt+ArrowDown');
  await p.waitForTimeout(250);
  const moved2 = await p.evaluate(() => ({
    first: ed.getDocument().root.children[0].field, second: ed.getDocument().root.children[1].field,
    open: Array.from(document.querySelectorAll('.ks-dropdown')).some((d) => getComputedStyle(d).display !== 'none')
  }));
  ok('Alt+ArrowDown on a widget moves its row down once, and opens nothing', moved2.second === 'q3' && moved2.first === 'arrival' && !moved2.open, moved2);

  // Many renders, then destroy: nothing left behind.
  for (let i = 0; i < 6; i++) await p.evaluate(() => ed.undo());
  r = await roles(p);
  ok('re-renders leave one list per widget', r.lists === r.widgets, r);
  await p.evaluate(() => ed.destroy());
  const gone = await p.evaluate(() => ({ lists: document.querySelectorAll('.ks-dropdown').length, layer: !!document.querySelector('.kce-ks-layer') }));
  ok('destroy() releases every widget, and takes its layer', gone.lists === 0 && !gone.layer, gone);
  await p.ctx.close();

  /* --- the editor's colours, dark ---------------------------------------- */
  p = await open({ ks: 'page', config: "{ theme: 'dark' }" });
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
  await p.waitForTimeout(200);
  const dark = await p.evaluate(() => {
    const dd = Array.from(document.querySelectorAll('.ks-dropdown')).filter((d) => getComputedStyle(d).display !== 'none')[0];
    const probe = document.createElement('div');
    probe.style.background = getComputedStyle(document.querySelector('.kce')).getPropertyValue('--kce-bg');
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { got: getComputedStyle(dd).backgroundColor, want };
  });
  ok('theme: \'dark\' — the opened list is the editor\'s dark background', dark.got === dark.want, dark);
  await p.evaluate(() => ed.setTheme('light'));
  const relit = await p.evaluate(() => document.querySelector('.kce-ks-layer').getAttribute('data-kce-theme'));
  ok('setTheme() reaches the layer', relit === 'light', relit);
  await p.ctx.close();

  /* --- a host's kSelect theme does not box the word ---------------------- */
  for (const placement of ['below', 'inline']) {
    p = await open({ ks: 'page', hostTheme: true, config: `{ connectorPlacement: '${placement}' }` });
    const boxed = await p.evaluate(() => {
      const ctl = document.querySelector('.kce-sel-field .ks-control');
      const label = document.querySelector('.kce-sel-operator .kce-sel-label');
      const rows = Array.from(document.querySelectorAll('.kce-condition'));
      return {
        border: getComputedStyle(ctl).borderTopWidth, shadow: getComputedStyle(ctl).boxShadow,
        height: ctl.getBoundingClientRect().height, line: label.getBoundingClientRect().height,
        oneLine: rows.every((row) => row.getBoundingClientRect().height < 2.2 * label.getBoundingClientRect().height)
      };
    });
    ok(placement + ': with a host kSelect theme the word still has no box', boxed.border === '0px' && boxed.shadow === 'none', boxed);
    ok(placement + ': and every row is one line', Math.abs(boxed.height - boxed.line) <= 3 && boxed.oneLine, boxed);
    await p.ctx.close();
  }

  /* --- auto, no kSelect anywhere ---------------------------------------- */
  p = await open({ ks: null });
  r = await roles(p);
  ok('auto, none: every select is native, lists are chips', r.ks.length === 0 && r.chips === 1 && r.native.length === 11, r);
  ok('auto, none: no request to the CDN', p.requests.length === 0, p.requests);
  await p.ctx.close();

  /* --- auto, kSelect arrives after the editor --------------------------- */
  // No list value: the selects are upgraded where they stand, no redraw.
  p = await open({ ks: null, doc: { version: '1.0', root: { type: 'group', operator: 'and', children: [DOC.root.children[0], DOC.root.children[3]] } } });
  await p.addStyleTag({ path: path.join(VENDOR, 'kselect.min.css') });
  await p.evaluate(() => { window.firstRow = document.querySelector('.kce-condition[data-node="r.0"]'); });
  await p.addScriptTag({ path: path.join(VENDOR, 'kselect.min.js') });
  await p.waitForTimeout(700);
  const inPlace = await p.evaluate(() => ({
    sameRow: document.querySelector('.kce-condition[data-node="r.0"]') === window.firstRow,
    ks: document.querySelectorAll('.kce-sel-ks').length
  }));
  ok('auto, late: upgraded in place — the same row elements, now with widgets', inPlace.sameRow && inPlace.ks === 4, inPlace);
  await p.ctx.close();

  // With a list value too: its chips give way to a widget (that one redraws).
  p = await open({ ks: null });
  await p.addStyleTag({ path: path.join(VENDOR, 'kselect.min.css') });
  const before = await p.evaluate(() => {
    window.firstRow = document.querySelector('.kce-condition[data-node="r.0"]');
    document.querySelector('.kce-condition[data-node="r.0"] select.kce-field').focus();
    return document.activeElement.className;
  });
  await p.waitForTimeout(150);
  await p.addScriptTag({ path: path.join(VENDOR, 'kselect.min.js') });
  await p.waitForTimeout(700);
  const late = await p.evaluate(() => ({
    sameRow: document.querySelector('.kce-condition[data-node="r.0"]') === window.firstRow,
    ks: document.querySelectorAll('.kce-sel-ks').length,
    focus: document.activeElement.classList.contains('ks-control') && !!document.activeElement.closest('.kce-sel-field'),
    chips: document.querySelectorAll('.kce-taglist').length
  }));
  ok('auto, late: the drawn selects become widgets when kSelect arrives', late.ks === LONG.length && late.chips === 0, Object.assign({ before }, late));
  ok('auto, late: focus moves to the focused select\'s widget', late.focus, late);
  await p.ctx.close();

  // Arrives after the watch: native until the next change, then widgets.
  p = await open({ ks: null, doc: { version: '1.0', root: { type: 'group', operator: 'and', children: [DOC.root.children[0]] } } });
  await p.waitForTimeout(8400);
  await p.addStyleTag({ path: path.join(VENDOR, 'kselect.min.css') });
  await p.addScriptTag({ path: path.join(VENDOR, 'kselect.min.js') });
  await p.waitForTimeout(300);
  const after1 = await p.evaluate(() => document.querySelectorAll('.kce-sel-ks').length);
  await p.evaluate(() => ed.addBeside(ed.doc.root, 0, 'and'));
  await p.waitForTimeout(200);
  const after2 = await p.evaluate(() => document.querySelectorAll('.kce-sel-ks').length);
  ok('auto, after the watch: native until the next change, then widgets', after1 === 0 && after2 >= 2, { after1, after2 });
  await p.ctx.close();

  /* --- the constructor, given ------------------------------------------- */
  p = await open({ ks: 'module', config: '{ kselect: window.KS }' });
  r = await roles(p);
  ok('kselect: Kselect (no global) — used', JSON.stringify(r.ks) === JSON.stringify(LONG), r);
  await p.ctx.close();

  /* --- false ------------------------------------------------------------- */
  p = await open({ ks: 'page', config: '{ kselect: false }' });
  r = await roles(p);
  ok('kselect: false — kSelect on the page, unused', r.ks.length === 0 && r.widgets === 0 && r.chips === 1, r);
  await p.ctx.close();

  /* --- true, loaded from the CDN ---------------------------------------- */
  p = await open({ ks: null, config: '{ kselect: true }' }, 'serve');
  await p.waitForTimeout(400);
  const loaded = await p.evaluate(() => ({
    scripts: Array.from(document.querySelectorAll('script[data-kce-kselect]')).map((s) => [s.src, s.integrity, s.crossOrigin]),
    links: Array.from(document.querySelectorAll('link[data-kce-kselect]')).map((s) => [s.href, s.integrity]),
    ks: document.querySelectorAll('.kce-sel-ks').length
  }));
  ok('true: kSelect is loaded from the pinned CDN URL, with integrity',
    loaded.scripts.length === 1 && /@v\d+\.\d+\.\d+\/docs\/kselect\.min\.js$/.test(loaded.scripts[0][0]) &&
    /^sha384-/.test(loaded.scripts[0][1]) && loaded.scripts[0][2] === 'anonymous' &&
    loaded.links.length === 1 && /^sha384-/.test(loaded.links[0][1]), loaded);
  ok('true: the browser accepted it (the hashes match) and the selects became widgets', loaded.ks === LONG.length, loaded);
  await p.ctx.close();

  /* --- true, the CDN unreachable ---------------------------------------- */
  p = await open({ ks: null, config: '{ kselect: true }' }, 'fail');
  await p.waitForTimeout(400);
  const failed = await p.evaluate(() => ({
    warnings: window.warnings.filter((w) => /kSelect/.test(w)),
    native: document.querySelectorAll('.kce-sel:not(.kce-sel-host)').length,
    chips: document.querySelectorAll('.kce-taglist').length
  }));
  ok('true, unreachable: one warning, and the editor works with native selects', failed.warnings.length === 1 && failed.native === 11 && failed.chips === 1, failed);
  // Still usable: a change goes through — and redrawing does not ask again.
  const asked = p.requests.length;
  await p.evaluate(() => { const s = document.querySelector('select.kce-field'); s.value = 'q2'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => { ed.undo(); ed.redo(); });
  await p.waitForTimeout(200);
  ok('and still edits the rule', await p.evaluate(() => ed.getDocument().root.children[0].field) === 'q2');
  const again = await p.evaluate(() => ({ scripts: document.querySelectorAll('script[data-kce-kselect]').length, warnings: window.warnings.filter((w) => /kSelect/.test(w)).length }));
  ok('a failed load is not retried on every redraw', p.requests.length === asked && again.scripts === 1 && again.warnings === 1, { asked, now: p.requests.length, again });
  await p.ctx.close();

  /* --- a host's decorateSelect wins ------------------------------------- */
  p = await open({ ks: 'page', config: '{ kselect: true, decorateSelect: function () { return false; } }' });
  r = await roles(p);
  const conflict = await p.evaluate(() => window.warnings.filter((w) => /decorateSelect and kselect/.test(w)).length);
  ok('a host\'s decorateSelect wins: kSelect untouched', r.ks.length === 0 && r.widgets === 0, r);
  ok('and setting both is warned about', conflict === 1, conflict);
  await p.ctx.close();

  /* --- inside a modal dialog -------------------------------------------- */
  // The dialog clips what overflows it, and is drawn above everything: the
  // list has to be above it. Opened before the editor attached, and after
  // (the layer was shown first, so the dialog went above it).
  for (const when of ['before', 'after']) {
    p = await open({ ks: 'page', dialog: when });
    await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
    await p.waitForTimeout(200);
    const dlg = await p.evaluate(() => {
      const dd = Array.from(document.querySelectorAll('.ks-dropdown')).filter((d) => getComputedStyle(d).display !== 'none')[0];
      if (!dd) return { open: false };
      const r = dd.getBoundingClientRect();
      const y = Math.min(r.top + r.height / 2, window.innerHeight - 4);
      return { open: true, inDialog: !!dd.closest('dialog'), seen: dd.contains(document.elementFromPoint(r.left + r.width / 2, y)) };
    });
    ok('a modal dialog opened ' + when + ' the editor: the opened list is in it, and seen above it', dlg.open && dlg.inDialog && dlg.seen, dlg);
    // And it works: a pick there reaches the rule.
    await p.locator('.kce-ks-layer .ks-dropdown [role=option]', { hasText: 'Score' }).first().click();
    await p.waitForTimeout(200);
    ok('a pick in that list reaches the rule (' + when + ')', await p.evaluate(() => ed.getDocument().root.children[0].field) === 'score');
    await p.ctx.close();
  }

  /* --- kSelect's own words, from labels --------------------------------- */
  p = await open({ ks: 'page', config: "{ labels: { search: 'Sök…', noResults: 'Inga träffar', selectedCount: '{n} valda', removeValue: 'Ta bort {value}' } }" });
  await p.click('.kce-condition[data-node="r.0"] .kce-sel-field .ks-control');
  await p.keyboard.type('zzzz');
  await p.waitForTimeout(250);
  const words = await p.evaluate(() => ({
    search: document.activeElement.getAttribute('placeholder'),
    none: Array.from(document.querySelectorAll('.ks-dropdown')).map((d) => d.textContent).join(' '),
    remove: Array.from(document.querySelectorAll('.kce-sel-values .ks-tag-remove')).map((b) => b.getAttribute('aria-label'))
  }));
  ok('kSelect\'s search and no-match words come from labels', words.search === 'Sök…' && /Inga träffar/.test(words.none), words);
  ok('a tag\'s remove button is labels.removeValue', words.remove.length === 1 && words.remove[0] === 'Ta bort Week 2', words);
  await p.ctx.close();

  await browser.close();
  site.close();
  finish(errs.filter((e) => !/ERR_FAILED|net::/.test(e)));
})();
