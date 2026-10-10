/*
 * The editor in a narrow host: a dialog, not a page.
 *
 * Reported from KAStrack's 545px properties dialog on 0.0.25. Three things went
 * wrong there, and none of them show up at the demo's width:
 *
 *   - a row a few pixels too wide put its move arrows and × on a second flex
 *     line, so every row reserved a blank band and the controls appeared below
 *     the thing being pointed at;
 *   - the host's own form stylesheet reached the value input and made it a
 *     384px box, which is what made the row too wide in the first place — and
 *     in prose pushed the AND / OR onto a line of their own;
 *   - the controls were small (a 12×10 grip) and revealed at an opacity that
 *     left them at about 2:1 contrast.
 *
 * Everything here is judged by what is painted: positions after a real hover,
 * hit-testing with elementFromPoint, and contrast composited from the computed
 * colours and the opacity of every ancestor.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, shot, scratch, checker, watchErrors } = require('./harness.js');

const FIELDS = [
  { name: 'assigned', label: 'Assigned To', type: 'text' },
  { name: 'state', label: 'State', type: 'text' }
];

const cond = (field, value) => ({ type: 'condition', field: field, operator: 'eq',
  values: [{ source: 'literal', value: value || '' }] });
const group = (op, kids) => ({ type: 'group', operator: op, children: kids });
const doc = (root) => ({ version: '1.0', root: root });

// The shape from the report: one condition, then an AND'd group of two OR'd.
const REPORT = doc(group('and', [cond('assigned'), group('or', [cond('assigned'), cond('assigned')])]));

// Root font-size 13px makes --kce-font-size (0.9375rem) resolve to 12.19px, as
// it did in the dialog. The host sheet is class-scoped, the way a dialog's form
// styles usually are, so it beats bare element rules but not the editor's own.
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>
  html { font-size: 13px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { margin: 20px; background: #fff; }
  .host input[type="text"], .host input[type="number"], .host input:not([type]), .host select {
    width: 24rem; height: 42px; padding: 8px 12px; margin: 0 0 6px;
    border: 1px solid #c9ced6; border-radius: 6px; line-height: 24px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08); background: #fff;
  }
  .host button { margin: 0 4px 4px 0; min-height: 32px; }
</style></head>
<body><div id="box"></div>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
</body></html>`;

/* In-page helpers: attach, and measure what is painted. */
function install(FIELDS) {
  window.__mk = function (document_, opts, box) {
    const host = document.getElementById('box');
    if (window.__ed) window.__ed.destroy();
    host.className = box.host ? 'host' : '';
    host.style.width = box.width + 'px';
    host.style.display = box.hidden ? 'none' : '';
    // A dark theme is for a dark page; on white it would fail for the page's
    // sake, not the editor's.
    host.style.background = (opts && opts.theme === 'dark') ? '#171a1f' : '';
    host.innerHTML = '<textarea id="t"></textarea>';
    host.querySelector('#t').value = JSON.stringify(document_);
    const ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
    ed.setOpen(true);
    window.__ed = ed;
    return true;
  };

  function parse(c) {
    let m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/.exec(c);
    if (m) return { r: m[1] * 255, g: m[2] * 255, b: m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
    m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  /** Contrast of an element's glyph against what is painted behind it. */
  window.__contrast = function (el) {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    let opacity = 1;
    chain.forEach((n) => { opacity *= parseFloat(getComputedStyle(n).opacity); });
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    chain.slice().reverse().forEach((n) => {
      const cs = getComputedStyle(n);
      const grad = /gradient/.test(cs.backgroundImage) && parse(cs.backgroundImage);
      if (grad) bg = over(grad, bg);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    });
    const fg = parse(getComputedStyle(el).color);
    fg.a *= opacity;
    const a = lum(over(fg, bg)), b = lum(bg);
    return { ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2), opacity: +opacity.toFixed(2) };
  };

  /** A row's own control — in the row, or (inline prose) in the strip after its AND / OR. */
  window.__ctl = function (row, sel) {
    return row.querySelector(sel) || row.parentNode.querySelector(':scope > .kce-adds ' + sel);
  };

  /** Does the point belong to el (or something inside it)? */
  window.__hits = function (el, x, y) {
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit));
  };

  /** All four points 11px out from the centre hit el: a 22px+ target. */
  window.__target = function (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pts = [[cx, cy - 11], [cx, cy + 11], [cx - 11, cy], [cx + 11, cy]];
    return { ok: pts.every((p) => window.__hits(el, p[0], p[1])), size: [Math.round(r.width), Math.round(r.height)] };
  };
}

(async () => {
  const site = await serve();
  scratch('narrow-host.html', PAGE);
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();

  async function open(ctxOpts) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1000, height: 900 } }, ctxOpts || {}));
    const p = await ctx.newPage();
    watchErrors(p, errs);
    await p.goto(site.url + scratch.url('narrow-host.html'));
    await p.evaluate(install, FIELDS);
    return p;
  }

  const p = await open();
  const mk = (d, opts, box) => p.evaluate(([d, o, bx]) => window.__mk(d, o, bx), [d, opts, box]);

  /** Point the real mouse at the first condition's field name. */
  async function hoverRow(index) {
    await p.mouse.move(2, 2);
    await p.waitForFunction(() => !document.querySelector('.kce-ghost'), null, { timeout: 2000 });
    const pt = await p.evaluate((i) => {
      const s = document.querySelectorAll('.kce-condition .kce-sel-field')[i];
      const r = s.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, index || 0);
    await p.mouse.move(pt.x, pt.y);
    await p.waitForTimeout(220);
  }

  const inputWidth = {};

  // prose twice: with the AND / OR below each row (the default) and inline.
  for (const variant of ['prose', 'prose-inline', 'equation', 'boxed']) {
    const skin = variant === 'prose-inline' ? 'prose' : variant;
    const inline = variant === 'prose-inline';
    for (const width of [640, 564, 545, 420]) {
      for (const host of [false, true]) {
        const tag = variant + '@' + width + (host ? '+host' : '');
        await mk(REPORT, inline ? { skin, connectorPlacement: 'inline' } : { skin }, { width, host });
        await hoverRow(0);

        // 1. Every row's controls are on the row's own line, measured after
        //    the hover (which grows the add buttons and can shift things).
        //    Inline, they ride in the strip after the AND / OR — which, like
        //    any add strip, hangs just below the line when the line is full.
        const rows = await p.evaluate(() => Array.from(document.querySelectorAll('.kce-condition')).map((c) => {
          const f = c.querySelector('.kce-sel-field').getBoundingClientRect();
          const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
          const strip = c.parentNode.querySelector(':scope > .kce-adds');
          const own = c.querySelectorAll(':scope > .kce-remove, :scope > .kce-move .kce-move-btn');
          const ctl = Array.from(own.length ? own : strip.querySelectorAll(':scope > .kce-remove, :scope > .kce-move .kce-move-btn'));
          return { band: [f.top - 2, f.bottom + 2], mids: ctl.map(mid), h: Math.round(c.getBoundingClientRect().height),
            hanging: !own.length && strip.classList.contains('kce-adds-below') };
        }));
        rows.forEach((r, i) => ok(tag + ' row ' + i + ' controls share the field line',
          r.mids.length > 0 && (r.hanging || r.mids.every((y) => y >= r.band[0] && y <= r.band[1])), r));

        // 2. Nothing is pushed out of the editor: every × is inside it and is
        //    what the pointer finds there. (Inline, a hidden strip does not
        //    take the pointer, so only the hovered row's × can be found.)
        const fit = await p.evaluate((inline) => {
          const kce = document.querySelector('.kce').getBoundingClientRect();
          const tree = document.querySelector('.kce-tree');
          const rms = inline
            ? [window.__ctl(document.querySelector('.kce-condition'), '.kce-remove')]
            : Array.from(document.querySelectorAll('.kce-condition > .kce-remove'));
          return {
            inside: rms.every((rm) => rm.getBoundingClientRect().right <= kce.right + 0.5),
            painted: rms.every((rm) => { const r = rm.getBoundingClientRect(); return window.__hits(rm, r.left + r.width / 2, r.top + r.height / 2); }),
            overflow: tree.scrollWidth - tree.clientWidth
          };
        }, inline);
        ok(tag + ' every × is inside the editor', fit.inside, fit);
        ok(tag + ' every × is hit-testable', fit.painted, fit);
        ok(tag + ' no horizontal overflow', fit.overflow <= 1, fit);

        // 3. The host's form CSS does not reach the value input.
        const iw = await p.evaluate(() => {
          const r = document.querySelector('.kce-condition .kce-input').getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        });
        const key = skin + '@' + width;
        if (!host) inputWidth[key] = iw;
        else ok(tag + ' host CSS leaves the value input alone',
          Math.abs(iw[0] - inputWidth[key][0]) <= 2 && Math.abs(iw[1] - inputWidth[key][1]) <= 2,
          { clean: inputWidth[key], host: iw });

        // 4. Inline, the AND / OR stays on the line of the row it follows.
        //    Below (the default), it is under that row, starting where the
        //    field name starts — however narrow the host.
        if (skin === 'prose' && width >= 545) {
          const conns = await p.evaluate((inline) => Array.from(document.querySelectorAll('.kce-line')).map((l) => {
            const c = l.querySelector(':scope > .kce-condition'), k = l.querySelector(':scope > .kce-connector');
            if (!c || !k) return null;
            const cr = c.getBoundingClientRect(), kr = k.getBoundingClientRect(), mid = kr.top + kr.height / 2;
            if (inline) return { ok: mid >= cr.top && mid <= cr.bottom, cond: [cr.top, cr.bottom], conn: mid };
            const text = (e) => e.getBoundingClientRect().left + parseFloat(getComputedStyle(e).paddingLeft);
            const field = text(c.querySelector('.kce-sel-field .kce-sel-label')), word = text(k.querySelector('.kce-connector-btn'));
            return { ok: kr.top >= cr.bottom - 2 && Math.abs(field - word) <= 1, cond: [cr.top, cr.bottom], conn: [kr.top, word], field };
          }).filter(Boolean), inline);
          ok(tag + (inline ? ' connectors stay on their row' : ' connectors sit under their row, under the field'),
            conns.length === 2 && conns.every((c) => c.ok), conns);
        }

        if (width === 545) {
          // 5. Targets: 11px out from the centre in every direction is still
          //    the control, for each control a row reveals.
          const targets = await p.evaluate(() => {
            const c = document.querySelector('.kce-condition');
            const out = {
              grip: c.querySelector('.kce-grip'),
              down: window.__ctl(c, '.kce-move-down'),
              remove: window.__ctl(c, '.kce-remove'),
              add: Array.from(document.querySelectorAll('.kce-add')).filter((a) => a.getBoundingClientRect().width > 2)[0],
              connector: Array.from(document.querySelectorAll('.kce-connector-btn')).filter((a) => a.getBoundingClientRect().width > 2)[0]
            };
            const res = {};
            Object.keys(out).forEach((k) => { res[k] = out[k] ? window.__target(out[k]) : null; });
            return res;
          });
          ['grip', 'down', 'remove', 'add'].concat(skin === 'boxed' ? [] : ['connector']).forEach((k) =>
            ok(tag + ' ' + k + ' is a 24px target', targets[k] && targets[k].ok, targets[k]));

          // 6. The end-of-list arrow is gone, not faint — and its space stays.
          const ends = await p.evaluate(() => {
            const up = window.__ctl(document.querySelector('.kce-condition'), '.kce-move-up');
            const r = up.getBoundingClientRect();
            return { vis: getComputedStyle(up).visibility, width: Math.round(r.width), hit: window.__hits(up, r.left + r.width / 2, r.top + r.height / 2) };
          });
          ok(tag + ' disabled arrow is hidden but keeps its space', ends.vis === 'hidden' && ends.width >= 20 && !ends.hit, ends);

          if (!host) await p.screenshot({ path: shot('narrow-host-' + variant + '.png'), clip: { x: 0, y: 0, width: 620, height: 300 } });
        }
      }
    }
  }

  // 7. Revealed controls are readable: at least 3:1 against what is behind
  //    them, in light, dark and on the blackboard.
  for (const [skin, theme] of [['prose', null], ['equation', null], ['boxed', null], ['prose', 'dark'], ['equation', 'dark'], ['blackboard', null]]) {
    const tag = skin + (theme ? '/' + theme : '');
    await mk(REPORT, { skin, theme }, { width: 545, host: false });
    await hoverRow(0);
    const cs = await p.evaluate(() => {
      const c = document.querySelector('.kce-condition');
      return {
        grip: window.__contrast(c.querySelector('.kce-grip')),
        down: window.__contrast(c.querySelector('.kce-move-down')),
        remove: window.__contrast(c.querySelector(':scope > .kce-remove'))
      };
    });
    Object.keys(cs).forEach((k) => ok(tag + ' revealed ' + k + ' is at least 3:1', cs[k].ratio >= 3, cs[k]));
  }

  // 8. A rule attached inside a hidden dialog lines its operators up when the
  //    dialog is shown. It used to measure everything as zero and never retry.
  await mk(doc(group('and', [cond('assigned', 'somebody'), cond('state'), cond('assigned')])), { skin: 'prose' }, { width: 545, host: false, hidden: true });
  await p.evaluate(() => { document.getElementById('box').style.display = ''; });
  await p.waitForTimeout(150);
  const cols = await p.evaluate(() => Array.from(document.querySelectorAll('.kce-connector')).map((k) => Math.round(k.getBoundingClientRect().left)));
  ok('hidden then shown: connectors share a column', cols.length === 2 && Math.abs(cols[0] - cols[1]) <= 1, cols);

  // 9. No line in prose wraps at rest. Alignment must not push a connector,
  //    bracket or the group's tools onto a second line, and a group's tools
  //    that do not fit after its bracket go to its closing line rather than
  //    reserving a blank band under the bracket. With the AND / OR below its
  //    row (the default) a line is two rows by design — the row, then
  //    "AND (" and the group's tools — and neither of those may wrap.
  const LONG = doc(group('and', [cond('assigned', 'x'.repeat(24)), cond('state'), group('or', [cond('state'), cond('state')])]));
  for (const [name, d, host] of [['long row', LONG, false], ['report', REPORT, false], ['report+host', REPORT, true]]) {
    await mk(d, { skin: 'prose' }, { width: 545, host });
    await p.mouse.move(2, 2);
    await p.waitForTimeout(100);
    const wrapped = await p.evaluate(() => Array.from(document.querySelectorAll('.kce-line')).map((l, i) => {
      // In-flow content only: the add buttons and a group's tools may float
      // (positioned out of the flow, below or after the line) by design.
      const flow = Array.from(l.children).filter((k) => getComputedStyle(k).position !== 'absolute');
      const below = getComputedStyle(l).flexWrap === 'wrap';
      const head = below ? flow.filter((k) => k.matches('.kce-condition, .kce-paren-close')) : flow;
      const tail = below ? flow.filter((k) => !head.includes(k)) : [];
      const span = (els) => {
        const rs = els.map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        if (!rs.length) return null;
        const top = Math.min.apply(null, rs.map((r) => r.top)), bottom = Math.max.apply(null, rs.map((r) => r.bottom));
        const tallest = Math.max.apply(null, rs.map((r) => r.height));
        return bottom - top > tallest + 2 ? { line: i, span: Math.round(bottom - top), tallest: Math.round(tallest) } : null;
      };
      return span(head) || span(tail);
    }).filter(Boolean));
    ok(name + ': no prose line wraps', wrapped.length === 0, wrapped);

    // Wherever the group's tools ended up, pointing at that line shows them.
    const where = await p.evaluate(() => {
      const t = document.querySelector('.kce-tools-inline');
      const line = t.closest('.kce-line');
      const r = (line.querySelector('.kce-paren') || line.firstElementChild).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, onClose: !!line.querySelector('.kce-paren-close') };
    });
    await p.mouse.move(where.x, where.y);
    await p.waitForTimeout(220);
    const shown = await p.evaluate(() => {
      const t = document.querySelector('.kce-tools-inline');
      return { opacity: getComputedStyle(t).opacity, remove: window.__contrast(t.querySelector('.kce-remove')).ratio };
    });
    ok(name + ': group tools revealed on their line' + (where.onClose ? ' (closing)' : ''),
      shown.opacity === '1' && shown.remove >= 3, shown);
    if (name === 'report+host') await p.screenshot({ path: shot('narrow-host-report.png'), clip: { x: 0, y: 0, width: 600, height: 260 } });
  }

  // 10. On a touch screen there is no hover to reveal anything, so the row's
  //     controls are there at rest, readable, and the add buttons are open.
  const t = await open({ viewport: { width: 700, height: 700 }, hasTouch: true, isMobile: true });
  const hoverNone = await t.evaluate(() => matchMedia('(hover: none)').matches);
  ok('touch context reports (hover: none)', hoverNone, hoverNone);
  for (const skin of ['prose', 'equation', 'boxed']) {
    await t.evaluate(([d, s]) => window.__mk(d, { skin: s }, { width: 545, host: false }), [REPORT, skin]);
    const rest = await t.evaluate(() => {
      const c = document.querySelector('.kce-condition');
      const one = (el) => window.__contrast(el);
      return {
        grip: one(c.querySelector('.kce-grip')),
        down: one(window.__ctl(c, '.kce-move-down')),
        remove: one(window.__ctl(c, '.kce-remove')),
        adds: Array.from(document.querySelectorAll('.kce-add')).some((a) => a.getBoundingClientRect().width > 2)
      };
    });
    ['grip', 'down', 'remove'].forEach((k) => ok('touch ' + skin + ' ' + k + ' shown at rest',
      rest[k].opacity === 1 && rest[k].ratio >= 3, rest[k]));
    ok('touch ' + skin + ' add buttons open at rest', rest.adds, rest);
  }

  finish(errs);
  await b.close();
  site.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
