/*
 * decorateSelect / releaseSelect / focusSelect: a host's own select widget.
 *
 * The widget here is a stand-in built the way kselect (and most of its kind)
 * is: the real <select> stays in the page, hidden, with its value in step; a
 * button beside it takes focus; its list is portalled to <body>; a pick sets
 * the select and fires a bubbling `change`. It can arrive at once or a little
 * later, as an imported module would, and the host may or may not return the
 * promise.
 *
 * Judged by what a person meets: which widget has focus after a pick that
 * re-rendered the rule, whether the select's own label still paints beside
 * the widget, whether a re-render leaves widgets (and their lists) behind,
 * what the document holds after picking through a widget, and whether the
 * rows still line up.
 *
 *   node tests/browser/run.js decorate-select
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'state', label: 'State', choices: { FL: 'Florida', TX: 'Texas', CA: 'California' } },
  { name: 'arrival', label: 'Arrival', type: 'date' },
  { name: 'rating', label: 'Rating', type: 'number', comparableWith: ['score'] },
  { name: 'score', label: 'Score', type: 'number' },
  { name: 'weeks', label: 'Weeks', type: 'list', group: 'Application', choices: { w1: 'Week 1', w2: 'Week 2', w3: 'Week 3' } },
  { name: 'notes', label: 'Notes', group: 'Staff' }
];

const lit = (v) => ({ source: 'literal', value: v });
const DOC = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'state', operator: 'eq', values: [lit('FL')] },
  { type: 'condition', field: 'arrival', operator: 'date_within_last_days', values: [lit(7)] },
  { type: 'condition', field: 'weeks', operator: 'includes_any', values: [lit(['w2', 'zz'])] },
  { type: 'condition', field: 'rating', operator: 'gt', values: [{ source: 'field', field: 'score' }] }
] } };

// The stand-in widget, and an editor factory taking how the host wires it.
const WIDGET = `
window.Widget = {
  live: [],
  enhance: function (select, mode) {
    function build() {
      if (!select.isConnected || select.fw) return;
      select.style.display = 'none';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fw-button';
      btn.setAttribute('role', 'combobox');
      btn.setAttribute('aria-label', select.getAttribute('aria-label') || '');
      btn.style.cssText = 'font:inherit;padding:2px 8px;border:1px solid #888;border-radius:4px;background:#fff;color:#111';
      var list = document.createElement('div');
      list.className = 'fw-list';
      list.tabIndex = -1;
      document.body.appendChild(list);
      select.parentNode.insertBefore(btn, select.nextSibling);
      select.fw = { btn: btn, list: list };
      Widget.paint(select);
      Widget.live.push(select);
    }
    if (mode === 'sync') return build();
    var later = new Promise(function (r) { setTimeout(r, 40); }).then(build);
    return mode === 'promise' ? later : undefined;
  },
  paint: function (select) {
    select.fw.btn.textContent = Array.prototype.filter.call(select.options, function (o) { return o.selected; })
      .map(function (o) { return o.textContent; }).join(', ') || '—';
  },
  // A pick, as the widget makes one: focus where the widget leaves it, the
  // select set, then a bubbling change.
  pick: function (select, value, focusIn) {
    (focusIn === 'list' ? select.fw.list : select.fw.btn).focus();
    if (select.multiple) {
      Array.prototype.forEach.call(select.options, function (o) { if (o.value === value) o.selected = !o.selected; });
    } else {
      select.value = value;
    }
    Widget.paint(select);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  },
  destroy: function (select) {
    if (!select.fw) return;
    select.fw.btn.remove();
    select.fw.list.remove();
    select.style.display = '';
    select.fw = null;
    Widget.live = Widget.live.filter(function (s) { return s !== select; });
  }
};
window.roles = [];
window.make = function (doc, opts) {
  opts = opts || {};
  if (window.ed) window.ed.destroy();
  document.getElementById('t').value = JSON.stringify(doc);
  window.roles = [];
  var config = {
    fields: FIELDS, skin: opts.skin || 'prose', controls: 'always', collapsible: false, startOpen: true,
    decorateSelect: function (select, info) {
      window.roles.push({ role: info.role, hasId: 'id' in info.node, field: info.field && info.field.name });
      if (opts.decline && opts.decline.indexOf(info.role) !== -1) return false;
      return Widget.enhance(select, opts.mode || 'sync');
    },
    releaseSelect: function (select) { Widget.destroy(select); }
  };
  if (opts.focusHook) config.focusSelect = function (select) { window.focusHookCalls = (window.focusHookCalls || 0) + 1; select.fw && select.fw.btn.focus(); };
  else if (opts.bridge) {
    // The other way to say it: point the select's own focus() at the widget.
    config.decorateSelect = (function (inner) {
      return function (select, info) {
        select.focus = function () { if (select.fw) select.fw.btn.focus(); else HTMLSelectElement.prototype.focus.call(select); };
        return inner(select, info);
      };
    })(config.decorateSelect);
  }
  window.ed = KConditionsEditor.attach('#t', config);
  return window.ed;
};
`;

const page = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>decorate</title>
<link rel="stylesheet" href="src/k-conditions-editor.css"><link rel="stylesheet" href="src/k-conditions-skins.css">
<script src="src/k-conditions-evaluator.js"></script><script src="src/k-conditions-editor.js"></script></head>
<body style="margin:20px"><textarea id="t"></textarea>
<script>var FIELDS = ${JSON.stringify(FIELDS)};${WIDGET}</script></body></html>`;

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  watchErrors(p, errs);
  scratch('decorate-select.html', page());
  await p.goto(site.url + scratch.url('decorate-select.html'));

  const settle = () => p.waitForTimeout(160);
  const state = () => p.evaluate(() => {
    const a = document.activeElement;
    const shell = a && a.closest && a.closest('.kce-sel');
    const sel = shell && shell.querySelector('select');
    return {
      active: a ? a.className : null,
      key: sel ? sel.getAttribute('data-fk') : null,
      selects: document.querySelectorAll('.kce select').length,
      live: Widget.live.length,
      lists: document.querySelectorAll('body > .fw-list').length,
      doc: ed.getDocument().root.children.map((c) => c.field + ' ' + c.operator + ' ' + JSON.stringify(c.values.map((v) => v.value || v.field)))
    };
  });

  /* --- 1. every role, the hook's arguments -------------------------------- */
  await p.evaluate((d) => make(d), DOC);
  await settle();
  const roles = await p.evaluate(() => window.roles);
  const names = Array.from(new Set(roles.map((r) => r.role))).sort();
  ok('every role is offered', JSON.stringify(names) === JSON.stringify(['field', 'fieldValue', 'operator', 'source', 'value', 'values']), names);
  ok('the node is handed over without its internal id', roles.every((r) => !r.hasId), roles);
  ok('the field definition comes with it', roles.filter((r) => r.role === 'value').every((r) => r.field === 'state'), roles);

  /* --- 2. painted: the widget, not the label ------------------------------ */
  const painted = await p.evaluate(() => {
    const shells = Array.from(document.querySelectorAll('.kce-sel'));
    return {
      host: shells.every((s) => s.classList.contains('kce-sel-host')),
      labels: document.querySelectorAll('.kce-sel .kce-sel-label').length,
      // What is painted at the centre of each widget button is the button.
      hits: shells.every((s) => {
        const b = s.querySelector('.fw-button');
        if (!b) return false;
        const r = b.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
      }),
      chevrons: shells.filter((s) => getComputedStyle(s, '::after').content !== 'none').length,
      tails: document.querySelectorAll('.kce-op-tail').length,
      multi: !!document.querySelector('.kce-sel-values select[multiple]'),
      chips: document.querySelectorAll('.kce-taglist').length,
      unknownKept: Array.from(document.querySelectorAll('.kce-sel-values option')).some((o) => o.value === 'zz' && o.selected)
    };
  });
  ok('every select is marked as decorated', painted.host, painted);
  ok('no select label is drawn beside a widget', painted.labels === 0, painted);
  ok('each widget is what is painted where it sits', painted.hits, painted);
  ok('the skin draws no chevron after a widget', painted.chevrons === 0, painted);
  ok('a decorated operator drops the words after its slot (the widget shows them)', painted.tails === 0, painted);
  ok('a list of choices is one <select multiple>', painted.multi && painted.chips === 0, painted);
  ok('a list value the choices lack is kept, chosen', painted.unknownKept, painted);

  /* --- 3. focus after a pick that re-renders the rule --------------------- */
  for (const mode of [
    { name: 'sync widget', opts: { mode: 'sync' } },
    { name: 'async widget, promise returned', opts: { mode: 'promise' } },
    { name: 'async widget, promise not returned, focus() bridged', opts: { mode: 'detached', bridge: true } },
    { name: 'async widget, promise not returned, focusSelect', opts: { mode: 'detached', focusHook: true } },
    { name: 'focus in a portalled list at the change', opts: { mode: 'promise', focusHook: true }, focusIn: 'list' }
  ]) {
    await p.evaluate(([d, o]) => make(d, o), [DOC, mode.opts]);
    await settle();
    await p.evaluate((focusIn) => {
      const sel = document.querySelector('.kce-condition[data-node="r.0"] select.kce-field');
      Widget.pick(sel, 'notes', focusIn);
    }, mode.focusIn || 'button');
    await settle();
    const s = await state();
    ok(mode.name + ': the pick reached the document', s.doc[0].indexOf('notes') === 0, s.doc);
    ok(mode.name + ': focus is on the same row\'s field widget', s.active === 'fw-button' && s.key === 'r.0:field', s);
    ok(mode.name + ': nothing left behind by the re-render', s.live === s.selects && s.lists === s.selects, s);
  }

  /* --- 4. the keyboard still drives the rule from a widget ----------------- */
  await p.evaluate((d) => make(d, { mode: 'promise' }), DOC);
  await settle();
  await p.evaluate(() => Widget.pick(document.querySelector('.kce-condition[data-node="r.0"] select.kce-field'), 'notes'));
  await settle();
  await p.keyboard.press('Control+z');
  await settle();
  let s = await state();
  ok('Ctrl+Z from a widget undoes the pick', s.doc[0].indexOf('state') === 0, s.doc);
  ok('focus stays on the widget through the undo', s.active === 'fw-button' && s.key === 'r.0:field', s);

  /* --- 5. a value choice and a list of choices, picked in the widget ------ */
  await p.evaluate((d) => make(d, { mode: 'sync' }), DOC);
  await settle();
  const before = await p.evaluate(() => document.querySelector('.kce-sel-literal .fw-button'));
  await p.evaluate(() => Widget.pick(document.querySelector('select.kce-literal'), 'TX'));
  await settle();
  s = await state();
  const same = await p.evaluate(() => document.querySelector('.kce-sel-literal .fw-button').textContent);
  ok('a value picked in a widget is the document\'s', s.doc[0] === 'state eq ["TX"]', s.doc);
  ok('the widget shows it', same === 'Texas', same);
  void before;
  await p.evaluate(() => Widget.pick(document.querySelector('.kce-sel-values select'), 'w1'));
  await settle();
  s = await state();
  ok('a list keeps its order and adds at the end', s.doc[2] === 'weeks includes_any [["w2","zz","w1"]]', s.doc);
  await p.evaluate(() => Widget.pick(document.querySelector('.kce-sel-values select'), 'w2'));
  await settle();
  s = await state();
  ok('a deselected value leaves the list', s.doc[2] === 'weeks includes_any [["zz","w1"]]', s.doc);

  /* --- 6. a host may decline a role -------------------------------------- */
  await p.evaluate((d) => make(d, { mode: 'sync', decline: ['operator', 'values'] }), DOC);
  await settle();
  const declined = await p.evaluate(() => {
    const op = document.querySelector('.kce-condition[data-node="r.1"] .kce-sel-operator');
    const tail = document.querySelector('.kce-condition[data-node="r.1"] .kce-op-tail');
    const input = document.querySelector('.kce-condition[data-node="r.1"] .kce-values input');
    const label = op.querySelector('.kce-sel-label');
    return {
      native: !op.classList.contains('kce-sel-host') && !!label,
      head: label && label.textContent,
      tail: tail && tail.textContent,
      // The operand sits in its slot: head, then the value, then the tail.
      order: !!(label && input && tail) &&
        label.getBoundingClientRect().right <= input.getBoundingClientRect().left + 1 &&
        input.getBoundingClientRect().right <= tail.getBoundingClientRect().left + 1,
      chips: document.querySelectorAll('.kce-taglist').length,
      chipText: Array.from(document.querySelectorAll('.kce-tag > span')).map((t) => t.textContent)
    };
  });
  ok('a declined operator keeps the editor\'s own look', declined.native, declined);
  ok('and puts the operand in its slot: "is within the last [7] days"',
    declined.head === 'is within the last' && declined.tail === 'days' && declined.order, declined);
  ok('a declined list gets the chips, showing the choice labels', declined.chips === 1 &&
    JSON.stringify(declined.chipText) === JSON.stringify(['Week 2', 'zz']), declined);

  /* --- 7. a widget that arrives late is laid out once it has --------------- */
  // 'detached': the host did not return the promise, so nothing tells the
  // editor when the widget lands; it has to notice.
  for (const [placement, mode] of [['below', 'promise'], ['inline', 'promise'], ['below', 'detached'], ['inline', 'detached']]) {
    await p.evaluate(([d, pl, m]) => { make(d, { mode: m }); ed.setConnectorPlacement(pl); }, [DOC, placement, mode]);
    await p.waitForTimeout(400);
    const lay = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.kce-condition'));
      const oneLine = rows.every((r) => {
        const kids = Array.from(r.children).filter((k) => k.getBoundingClientRect().width > 0);
        const tops = kids.map((k) => k.getBoundingClientRect().top);
        const bottoms = kids.map((k) => k.getBoundingClientRect().bottom);
        // Every visible item shares one band: none starts below another's foot.
        return Math.max.apply(null, tops) < Math.min.apply(null, bottoms);
      });
      const conn = document.querySelector('.kce-line > .kce-connector .kce-connector-btn');
      const field = document.querySelector('.kce-line .kce-sel-field');
      // Inline, the AND / OR after the rows stand in one column — measured
      // after the widgets widened the rows.
      const lefts = Array.from(document.querySelectorAll('.kce-connector[data-conn-depth="0"] .kce-connector-btn'))
        .map((b) => Math.round(b.getBoundingClientRect().left));
      return {
        oneLine,
        column: lefts.length > 1 && Math.max.apply(null, lefts) - Math.min.apply(null, lefts) <= 1,
        lefts,
        below: document.querySelector('.kce').getAttribute('data-kce-connectors'),
        // Below, the AND starts where the field's widget starts.
        shift: conn && field ? Math.abs(conn.getBoundingClientRect().left + parseFloat(getComputedStyle(conn).paddingLeft) - field.getBoundingClientRect().left) : null
      };
    });
    ok(placement + ' / ' + mode + ': every row stays on one line with widgets in it', lay.oneLine, lay);
    if (placement === 'below') ok(mode + ': the AND lines up under the field widget once it has arrived', lay.shift !== null && lay.shift < 2, lay);
    else ok(mode + ': inline, the AND / OR form a column once the widgets have arrived', lay.column, lay);
  }

  /* --- 8. destroy() lets every widget go ---------------------------------- */
  await p.evaluate(() => ed.destroy());
  const gone = await p.evaluate(() => ({ live: Widget.live.length, lists: document.querySelectorAll('body > .fw-list').length }));
  ok('destroy() releases every widget', gone.live === 0 && gone.lists === 0, gone);
  await p.evaluate(() => { window.ed = null; });

  /* --- 9. no hook: the editor's own controls, unchanged -------------------- */
  const plain = await p.evaluate((d) => {
    document.getElementById('t').value = JSON.stringify(d);
    const e = KConditionsEditor.attach('#t', { fields: FIELDS, collapsible: false, startOpen: true });
    const r = {
      host: document.querySelectorAll('.kce-sel-host').length,
      chips: document.querySelectorAll('.kce-taglist').length,
      multi: document.querySelectorAll('select[multiple]').length,
      labels: document.querySelectorAll('.kce-sel-label').length
    };
    e.destroy();
    return r;
  }, DOC);
  ok('without decorateSelect nothing changes', plain.host === 0 && plain.chips === 1 && plain.multi === 0 && plain.labels > 4, plain);

  await browser.close();
  site.close();
  finish(errs);
})();
