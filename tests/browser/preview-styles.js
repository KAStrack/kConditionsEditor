/*
 * previewStyle: seven ways to draw the same preview.
 *
 * Every style paints one set — Editor#previewTargets() — so the checks here
 * ask the same questions of each, judged by what is painted:
 *
 *   - are the operators *inside* the range marked? (The AND(…) / OR(…) preview
 *     left them out until 0.0.27, because connectors are tagged by group and
 *     subtreeTargets() could not see them.)
 *   - is everything outside the range left alone?
 *   - is the group's tool strip left out?
 *   - does the hovered button stay exactly where it was? (A button that moves
 *     loses the pointer, clears the preview, moves back, and flickers.)
 *   - is the ghost written as text in every style but highlight?
 *   - does leaving clear all of it?
 */
'use strict';

const { chromium } = require('playwright');
const { serve, shot, scratch, checker, watchErrors } = require('./harness.js');

const STYLES = ['highlight', 'bar', 'region', 'fade', 'color', 'marker', 'underline'];

const FIELDS = [
  { name: 'a', label: 'Assigned To', type: 'text' },
  { name: 's', label: 'State', type: 'text' },
  { name: 'p', label: 'Priority', type: 'text' }
];
const cond = (f, v) => ({ type: 'condition', field: f, operator: 'eq', values: [{ source: 'literal', value: v }] });

// ben AND FL AND (high OR urgent) — ids r.0, r.1, r.2 (r.2.0, r.2.1)
const RULE = { version: '1.0', root: { type: 'group', operator: 'and', children: [
  cond('a', 'ben'), cond('s', 'FL'),
  { type: 'group', operator: 'or', children: [cond('p', 'high'), cond('p', 'urgent')] }
] } };

/*
 * in      rows (by value) and connector groups whose operators must be marked
 * out     rows and connector groups that must not be
 * hue     the mark colour token
 * ghost   the operator the ghost should be written with (null: no ghost)
 */
const CASES = [
  { name: 'OR(…) on the rule', fk: 'r:wrap-or', hue: 'and', ghost: 'OR',
    inRows: ['ben', 'FL', 'high', 'urgent'], inConns: ['r', 'r.2'], outRows: [], outConns: [] },
  { name: 'AND(…) on the nested group', fk: 'r.2:wrap-and', hue: 'or', ghost: 'AND',
    inRows: ['high', 'urgent'], inConns: ['r.2'], outRows: ['ben', 'FL'], outConns: ['r'] },
  { name: '+AND on a row of an OR group', fk: 'r.2:add-and-1', hue: 'and', ghost: 'AND',
    inRows: ['urgent'], inConns: [], outRows: ['ben', 'FL', 'high'], outConns: ['r'] },
  { name: '+AND on the rule', fk: 'r:add-and-0', hue: 'and', ghost: 'AND',
    inRows: ['ben', 'FL', 'high', 'urgent'], inConns: ['r', 'r.2'], outRows: [], outConns: [] },
  { name: '× on the nested group', fk: 'r.2:rm', hue: 'danger', ghost: null,
    inRows: ['high', 'urgent'], inConns: ['r.2'], outRows: ['ben', 'FL'], outConns: ['r'] }
];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-conditions-editor.css">
<link rel="stylesheet" href="src/k-conditions-skins.css">
<style>body { margin: 20px; font-family: system-ui, sans-serif; background: #fff; } #box { width: 760px; }</style>
</head><body><div id="box"></div>
<script src="src/k-conditions-evaluator.js"></script>
<script src="src/k-conditions-editor.js"></script>
</body></html>`;

function install(FIELDS) {
  window.__mk = function (doc, opts) {
    if (window.__ed) window.__ed.destroy();
    const box = document.getElementById('box');
    box.style.background = opts && opts.theme === 'dark' ? '#171a1f' : '';
    box.innerHTML = '<textarea id="t"></textarea>';
    box.querySelector('#t').value = JSON.stringify(doc);
    window.__ed = window.KConditionsEditor.attach('#t', Object.assign({ fields: FIELDS, collapsible: false }, opts || {}));
    window.__ed.setOpen(true);
    return document.querySelector('.kce').getAttribute('data-kce-preview');
  };

  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  window.__rgb = rgb;

  /** The colour a token resolves to inside this editor. */
  window.__token = function (name) {
    const probe = document.createElement('span');
    probe.style.color = 'var(--kce-' + name + ')';
    document.querySelector('.kce-tree').appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  };

  window.__opacity = function (el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  };

  window.__row = function (value) {
    return Array.from(document.querySelectorAll('.kce-condition')).find((c) => {
      const i = c.querySelector('.kce-input');
      return i && i.value === value;
    });
  };

  window.__conns = function (group) {
    return Array.from(document.querySelectorAll('.kce-connector[data-conn-group="' + group + '"] .kce-connector-btn'));
  };

  /** Bring a control into view the way a pointer would: hover its row first. */
  window.__revealPoint = function (fk) {
    const b = document.querySelector('[data-fk="' + fk + '"]');
    if (!b) return null;
    let host = null;
    for (let n = b; n && !host; n = n.parentElement) {
      if (n.classList.contains('kce-line')) host = n.querySelector('.kce-condition') || n.firstElementChild;
      else if (n.classList.contains('kce-connector')) host = n.previousElementSibling;
      else if (n.classList.contains('kce-group-head')) host = n.parentElement.querySelector('.kce-condition');
    }
    host = host || b;
    if (host.classList.contains('kce-group')) host = host.querySelector('.kce-condition') || host;
    const r = host.getBoundingClientRect();
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
  };

  window.__rect = function (fk) {
    const r = document.querySelector('[data-fk="' + fk + '"]').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  /** Where an element's text starts: a row's field name, a button's label. */
  const textLeft = (el) => {
    if (el.classList.contains('kce-condition')) return el.querySelector('.kce-sel-field .kce-sel-label').getBoundingClientRect().left;
    return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
  };

  /** What the styles other than the shape ones change, for "left alone". */
  window.__sig = function (el) {
    const label = el.classList.contains('kce-condition') ? el.querySelector('.kce-sel-field .kce-sel-label') : el;
    const ls = getComputedStyle(label);
    const grip = el.querySelector(':scope > .kce-grip');
    return [ls.color, ls.textDecorationLine, getComputedStyle(el, '::before').content,
      grip ? getComputedStyle(grip, '::before').content : ''].join('|');
  };

  /** Every row and visible operator, keyed, with its look right now. */
  window.__snapshot = function () {
    const out = {};
    Array.from(document.querySelectorAll('.kce-condition')).forEach((c) => {
      const i = c.querySelector('.kce-input');
      if (i) out['row:' + i.value] = window.__sig(c);
    });
    Array.from(document.querySelectorAll('.kce-connector[data-conn-group]')).forEach((k) => {
      const btn = k.querySelector('.kce-connector-btn');
      out['conn:' + k.getAttribute('data-conn-group') + ':' + k.getAttribute('data-conn-index')] = window.__sig(btn);
    });
    return out;
  };

  /** The visible operator words of a group. Boxed hides them altogether. */
  window.__conns = function (group) {
    return Array.from(document.querySelectorAll('.kce-connector[data-conn-group="' + group + '"]'))
      .map((k) => k.querySelector('.kce-connector-btn'))
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  };

  const connKey = (btn) => {
    const k = btn.parentElement;
    return 'conn:' + k.getAttribute('data-conn-group') + ':' + k.getAttribute('data-conn-index');
  };

  /** Is el painted as part of the preview, in this style? */
  window.__painted = function (el, style, hue) {
    const label = el.classList.contains('kce-condition') ? el.querySelector('.kce-sel-field .kce-sel-label') : el;
    const ls = getComputedStyle(label);
    const mark = document.querySelector('.kce-preview-mark');
    const r = el.getBoundingClientRect();
    switch (style) {
      case 'highlight': {
        // The marked element may be the row, or (tree layout) the group box
        // the row sits in: painted if anything from here up is.
        for (let n = el; n && !n.classList.contains('kce-tree'); n = n.parentElement) {
          const cs = getComputedStyle(n);
          const bg = rgb(cs.backgroundColor);
          if (bg && bg.a > 0.5 && cs.boxShadow !== 'none') return true;
        }
        return false;
      }
      case 'bar':
      case 'region': {
        if (!mark) return false;
        const m = mark.getBoundingClientRect();
        const midY = r.top + r.height / 2;
        const inside = midY >= m.top && midY <= m.bottom;
        if (style === 'region') return inside && textLeft(el) >= m.left - 1 && r.right <= m.right + 1;
        return inside && m.right <= textLeft(el);
      }
      case 'fade':
        return window.__opacity(el) > 0.95;
      case 'color':
        return ls.color === window.__token(hue);
      case 'marker': {
        if (!el.classList.contains('kce-condition')) return ls.color === window.__token(hue);
        const grip = el.querySelector(':scope > .kce-grip');
        const dot = grip ? getComputedStyle(grip, '::before') : getComputedStyle(el, '::before');
        return /●/.test(dot.content) && dot.color === window.__token(hue) && (!grip || window.__opacity(grip) > 0.95);
      }
      case 'underline':
        return /underline/.test(ls.textDecorationLine) && ls.textDecorationColor === window.__token(hue);
    }
    return false;
  };

  /** For the outside: is el plainly not part of it? */
  window.__untouched = function (el, style, hue) {
    if (style === 'fade') return window.__opacity(el) < 0.4;
    if (style === 'color' || style === 'underline' || style === 'marker') {
      // Compared with its own look before the hover: an outside AND that is
      // blue anyway is not evidence of anything.
      const key = el.classList.contains('kce-condition') ? 'row:' + el.querySelector('.kce-input').value : connKey(el);
      return window.__base[key] === window.__sig(el);
    }
    if (style === 'bar') {
      const m = document.querySelector('.kce-preview-mark');
      if (!m) return true;
      const r = el.getBoundingClientRect(), b = m.getBoundingClientRect();
      const midY = r.top + r.height / 2;
      return midY < b.top || midY > b.bottom;
    }
    if (style === 'region') {
      const m = document.querySelector('.kce-preview-mark');
      if (!m) return true;
      const r = el.getBoundingClientRect(), b = m.getBoundingClientRect();
      const midY = r.top + r.height / 2;
      return midY < b.top || midY > b.bottom;
    }
    return !window.__painted(el, style, hue);
  };
}

(async () => {
  const site = await serve();
  scratch('preview-styles.html', PAGE);
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  watchErrors(p, errs);
  await p.goto(site.url + scratch.url('preview-styles.html'));
  await p.evaluate(install, FIELDS);

  async function park() {
    await p.mouse.move(2, 2);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.waitForFunction(() => !document.querySelector('.kce-ghost, .kce-preview-mark'), null, { timeout: 2000 });
  }

  /** Reveal, measure, point at the button; return its rect before and after. */
  async function point(fk) {
    await park();
    await p.evaluate(() => { window.__base = window.__snapshot(); });
    const reveal = await p.evaluate((k) => window.__revealPoint(k), fk);
    await p.mouse.move(reveal.x, reveal.y);
    await p.waitForTimeout(200);
    const before = await p.evaluate((k) => window.__rect(k), fk);
    await p.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
    await p.waitForTimeout(250);
    const after = await p.evaluate((k) => window.__rect(k), fk);
    return { before, after };
  }

  for (const skin of ['prose', 'equation', 'boxed']) {
    for (const style of STYLES) {
      for (const c of CASES) {
        const tag = skin + '/' + style + ' ' + c.name + ':';
        await p.evaluate(([d, o]) => window.__mk(d, o), [RULE, { skin, previewStyle: style }]);
        const { before, after } = await point(c.fk);

        // The hovered button stays put — or the preview flickers.
        ok(tag + ' the button does not move', Math.abs(before.x - after.x) < 0.5 && Math.abs(before.y - after.y) < 0.5, { before, after });

        const res = await p.evaluate(([c, style]) => {
          const P = (el) => window.__painted(el, style, c.hue);
          const U = (el) => window.__untouched(el, style, c.hue);
          const ghost = document.querySelector('.kce-ghost');
          const gs = ghost && getComputedStyle(ghost);
          return {
            previewing: !!document.querySelector('.kce-will-group, .kce-will-remove'),
            inRows: c.inRows.map((v) => [v, P(window.__row(v))]),
            inConns: c.inConns.map((g) => [g, window.__conns(g).map(P)]),
            outRows: c.outRows.map((v) => [v, U(window.__row(v))]),
            outConns: c.outConns.map((g) => [g, window.__conns(g).map(U)]),
            toolsMarked: document.querySelectorAll('.kce-group-tools:is(.kce-will-group, .kce-will-remove)').length,
            ghost: ghost ? {
              border: gs.borderTopStyle,
              op: (ghost.querySelector('.kce-ghost-op') || {}).textContent || null
            } : null
          };
        }, [c, style]);

        ok(tag + ' a preview is showing', res.previewing, res);
        ok(tag + ' enclosed rows are marked', res.inRows.every((x) => x[1]), res.inRows);
        // Boxed draws no operator words at all; where they are drawn, every
        // one inside the range is marked.
        if (skin !== 'boxed') {
          ok(tag + ' operators inside the range are marked',
            res.inConns.every((x) => x[1].length > 0 && x[1].every(Boolean)), res.inConns);
        }
        ok(tag + ' rows outside are left alone', res.outRows.every((x) => x[1]), res.outRows);
        if (style !== 'bar' && style !== 'region') {
          // A bar or region is measured by rows; the connectors of an outer
          // group share lines with enclosed rows, so they are only checked by
          // the styles that mark elements.
          ok(tag + ' operators outside are left alone', res.outConns.every((x) => x[1].every(Boolean)), res.outConns);
        }
        ok(tag + ' the group tool strip is never marked', res.toolsMarked === 0, res.toolsMarked);
        if (c.ghost) {
          if (style === 'highlight') ok(tag + ' ghost is the dashed pill', res.ghost && res.ghost.border === 'dashed', res.ghost);
          else ok(tag + ' ghost is written as text', res.ghost && res.ghost.border === 'none' && res.ghost.op === c.ghost, res.ghost);
        }

        if (skin !== 'boxed' && (c.fk === 'r.2:wrap-and' || c.fk === 'r.2:rm')) {
          await p.screenshot({ path: shot('preview-' + skin + '-' + style + '-' + c.fk.replace(/[:.]/g, '_')), clip: { x: 0, y: 0, width: 780, height: skin === 'prose' ? 230 : 380 } });
        }

        // Leaving clears every trace.
        await park();
        await p.waitForTimeout(200);
        const left = await p.evaluate(() => ({
          marks: document.querySelectorAll('.kce-will-group, .kce-will-remove, .kce-preview-mark, .kce-ghost, .kce-previewing').length,
          faded: Array.from(document.querySelectorAll('.kce-condition')).filter((r) => window.__opacity(r) < 0.95).length
        }));
        ok(tag + ' leaving clears it', left.marks === 0 && left.faded === 0, left);
      }
    }
  }

  // A row with no grip — the only child of its group — still gets its dot.
  await p.evaluate(([d, o]) => window.__mk(d, o),
    [{ version: '1.0', root: { type: 'group', operator: 'and', children: [cond('a', 'solo')] } }, { skin: 'prose', previewStyle: 'marker' }]);
  await point('r:add-or-0');
  const solo = await p.evaluate(() => ({ grip: !!document.querySelector('.kce-grip'), dot: window.__painted(window.__row('solo'), 'marker', 'or') }));
  ok('marker: a row with no grip still shows the dot', !solo.grip && solo.dot, solo);

  // A rule of one condition has no drag grip, so its field name starts at the
  // tree's edge. The styles that draw in the margin must still have room to:
  // the bar clear of the text, the wash beyond it, the dot painted (not
  // clipped by the tree) and clear of the text. Reported from KAStrack, where
  // the bar sat on the field name.
  for (const skin of ['prose', 'equation', 'ledger', 'blackboard', 'boxed']) {
    for (const style of ['bar', 'region', 'marker']) {
      await p.evaluate(([d, o]) => window.__mk(d, o),
        [{ version: '1.0', root: { type: 'group', operator: 'and', children: [cond('a', 'solo')] } }, { skin, previewStyle: style }]);
      await point('r:add-or-0');
      const g = await p.evaluate((style) => {
        const tree = document.querySelector('.kce-tree');
        const edge = tree.getBoundingClientRect().left + tree.clientLeft;
        const row = window.__row('solo');
        const text = row.querySelector('.kce-sel-field .kce-sel-label').getBoundingClientRect().left;
        if (style === 'marker') {
          const cs = getComputedStyle(row, '::before');
          const centre = row.getBoundingClientRect().left + parseFloat(cs.left);
          const half = parseFloat(cs.fontSize) * 0.35;
          return { ok: /●/.test(cs.content) && centre - half >= edge && centre + half <= text - 2, edge, text, dot: [centre - half, centre + half] };
        }
        const m = document.querySelector('.kce-preview-mark').getBoundingClientRect();
        const ok = style === 'bar' ? m.left >= edge && text - m.right >= 5 : m.left >= edge && m.left <= text - 3;
        return { ok, edge, text, mark: [m.left, m.right] };
      }, style);
      ok(skin + '/' + style + ' one condition: the mark has room beside the text', g.ok, g);
    }
  }

  // The option: default, live switching, and an unknown value.
  const attr = () => p.evaluate(() => document.querySelector('.kce').getAttribute('data-kce-preview'));
  ok('the default preview style is bar', await p.evaluate(([d]) => window.__mk(d, {}), [RULE]) === 'bar');
  await p.evaluate(() => window.__ed.setPreviewStyle('fade'));
  ok('setPreviewStyle switches live', await attr() === 'fade');
  await point('r.2:wrap-and');
  ok('a live switch takes effect', await p.evaluate(() => !!document.querySelector('.kce-previewing')));
  await p.evaluate(() => window.__ed.setPreviewStyle('sparkles'));
  ok('an unknown style falls back to bar', await attr() === 'bar');
  ok('switching clears a preview that was up', await p.evaluate(() => !document.querySelector('.kce-previewing, .kce-ghost')));
  ok('an unknown option falls back to bar', await p.evaluate(([d]) => window.__mk(d, { previewStyle: 'sparkles' }), [RULE]) === 'bar');

  // The color style is text: it has to be readable in every palette.
  for (const [skin, theme] of [['prose', null], ['prose', 'dark'], ['blackboard', null]]) {
    await p.evaluate(([d, o]) => window.__mk(d, o), [RULE, { skin, theme, previewStyle: 'color' }]);
    for (const c of [CASES[1], CASES[4]]) {
      await point(c.fk);
      const ratio = await p.evaluate(() => {
        const el = window.__row('high').querySelector('.kce-sel-field .kce-sel-label');
        const lum = (c) => {
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        let bg = null;
        for (let n = el; n && !bg; n = n.parentElement) {
          const cs = getComputedStyle(n);
          const g = /gradient/.test(cs.backgroundImage) && window.__rgb(cs.backgroundImage);
          const c = window.__rgb(cs.backgroundColor);
          if (g) bg = g; else if (c && c.a > 0.9) bg = c;
        }
        bg = bg || { r: 255, g: 255, b: 255 };
        const a = lum(window.__rgb(getComputedStyle(el).color)), b2 = lum(bg);
        return +((Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05)).toFixed(2);
      });
      ok('color style is readable: ' + skin + (theme ? '/' + theme : '') + ' ' + c.name, ratio >= 3, ratio);
    }
  }

  finish(errs);
  await b.close();
  site.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
