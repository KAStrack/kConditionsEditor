/*
 * KConditionsEditor.get() / detach(), and attach() on a textarea that already
 * has an editor.
 *
 * The bug this guards: with no way back from a textarea to its editor, a page
 * that lost the attach() return value could only remove the root by hand — and
 * the document-level keydown listener stayed behind, so a Ctrl+Z after the
 * manual removal could still write an undone document into the field. So the
 * checks here judge by effect: one root painted, the field's value untouched by
 * a keystroke aimed at a dead instance, everything visible again after detach.
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const DOC = { version: '1.0', root: { type: 'group', operator: 'and', negate: false, children: [
  { type: 'condition', field: 'name', operator: 'eq', values: [{ source: 'literal', value: 'A' }] }] } };

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="src/k-conditions-editor.css">
<link rel=stylesheet href="src/k-conditions-skins.css">
<body style="font-family:system-ui;padding:20px">
<h1>Page</h1>
<form id=f>
  <div class="row" id="row">
    <label for="ta" id="lab">Conditions</label>
    <textarea id="ta" name="conditions">${JSON.stringify(DOC)}</textarea>
  </div>
</form>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
<script>
window.OPTS = { fields: [{ name: 'name', label: 'Name', type: 'text' }], startOpen: true, collapsible: false };
window.ed1 = KConditionsEditor.attach('#ta', OPTS);
</script>`;

// Painted, not merely present: hit-test the centre point.
const VIS = `(el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}`;

(async () => {
  const site = await serve();
  scratch('attach-lookup-and-replace.html', PAGE);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const errs = watchErrors(p, []);
  const { ok, finish } = checker();

  await p.goto(site.url + scratch.url('attach-lookup-and-replace.html'));
  await p.waitForSelector('.kce-line');

  // -- lookup --------------------------------------------------------------
  let r = await p.evaluate(() => ({
    bySelector: KConditionsEditor.get('#ta') === window.ed1,
    byElement: KConditionsEditor.get(document.getElementById('ta')) === window.ed1,
    handle: document.getElementById('ta').kConditionsEditor === window.ed1,
    none: KConditionsEditor.get('#nope') === null,
    plain: KConditionsEditor.get(document.getElementById('lab')) === null
  }));
  ok('get() by selector', r.bySelector);
  ok('get() by element', r.byElement);
  ok('textarea.kConditionsEditor is the instance', r.handle);
  ok('get() of a missing selector is null', r.none);
  ok('get() of an element with no editor is null', r.plain);

  // -- re-attach replaces --------------------------------------------------
  // Give the first editor an undo step and the keyboard, so a surviving
  // listener would have something to do.
  await p.click('.kce-line input[type=text]');
  await p.keyboard.press('End');
  await p.keyboard.type('B');
  await p.waitForTimeout(700);           // let the typing burst commit
  await p.click('h1');                   // drop focus; ed1 stays "engaged"
  const before = await p.evaluate(() => document.getElementById('ta').value);
  ok('first editor wrote the edit', /"AB"/.test(before), { before });

  r = await p.evaluate(() => {
    window.oldFired = 0;
    window.ed1.on('change', () => { window.oldFired++; });
    window.ed2 = KConditionsEditor.attach('#ta', Object.assign({}, OPTS, { skin: 'equation' }));
    return {
      roots: document.querySelectorAll('.kce').length,
      skin: document.querySelector('.kce').getAttribute('data-kce-skin'),
      handle: KConditionsEditor.get('#ta') === window.ed2,
      distinct: window.ed2 !== window.ed1,
      value: document.getElementById('ta').value,
      oldRootGone: !document.contains(window.ed1.root)
    };
  });
  ok('exactly one root after re-attach', r.roots === 1, { roots: r.roots });
  ok('the root on the page is the new editor\'s', r.skin === 'equation', { skin: r.skin });
  ok('get() now returns the new instance', r.handle && r.distinct);
  ok('the old root is out of the document', r.oldRootGone);
  ok('re-attach keeps the field\'s value', r.value === before, { value: r.value });
  ok('new editor is painted', await p.evaluate(`(${VIS})(document.querySelector('.kce'))`));

  // A Ctrl+Z aimed at the page: ed2 has one history entry, so nothing should
  // change. If ed1's keydown listener survived, it would undo and write "A".
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(200);
  r = await p.evaluate(() => ({ value: document.getElementById('ta').value, oldFired: window.oldFired }));
  ok('Ctrl+Z does not reach the replaced editor', r.value === before, { value: r.value });
  ok('the replaced editor emits nothing', r.oldFired === 0, { oldFired: r.oldFired });

  // -- re-attach with a hideTarget that wraps the field ---------------------
  // The old teardown must run before the new editor resolves what to hide, or
  // the new root lands inside the row it is about to conceal.
  r = await p.evaluate(`(() => {
    window.ed3 = KConditionsEditor.attach('#ta', Object.assign({}, OPTS, { hideTarget: '#row' }));
    const vis = ${VIS};
    return {
      roots: document.querySelectorAll('.kce').length,
      editorVisible: vis(document.querySelector('.kce')),
      rowVisible: vis(document.getElementById('lab')),
      handle: KConditionsEditor.get('#ta') === window.ed3
    };
  })()`);
  ok('one root after re-attach with hideTarget', r.roots === 1, { roots: r.roots });
  ok('editor visible after re-attach with hideTarget', r.editorVisible);
  ok('row hidden after re-attach with hideTarget', !r.rowVisible);
  ok('get() returns the third instance', r.handle);

  // -- detach ---------------------------------------------------------------
  r = await p.evaluate(`(() => {
    const vis = ${VIS};
    const first = KConditionsEditor.detach('#ta');
    const again = KConditionsEditor.detach('#ta');
    let threw = false;
    try { window.ed3.destroy(); } catch (e) { threw = true; }
    return {
      first, again, threw,
      roots: document.querySelectorAll('.kce').length,
      handle: KConditionsEditor.get('#ta'),
      expando: 'kConditionsEditor' in document.getElementById('ta'),
      rowVisible: vis(document.getElementById('lab')),
      taVisible: vis(document.getElementById('ta')),
      value: document.getElementById('ta').value
    };
  })()`);
  ok('detach() returns true when it removed one', r.first === true);
  ok('detach() returns false when there is none', r.again === false);
  ok('destroy() twice is harmless', !r.threw);
  ok('no root after detach', r.roots === 0, { roots: r.roots });
  ok('get() is null after detach', r.handle === null);
  ok('the handle property is gone after detach', !r.expando);
  ok('the row is painted again after detach', r.rowVisible);
  ok('the textarea is painted again after detach', r.taVisible);
  ok('the field keeps its value after detach', r.value === before, { value: r.value });

  await b.close();
  site.close();
  finish(errs);
})();
