#!/usr/bin/env node
/*!
 * Runs every browser check, in sequence, and fails the build if any is red.
 *
 * Sequential on purpose: each script starts its own static server on a fixed
 * port, and several picked the same one. Sequential also keeps the output
 * readable, which matters more here than the couple of minutes saved — these
 * are the checks people skip.
 *
 * A script counts as failed if it exits non-zero, prints a line starting
 * "FAIL", reports a non-zero failure count, or reports console errors. The
 * belt-and-braces is deliberate: the older scripts predate the shared harness
 * and signal only through stdout, and a check that cannot fail the run is not
 * a check.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SKIP = new Set(['run.js', 'harness.js']);

const args = process.argv.slice(2);
if (args.indexOf('-h') !== -1 || args.indexOf('--help') !== -1) {
  console.log([
    'Usage: node tests/browser/run.js [name ...]',
    '',
    'Runs every browser check in tests/browser, in sequence.',
    'Give one or more substrings to run only the scripts whose names match:',
    '',
    '  node tests/browser/run.js undo          # undo-redo, undo-keyboard-ownership',
    '  node tests/browser/run.js drag preview  # both drag checks and both previews',
    '',
    'Exits non-zero if any check fails. Screenshots land in',
    'tests/browser/screenshots (git-ignored).'
  ].join('\n'));
  process.exit(0);
}

const only = args.filter(function (a) { return a[0] !== '-'; });

const scripts = fs.readdirSync(DIR)
  .filter(function (f) { return f.endsWith('.js') && !SKIP.has(f); })
  .filter(function (f) {
    return !only.length || only.some(function (o) { return f.indexOf(o) !== -1; });
  })
  .sort();

if (!scripts.length) {
  console.error(only.length ? 'No browser checks match: ' + only.join(', ') : 'No browser checks found.');
  process.exit(1);
}

function verdict(script) {
  const run = spawnSync(process.execPath, [path.join(DIR, script)], {
    encoding: 'utf8',
    cwd: DIR,
    // A guard against a hung browser, not a budget: no-overlaps.js crosses
    // every rule, width, control mode, preview style and placement, and takes
    // about three minutes on its own.
    timeout: 300000
  });
  const out = (run.stdout || '') + (run.stderr || '');
  const reasons = [];

  if (run.error) reasons.push(run.error.code === 'ETIMEDOUT' ? 'timed out' : String(run.error.message));
  if (run.status) reasons.push('exit ' + run.status);
  if (/^FAIL\b/m.test(out)) reasons.push('assertion failed');
  const counted = /failures:\s*(\d+)/.exec(out);
  if (counted && Number(counted[1]) > 0) reasons.push(counted[1] + ' failed');
  const errs = /ERRORS:\s*(.+)/.exec(out);
  if (errs && errs[1].trim() !== 'none') reasons.push('console errors');
  // A script that printed no verdict at all has probably died quietly.
  if (!/failures:|ERRORS:/.test(out) && !run.status) reasons.push('no verdict printed');

  return { reasons: reasons, out: out };
}

// Preflight: a missing browser build makes every single script fail with the
// same wall of text. Detect it once and say the one thing that fixes it.
(function preflight() {
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    console.error('playwright is not installed. Run:\n\n  npm install\n');
    process.exit(1);
  }
  let exe;
  try { exe = chromium.executablePath(); } catch (e) { exe = null; }
  if (!exe || !fs.existsSync(exe)) {
    console.error([
      'Chromium is not installed for this copy of Playwright.',
      '',
      '  npx playwright install chromium',
      '',
      'Expected at: ' + (exe || '(unknown)')
    ].join('\n'));
    process.exit(1);
  }
})();

const started = Date.now();
const failures = [];

console.log('Browser checks — ' + scripts.length + ' script' + (scripts.length === 1 ? '' : 's') + '\n');

scripts.forEach(function (script, i) {
  const label = String(i + 1).padStart(2, ' ') + '/' + scripts.length + '  ' + script;
  process.stdout.write(label.padEnd(44, ' '));
  const t = Date.now();
  const r = verdict(script);
  const secs = ((Date.now() - t) / 1000).toFixed(1) + 's';
  if (r.reasons.length) {
    console.log('FAIL  ' + secs + '   ' + r.reasons.join(', '));
    failures.push({ script: script, out: r.out, reasons: r.reasons });
  } else {
    console.log('ok    ' + secs);
  }
});

const took = ((Date.now() - started) / 1000).toFixed(0);

if (failures.length) {
  failures.forEach(function (f) {
    console.log('\n' + '─'.repeat(64) + '\n' + f.script + ' — ' + f.reasons.join(', ') + '\n');
    console.log(f.out.trim());
  });
  console.log('\n' + failures.length + ' of ' + scripts.length + ' failed in ' + took + 's');
  process.exit(1);
}

console.log('\nAll ' + scripts.length + ' passed in ' + took + 's');
