/*
 * Field groups, and operator labels with a {value} slot.
 *
 * Groups: a field's `group` puts it under an <optgroup> of that name in the
 * field list and in the compare-with list, groups in the order they first
 * appear, ungrouped fields first. A new condition takes the first field the
 * list shows, which with groups is not always the first one configured.
 *
 * Slots: "is within the last {value} days" reads "is within the last [7] days"
 * on the row — the words before the operand in the operator's place, the
 * operand, then the words after it — in every skin and both connector
 * placements, and in a translation that wants no spaces round the operand.
 * The operator list shows the whole label with an ellipsis; the summary puts
 * the number in place.
 *
 *   node tests/browser/run.js field-groups-and-slots
 */
const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'a1', label: 'App one', group: 'Application', type: 'number', comparableWith: '*' },
  { name: 'loose1', label: 'Loose one', type: 'number' },
  { name: 's1', label: 'Staff one', group: 'Staff', type: 'number' },
  { name: 'a2', label: 'App two', group: 'Application', type: 'date' },
  { name: 'loose2', label: 'Loose two', type: 'number' }
];
const lit = (v) => ({ source: 'literal', value: v });
const slotted = (n, op) => ({ type: 'condition', field: 'a2', operator: op || 'date_within_last_days', values: [lit(n)] });

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>groups</title>
<link rel="stylesheet" href="src/k-conditions-editor.css"><link rel="stylesheet" href="src/k-conditions-skins.css">
<script src="src/k-conditions-evaluator.js"></script><script src="src/k-conditions-editor.js"></script></head>
<body style="margin:20px"><div id="box" style="width:900px"></div>
<script>
var FIELDS = ${JSON.stringify(FIELDS)};
window.make = function (doc, opts) {
  if (window.ed) window.ed.destroy();
  var box = document.getElementById('box');
  box.innerHTML = '<textarea id="t"></textarea>';
  document.getElementById('t').value = JSON.stringify(doc);
  window.ed = KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false, startOpen: true }, opts || {}));
  return window.ed;
};
// The list a select shows: [group or '', label] per option.
window.listOf = function (select) {
  return Array.prototype.map.call(select.options, function (o) {
    return [o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '', o.textContent];
  });
};
</script></body></html>`;

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  const p = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  watchErrors(p, errs);
  scratch('field-groups.html', PAGE);
  await p.goto(site.url + scratch.url('field-groups.html'));

  /* --- groups ------------------------------------------------------------ */
  const groups = await p.evaluate(() => {
    make({ version: '1.0', root: { type: 'group', operator: 'and', children: [
      { type: 'condition', field: 'a1', operator: 'gt', values: [{ source: 'field', field: 's1' }] }
    ] } });
    var field = document.querySelector('select.kce-field');
    var compare = document.querySelector('select.kce-field-value');
    var out = {
      field: listOf(field),
      fieldGroups: Array.prototype.map.call(field.querySelectorAll('optgroup'), function (g) { return g.label; }),
      compare: listOf(compare),
      chosen: field.value
    };
    ed.clear();
    document.querySelector('.kce-adds-starter .kce-add').click();
    out.added = ed.getDocument().root.children[0].field;
    return out;
  });
  ok('ungrouped fields first, then each group where it first appears', JSON.stringify(groups.field) === JSON.stringify([
    ['', 'Loose one'], ['', 'Loose two'],
    ['Application', 'App one'], ['Application', 'App two'],
    ['Staff', 'Staff one']
  ]), groups.field);
  ok('one optgroup per group', JSON.stringify(groups.fieldGroups) === JSON.stringify(['Application', 'Staff']), groups.fieldGroups);
  ok('the chosen field is still chosen inside its group', groups.chosen === 'a1', groups.chosen);
  ok('the compare-with list is grouped the same way', JSON.stringify(groups.compare) === JSON.stringify([
    ['', 'Loose one'], ['', 'Loose two'], ['Application', 'App two'], ['Staff', 'Staff one']
  ]), groups.compare);
  ok('a new condition takes the first field the list shows', groups.added === 'loose1', groups.added);

  /* --- slots ------------------------------------------------------------- */
  const rule = { version: '1.0', root: { type: 'group', operator: 'and', children: [
    slotted(7), { type: 'group', operator: 'or', children: [slotted(30, 'date_more_than_days_ago'), slotted(2, 'date_within_next_days')] }
  ] } };
  for (const skin of ['prose', 'equation', 'blackboard', 'ledger', 'boxed']) {
    for (const placement of ['below', 'inline']) {
      const r = await p.evaluate(([d, s, pl]) => {
        make(d, { skin: s, connectorPlacement: pl, controls: 'always' });
        return Array.prototype.map.call(document.querySelectorAll('.kce-condition'), function (row) {
          var boxed = document.querySelector('.kce').getAttribute('data-kce-skin') === 'boxed';
          var head = row.querySelector('.kce-sel-operator .kce-sel-label');
          var input = row.querySelector('.kce-values input');
          var tail = row.querySelector('.kce-op-tail');
          var box = function (e) { return e.getBoundingClientRect(); };
          return {
            head: head.textContent, tail: tail && tail.textContent,
            inOrder: !!tail && box(head).right <= box(input).left + 1 && box(input).right <= box(tail).left + 1,
            // On the same line: the tail's middle inside the value's band.
            sameLine: !!tail && Math.abs((box(tail).top + box(tail).bottom) / 2 - (box(input).top + box(input).bottom) / 2) < box(input).height / 2,
            // What is painted at the tail is the tail.
            painted: !!tail && document.elementFromPoint(box(tail).left + box(tail).width / 2, box(tail).top + box(tail).height / 2) === tail,
            // Boxed puts the operator in a box; the tail is the box's text.
            colour: tail && getComputedStyle(tail).color === getComputedStyle(head).color &&
              (!boxed || getComputedStyle(tail).fontSize === getComputedStyle(head).fontSize)
          };
        });
      }, [rule, skin, placement]);
      const tag = skin + ' / ' + placement;
      ok(tag + ': the words before the operand stand in the operator\'s place',
        JSON.stringify(r.map((x) => x.head)) === JSON.stringify(['is within the last', 'is more than', 'is within the next']), r);
      ok(tag + ': the words after it follow the value',
        JSON.stringify(r.map((x) => x.tail)) === JSON.stringify(['days', 'days ago', 'days']), r);
      ok(tag + ': head, value, tail, left to right on one line', r.every((x) => x.inOrder && x.sameLine && x.painted), r);
      ok(tag + ': the tail is drawn as the operator is', r.every((x) => x.colour), r);
    }
  }

  const listed = await p.evaluate((d) => {
    make(d, { skin: 'prose' });
    var sel = document.querySelector('select.kce-operator');
    var out = {
      option: sel.options[sel.selectedIndex].textContent,
      today: Array.prototype.filter.call(sel.options, function (o) { return o.value === 'date_is_today'; })[0].textContent
    };
    ed.setOpen(false);
    out.summary = document.querySelector('.kce-summary-text').textContent;
    return out;
  }, { version: '1.0', root: { type: 'group', operator: 'and', children: [slotted(7)] } });
  ok('the operator list shows the whole label, an ellipsis for the operand', listed.option === 'is within the last … days', listed);
  ok('an operator with no operand is unchanged', listed.today === 'is today', listed);
  ok('the summary puts the number in its place', listed.summary === '[App two] is within the last 7 days', listed);

  // A translation with no spaces round the operand, and one with the operand first.
  const zh = await p.evaluate((d) => {
    make(d, { skin: 'prose', labels: { operators: { date_within_last_days: '在过去{value}天内', date_more_than_days_ago: '{value} days back' } } });
    var rows = document.querySelectorAll('.kce-condition');
    var first = rows[0], second = rows[1];
    var out = {
      head: first.querySelector('.kce-sel-operator .kce-sel-label').textContent,
      tail: first.querySelector('.kce-op-tail').textContent,
      leadHead: second.querySelector('.kce-sel-operator .kce-sel-label').textContent,
      leadTail: second.querySelector('.kce-op-tail').textContent
    };
    ed.setOpen(false);
    out.summary = document.querySelector('.kce-summary-text').textContent;
    return out;
  }, { version: '1.0', root: { type: 'group', operator: 'and', children: [slotted(7), slotted(3, 'date_more_than_days_ago')] } });
  ok('a translated slot splits where it is written', zh.head === '在过去' && zh.tail === '天内', zh);
  ok('a slot at the start leaves the operator its place, empty', zh.leadHead === '' && zh.leadTail === 'days back', zh);
  ok('and the summary keeps the spacing as written', zh.summary === '([App two] 在过去7天内 AND [App two] 3 days back)', zh);

  await browser.close();
  site.close();
  finish(errs);
})();
