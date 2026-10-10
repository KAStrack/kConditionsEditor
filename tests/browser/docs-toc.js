/*!
 * The docs page's contents column: always visible, marking where the reader is.
 *
 * Judged by what the reader sees. The column is hit-tested at the marked entry
 * (painted, not merely present), the mark is read from computed colours, and
 * every jump is a real click on the column, followed by waiting for the smooth
 * scroll to settle — a measurement taken mid-scroll marks a section the reader
 * is passing through.
 */
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, serve, shot, checker, watchErrors } = require('./harness.js');

// docs-toc.js's line: a heading this close to the top is the current one.
const LINE = 96;

async function settle(p) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const y = await p.evaluate(() => window.scrollY);
    if (y === last) break;
    last = y;
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(80);
}

/** What is marked, and whether it is what the reader is looking at. */
function state(p) {
  return p.evaluate((LINE) => {
    const toc = document.querySelector('.docs-layout > .toc');
    const marked = [...toc.querySelectorAll('a.is-active')];
    const a = marked[0];
    const links = [...toc.querySelectorAll('a[href^="#"]')]
      .filter(l => getComputedStyle(l).display !== 'none' && l.offsetParent);
    const headings = links.map(l => document.getElementById(l.getAttribute('href').slice(1)));
    const out = { count: marked.length };
    if (!a) return out;
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 30), r.top + r.height / 2);
    const quiet = links.find(l => l !== a && !l.parentNode.classList.contains('is-open'));
    const heading = document.getElementById(a.getAttribute('href').slice(1));
    const i = headings.indexOf(heading);
    const next = headings[i + 1];
    const root = document.documentElement;
    return Object.assign(out, {
      href: a.getAttribute('href'),
      text: a.textContent,
      current: a.getAttribute('aria-current'),
      painted: hit === a || a.contains(hit),
      inWindow: r.top >= 0 && r.bottom <= innerHeight,
      colour: getComputedStyle(a).color,
      rail: getComputedStyle(a).borderLeftColor,
      quietColour: quiet && getComputedStyle(quiet).color,
      headingTop: Math.round(heading.getBoundingClientRect().top),
      nextTop: next ? Math.round(next.getBoundingClientRect().top) : null,
      atEnd: innerHeight + scrollY >= root.scrollHeight - 2,
      position: getComputedStyle(toc).position,
      tocRight: toc.getBoundingClientRect().right,
      mainLeft: document.querySelector('.docs-main').getBoundingClientRect().left
    });
  }, LINE);
}

async function clickEntry(p, href) {
  await p.click('.docs-layout > .toc a[href="' + href + '"]');
  await settle(p);
}

(async () => {
  const site = await serve(0, path.join(ROOT, 'docs'));
  const b = await chromium.launch();
  const errs = [];
  const { ok, finish } = checker();

  const ACCENT = { light: 'rgb(47, 111, 208)', dark: 'rgb(91, 155, 255)' };

  for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    watchErrors(p, errs);
    await p.goto(site.url + '/docs.html');
    await settle(p);
    const tag = '[' + scheme + '] ';

    let s = await state(p);
    ok(tag + 'at the top, Installation is marked', s.href === '#install', s);
    ok(tag + 'one entry is marked, as the location', s.count === 1 && s.current === 'location', s);
    ok(tag + 'the mark is the accent colour, on text and rail',
      s.colour === ACCENT[scheme] && s.rail === ACCENT[scheme], s);
    ok(tag + 'an unmarked entry is not', s.quietColour && s.quietColour !== s.colour, s);
    ok(tag + 'the column sits beside the text, not over it', s.tocRight <= s.mainLeft, s);

    // a section, by a click on the column
    await clickEntry(p, '#skins');
    s = await state(p);
    ok(tag + 'clicking Skins marks Skins', s.href === '#skins', s);
    ok(tag + 'the column is still on screen after the jump', s.position === 'sticky' && s.painted && s.inWindow, s);

    // a subsection, listed only once its section is open
    await clickEntry(p, '#sql');
    const sub = await p.evaluate(() => {
      const li = document.querySelector('.docs-layout > .toc a[href="#sql"]').parentNode;
      const a = li.querySelector('.toc-sub a');
      return a && { href: a.getAttribute('href'), open: li.classList.contains('is-open'),
        shown: getComputedStyle(li.querySelector('.toc-sub')).display !== 'none',
        othersHidden: [...document.querySelectorAll('.toc-sub')].filter(u => getComputedStyle(u).display !== 'none').length === 1 };
    });
    ok(tag + "SQL output's subsections are listed, and no other section's", sub && sub.open && sub.shown && sub.othersHidden, sub);
    if (sub) {
      const second = await p.evaluate(() => document.querySelectorAll('.docs-layout > .toc a[href="#sql"] + .toc-sub a')[1].getAttribute('href'));
      await clickEntry(p, second);
      s = await state(p);
      ok(tag + 'clicking a subsection marks the subsection', s.href === second, s);
      ok(tag + 'its section stays open around it',
        await p.evaluate(() => document.querySelector('.docs-layout > .toc a[href="#sql"]').parentNode.classList.contains('is-open')));
    }

    // scrolling by wheel: whatever is marked is the last heading past the line
    let stops = 0, wrong = [];
    await p.mouse.move(800, 400);
    for (let i = 0; i < 14; i++) {
      await p.mouse.wheel(0, 1300);
      await settle(p);
      s = await state(p);
      stops++;
      if (!s.atEnd && !(s.headingTop <= LINE && (s.nextTop === null || s.nextTop > LINE))) wrong.push(s.text + ' ' + s.headingTop + '/' + s.nextTop);
      if (!s.painted) wrong.push('not painted at ' + s.text);
    }
    ok(tag + 'scrolling marks the heading at the top, at every stop (' + stops + ')', wrong.length === 0, wrong);

    // the end of the page: the last sections can never reach the line
    await p.keyboard.press('End');
    await settle(p);
    s = await state(p);
    ok(tag + 'at the end, the last section is marked', s.href === '#porting' && s.atEnd, s);
    await clickEntry(p, '#security');
    s = await state(p);
    ok(tag + 'clicking Security near the end marks Security, not the last one', s.href === '#security', s);

    await p.screenshot({ path: shot('docs-toc-' + scheme + '.png') });
    await p.close();
  }

  // a link to a subsection: its id is made by the script, after the browser looked
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    watchErrors(p, errs);
    await p.goto(site.url + '/docs.html#sql-options');
    await settle(p);
    const s = await state(p);
    ok('a link to a subsection lands there and marks it', s.href === '#sql-options' && Math.abs(s.headingTop) <= LINE, s);
    await p.close();
  }

  // narrow: the box above the text, as before; no column, no sideways scroll
  {
    const p = await b.newPage({ viewport: { width: 700, height: 900 } });
    watchErrors(p, errs);
    await p.goto(site.url + '/docs.html');
    await settle(p);
    const n = await p.evaluate(() => {
      const toc = document.querySelector('.toc');
      const main = document.querySelector('.docs-main');
      return {
        position: getComputedStyle(toc).position,
        above: toc.getBoundingClientRect().bottom <= main.getBoundingClientRect().top,
        subsShown: [...document.querySelectorAll('.toc-sub')].some(u => getComputedStyle(u).display !== 'none'),
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    ok('narrow: the contents is a box above the text', n.position !== 'sticky' && n.above, n);
    ok('narrow: no subsection lists, no sideways scroll', !n.subsShown && !n.sideways, n);
    await p.close();
  }

  await b.close(); site.close();
  finish(errs);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
