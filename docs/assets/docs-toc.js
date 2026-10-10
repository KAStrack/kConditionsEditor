/* The docs page's contents column: marks where the reader is.
 *
 * Each section's h3s are listed under it (given ids if they have none), shown
 * while that section is the current one. The current entry is the last heading
 * whose top has scrolled past a line near the top of the viewport. Near the end
 * of the page the last sections can never reach that line, so there the entry
 * the reader jumped to wins if it is on screen, and otherwise the last one does.
 *
 * Without this script the column is still a working list of section links.
 */
/* global window, document */
(function () {
  'use strict';

  var toc = document.querySelector('.docs-layout > .toc');
  if (!toc) return;

  // A heading this close to the top of the viewport counts as the current one.
  var LINE = 96;

  var entries = [];  // document order: { heading, link, item }
  var used = {};

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function uniqueId(base) {
    var id = base;
    var n = 2;
    while (used[id] || document.getElementById(id)) id = base + '-' + n++;
    used[id] = true;
    return id;
  }

  Array.prototype.forEach.call(toc.querySelectorAll(':scope > ul > li'), function (item) {
    var link = item.querySelector('a[href^="#"]');
    var section = link && document.getElementById(link.getAttribute('href').slice(1));
    if (!section) return;
    entries.push({ heading: section, link: link, item: item });

    var subs = section.querySelectorAll('h3');
    if (!subs.length) return;
    var list = document.createElement('ul');
    list.className = 'toc-sub';
    Array.prototype.forEach.call(subs, function (h3) {
      if (!h3.id) h3.id = uniqueId(section.id + '-' + slug(h3.textContent));
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h3.id;
      a.textContent = h3.textContent.replace(/\s+/g, ' ').trim();
      li.appendChild(a);
      list.appendChild(li);
      entries.push({ heading: h3, link: a, item: item });
    });
    item.appendChild(list);
  });
  if (!entries.length) return;

  // A link to a subsection names an id this script just gave it, so the
  // browser found nothing to scroll to on load. Go there now.
  var linked = window.location.hash && document.getElementById(window.location.hash.slice(1));
  if (linked && used[linked.id]) linked.scrollIntoView();

  function current() {
    var pick = entries[0];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].heading.getBoundingClientRect().top > LINE) break;
      pick = entries[i];
    }
    var root = document.documentElement;
    var atEnd = window.innerHeight + window.pageYOffset >= root.scrollHeight - 2;
    if (atEnd) {
      pick = entries[entries.length - 1];
      var target = window.location.hash && document.getElementById(window.location.hash.slice(1));
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].heading === target && target.getBoundingClientRect().top >= 0) {
          pick = entries[j];
        }
      }
    }
    return pick;
  }

  var shown = null;

  function mark() {
    var pick = current();
    if (pick === shown) return;
    if (shown) {
      shown.link.classList.remove('is-active');
      shown.link.removeAttribute('aria-current');
      shown.item.classList.remove('is-open');
    }
    pick.item.classList.add('is-open');
    pick.link.classList.add('is-active');
    pick.link.setAttribute('aria-current', 'location');
    shown = pick;
    keepInView(pick.link);
  }

  // When the column is taller than the window it scrolls on its own; keep the
  // marked entry inside it. Its scrollTop only, never the page's.
  function keepInView(link) {
    if (toc.scrollHeight <= toc.clientHeight) return;
    var box = toc.getBoundingClientRect();
    var r = link.getBoundingClientRect();
    var room = 48;
    if (r.top < box.top + room) toc.scrollTop -= box.top + room - r.top;
    else if (r.bottom > box.bottom - room) toc.scrollTop += r.bottom - (box.bottom - room);
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; mark(); });
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  mark();
}());
