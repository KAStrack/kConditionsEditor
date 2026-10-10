const { chromium } = require('playwright');
const { serve } = require('./harness.js');

const FIELDS = [
  { name: 'name',  label: 'Name',  type: 'text' },
  { name: 'nick',  label: 'Nickname', type: 'text' },
  { name: 'state', label: 'State', type: 'enum', choices: { FL: 'Florida', TX: 'Texas' } },
  { name: 'other', label: 'Other State', type: 'enum', choices: { FL: 'Florida', TX: 'Texas' } }
];

function doc(op, value, source) {
  return { version: '1.0', root: { type: 'group', operator: 'and', children: [
    { type: 'condition', field: 'state', operator: op,
      values: [source === 'field'
        ? { source: 'field', field: value }
        : { source: 'literal', value: value }] }
  ] } };
}

(async () => {
  const site = await serve();
  const PAGE = (name) => site.url + '/' + name;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(String(e)));
  let fail = 0;
  const ok = (n, c, x) => { if (!c) { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(x)); } };

  await p.goto(PAGE('docs/demo.html'));
  await p.waitForTimeout(500);

  await p.evaluate(([FIELDS]) => {
    window.__mk = function (document_, opts) {
      const host = window.__host || (window.__host = (() => {
        const d = window.document.createElement('div');
        window.document.body.innerHTML = '';
        window.document.body.appendChild(d);
        return d;
      })());
      host.innerHTML = '<textarea id="t"></textarea>';
      host.querySelector('#t').value = JSON.stringify(document_);
      var ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
      if (ed.setOpen) ed.setOpen(true);
      return ed;
    };
  }, [FIELDS]);

  // ---- 1. the control type per operator, on an enum field -------------------
  const OPS = [
    ['eq', 'select'], ['neq', 'select'],
    ['contains', 'input'], ['not_contains', 'input'],
    ['starts_with', 'input'], ['ends_with', 'input'],
    ['regex', 'input'], ['not_regex', 'input']
  ];
  for (const [op, want] of OPS) {
    const got = await p.evaluate(([d]) => {
      window.__mk(d);
      const lit = document.querySelector('.kce-value .kce-literal');
      return lit ? lit.tagName.toLowerCase() : '(none)';
    }, [doc(op, 'FL')]);
    ok('control for ' + op, got === want, { op, want, got });
  }

  // The stored value must survive the switch and be editable as text.
  const typed = await p.evaluate(async ([d]) => {
    const ed = window.__mk(d);
    const input = document.querySelector('.kce-value input.kce-literal');
    input.focus();
    input.value = 'lor';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { value: ed.getDocument().root.children[0].values[0].value, summary: ed.describe() };
  }, [doc('contains', 'FL')]);
  ok('typing a fragment', typed.value === 'lor', typed);
  ok('summary shows the fragment, not a label',
    typed.summary.indexOf('"lor"') !== -1 && typed.summary.indexOf('Florida') === -1, typed);

  // eq still shows labels in the summary
  const eqSummary = await p.evaluate(([d]) => window.__mk(d).describe(), [doc('eq', 'FL')]);
  ok('eq still labels', eqSummary.indexOf('"Florida"') !== -1, eqSummary);

  // ---- 2. the field picker, default off ------------------------------------
  const off = await p.evaluate(([d]) => {
    window.__mk(d);
    return {
      sourceSelects: document.querySelectorAll('.kce-source').length,
      literal: !!document.querySelector('.kce-literal')
    };
  }, [doc('eq', 'FL')]);
  ok('no source picker by default', off.sourceSelects === 0, off);
  ok('value control still rendered', off.literal, off);

  const on = await p.evaluate(([d]) => {
    window.__mk(d, { allowFieldValues: true });
    return document.querySelectorAll('.kce-source').length;
  }, [doc('eq', 'FL')]);
  ok('allowFieldValues:true shows it', on === 1, on);

  // a field naming comparableWith opts itself in with the global off
  const optIn = await p.evaluate(([d, FIELDS]) => {
    const fields = JSON.parse(JSON.stringify(FIELDS));
    fields[2].comparableWith = ['other'];
    window.__mk(d, { fields });
    return document.querySelectorAll('.kce-source').length;
  }, [doc('eq', 'FL'), FIELDS]);
  ok('comparableWith opts in', optIn === 1, optIn);

  // comparableWith:false still wins when the global is on
  const optOut = await p.evaluate(([d, FIELDS]) => {
    const fields = JSON.parse(JSON.stringify(FIELDS));
    fields[2].comparableWith = false;
    window.__mk(d, { fields, allowFieldValues: true });
    return document.querySelectorAll('.kce-source').length;
  }, [doc('eq', 'FL'), FIELDS]);
  ok('comparableWith:false opts out', optOut === 0, optOut);

  // ---- 3. an existing field reference is not a trap ------------------------
  const existing = await p.evaluate(([d]) => {
    const ed = window.__mk(d);                       // allowFieldValues defaults false
    const src = document.querySelector('.kce-source');
    const fv = document.querySelector('.kce-field-value');
    const out = {
      sourceShown: !!src,
      fieldOptions: fv ? [...fv.options].map(o => o.value) : [],
      selected: fv ? fv.value : null
    };
    if (src) {                                        // and it can be escaped
      src.value = 'literal';
      src.dispatchEvent(new Event('change', { bubbles: true }));
      out.afterSwitch = ed.getDocument().root.children[0].values[0].source;
    }
    return out;
  }, [doc('eq', 'other', 'field')]);
  ok('existing field ref keeps its picker', existing.sourceShown, existing);
  ok('the referenced field is listed', existing.fieldOptions.indexOf('other') !== -1, existing);
  ok('can switch back to a literal', existing.afterSwitch === 'literal', existing);

  // a reference to a field the rules would not offer is still shown
  const stale = await p.evaluate(([d, FIELDS]) => {
    const fields = JSON.parse(JSON.stringify(FIELDS));
    fields[2].comparableWith = false;
    window.__mk(d, { fields });
    const fv = document.querySelector('.kce-field-value');
    return { options: fv ? [...fv.options].map(o => o.value) : [], value: fv ? fv.value : null };
  }, [doc('eq', 'other', 'field'), FIELDS]);
  ok('a stale reference is still shown', stale.options.indexOf('other') !== -1, stale);

  // ---- 4. non-enum fields unaffected --------------------------------------
  const plain = await p.evaluate(([FIELDS]) => {
    const d = { version: '1.0', root: { type: 'group', operator: 'and', children: [
      { type: 'condition', field: 'name', operator: 'contains',
        values: [{ source: 'literal', value: 'ben' }] }] } };
    window.__mk(d, { fields: FIELDS });
    const lit = document.querySelector('.kce-literal');
    return lit ? lit.tagName.toLowerCase() : '(none)';
  }, [FIELDS]);
  ok('text field + contains is an input', plain === 'input', plain);

  console.log('\nfailures: ' + fail);
  console.log('ERRORS: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  site.close();
})();
