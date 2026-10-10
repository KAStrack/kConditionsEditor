/*!
 * Shared helpers for the browser checks.
 *
 * These drive real Chromium with real pointer, focus and keyboard events, and
 * judge results by what is painted. They exist because the bugs this project
 * has actually shipped — a lost Ctrl+Z, a tint with no fill, a dropdown where a
 * text box belonged — were all invisible to tests that asserted on markup.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

/** The repository root, whatever it is checked out as. */
const ROOT = path.resolve(__dirname, '..', '..');

/** Where screenshots go. Git-ignored; they are for a human to look at. */
const SHOTS = path.join(__dirname, 'screenshots');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

/**
 * Serve the repository over HTTP.
 *
 * The pages are loaded over http rather than file:// because a file:// origin
 * makes fetch, module loading and some storage behave differently from how a
 * real page behaves, and the point of these checks is the real thing.
 *
 * Pass port 0 (the default) to take whatever port is free — fixed ports collide
 * when scripts are run in parallel, or when a previous run has not let go yet.
 * Pass a directory to serve that instead of the repository root — docs/ is
 * served the way GitHub Pages serves it, so nothing outside it can resolve.
 * Returns { url, close }.
 */
function serve(port, dir) {
  const base = dir || ROOT;
  const server = http.createServer(function (req, res) {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(base, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(file, function (err, body) {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
      res.end(body);
    });
  });
  return new Promise(function (resolve) {
    server.listen(port || 0, function () {
      resolve({
        url: 'http://localhost:' + server.address().port,
        close: function () { server.close(); }
      });
    });
  });
}

/**
 * An absolute path for a throwaway HTML page, plus the path it is served at.
 *
 * These live under tests/browser/.scratch so they are inside the served root
 * (the checks load them over http like any other page) without littering the
 * repository root, which is where they used to land.
 */
function scratch(name, html) {
  const dir = path.join(__dirname, '.scratch');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (html !== undefined) {
    // These pages reference the sources relatively (src/k-conditions-*.js),
    // which resolved while they sat in the repository root. From here they are
    // three directories down, so give every one a base of the served root and
    // let the markup stay as it reads.
    const based = /<!doctype[^>]*>/i.test(html)
      ? html.replace(/(<!doctype[^>]*>)/i, '$1\n<base href="/">')
      : '<base href="/">\n' + html;
    fs.writeFileSync(file, based);
  }
  return file;
}

/** The URL path a scratch page is served at. */
scratch.url = function (name) { return '/tests/browser/.scratch/' + name; };

/** Remove a scratch page. Optional — the directory is git-ignored. */
scratch.remove = function (name) {
  try { fs.unlinkSync(path.join(__dirname, '.scratch', name)); } catch (e) { /* already gone */ }
};

/** An absolute path for a screenshot, creating the directory on demand. */
function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, name.endsWith('.png') ? name : name + '.png');
}

/**
 * A minimal assertion recorder.
 *
 * The runner decides pass or fail from a script's exit code, so finish() must
 * be called — or the script must throw. Printing "failures: 0" is not enough on
 * its own any more, though it is still printed because it is useful to read.
 */
function checker() {
  let failed = 0;
  let total = 0;
  return {
    ok: function (name, condition, detail) {
      total++;
      if (!condition) {
        failed++;
        console.log('FAIL ' + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
      }
    },
    finish: function (errors) {
      console.log(total + ' checks, failures: ' + failed);
      const consoleErrors = errors && errors.length ? errors : null;
      console.log('ERRORS: ' + (consoleErrors ? consoleErrors.join(' | ') : 'none'));
      if (failed || consoleErrors) process.exitCode = 1;
    }
  };
}

/** Collect page errors and console errors onto one array. */
function watchErrors(page, into) {
  page.on('pageerror', function (e) { into.push(String(e)); });
  page.on('console', function (m) { if (m.type() === 'error') into.push(m.text()); });
  return into;
}

module.exports = { ROOT, SHOTS, serve, shot, scratch, checker, watchErrors };
