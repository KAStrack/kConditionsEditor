// A `list` field: a value that is itself a list (a multi-select, tags). The
// field offers the list operators, the operand control is the chip list fed by
// the field's choices, and describe() labels the chips from those choices.
const { chromium } = require('playwright');
const { serve, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'tags', label: 'Tags', type: 'list', choices: { red: 'Red', blue: 'Blue', green: 'Green' } }
];

function doc(op, value) {
  return { version: '1.0', root: { type: 'group', operator: 'and', children: [
    { type: 'condition', field: 'tags', operator: op, values: [{ source: 'literal', value: value }] }
  ] } };
}

(async () => {
  const site = await serve();
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const errs = watchErrors(page, []);
  const { ok, finish } = checker();

  await page.goto(site.url + '/docs/demo.html');
  await page.waitForTimeout(300);
  await page.evaluate(([FIELDS]) => {
    window.__mk = function (document_, opts) {
      const host = window.__host || (window.__host = (() => {
        const d = window.document.createElement('div');
        window.document.body.innerHTML = '';
        window.document.body.appendChild(d);
        return d;
      })());
      host.innerHTML = '<textarea id="t"></textarea>';
      host.querySelector('#t').value = JSON.stringify(document_);
      const ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
      if (ed.setOpen) ed.setOpen(true);
      return ed;
    };
    window.__opSelect = () => [...document.querySelectorAll('select')]
      .find(s => [...s.options].some(o => o.value === 'includes_any')) || null;
  }, [FIELDS]);

  // 1. the operator menu of a list field
  const ops = await page.evaluate(([d]) => {
    window.__ed = window.__mk(d);
    const s = window.__opSelect();
    return s ? [...s.options].map(o => o.value) : null;
  }, [doc('includes_any', ['red'])]);
  ok('a list field offers includes_any and includes_all', ops && ops.includes('includes_any') && ops.includes('includes_all'), { ops });
  ok('a list field does not offer fragment operators', ops && !ops.includes('contains') && !ops.includes('starts_with'), { ops });
  ok('a list field keeps the existence group', ops && ops.includes('is_empty'), { ops });

  // 2. the operand control is the chip list, fed by the choices
  const control = await page.evaluate(() => {
    const box = document.querySelector('.kce-taglist');
    const add = box && box.querySelector('select.kce-tag-input');
    return {
      hasBox: !!box,
      chips: box ? [...box.querySelectorAll('.kce-tag')].map(t => t.textContent.replace('×', '').trim()) : [],
      addOptions: add ? [...add.options].map(o => o.textContent) : null
    };
  });
  ok('the operand is the chip list', control.hasBox && control.chips.length === 1, control);
  ok('the add control offers the field\'s choices by label', control.addOptions && control.addOptions.includes('Blue') && control.addOptions.includes('Green'), control);

  // 3. adding a chip from the choices reaches the document
  const after = await page.evaluate(() => {
    const add = document.querySelector('.kce-taglist select.kce-tag-input');
    add.value = 'blue';
    add.dispatchEvent(new Event('change', { bubbles: true }));
    const d = window.__ed.getDocument();
    return { value: d.root.children[0].values[0].value, text: window.__ed.describe() };
  });
  ok('the chosen value is appended', JSON.stringify(after.value) === JSON.stringify(['red', 'blue']), after);
  ok('describe() labels the chips from the choices', after.text === '[Tags] includes any of ["Red", "Blue"]', after);

  // 4. includes_all reads as its own label
  const all = await page.evaluate(([d]) => { window.__mk(d); return window.KConditionsEditor.get('#t').describe(); }, [doc('includes_all', ['red', 'green'])]);
  ok('includes_all describes itself', all === '[Tags] includes all of ["Red", "Green"]', { all });

  await b.close();
  site.close();
  finish(errs);
})();
