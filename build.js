#!/usr/bin/env node
/*
 * Build the dist/ directory: a minified copy of every source file, plus two
 * combined bundles so a page can load one CSS and one JS file, and the
 * LICENSE, so dist/ can be vendored as it stands.
 *
 *   node build.js
 *
 * The sources stay the deliverable, but dist/ is committed too (from 0.1.2):
 * a tagged release then carries the built files, so a host can vendor them
 * from the tag — or load them from a CDN that serves the tag — without a
 * build of its own. tests/js/dist.test.js fails when dist/ is not what this
 * script makes from src/ now, so a commit cannot carry a stale build.
 *
 * The minified files are also copied to docs/dist/, which the GitHub Pages site
 * in docs/ loads, and the JSON Schema to docs/schema/, where its $id points.
 * Those copies ARE committed — Pages serves the repository as it
 * stands, with no build — so run this after any change to src/ or schema/ and
 * commit docs/ alongside it.
 *
 * Why the JS bundle is not a plain concatenation
 * ----------------------------------------------
 * Each source file is its own UMD module. Concatenated as-is, all three would
 * take the CommonJS branch under a bundler and fight over `module.exports`,
 * and `require('./k-conditions-evaluator.js')` would point at a file that is
 * not next to the bundle. So each file is wrapped in a scope carrying its own
 * `module` and a `require` that resolves from an in-bundle registry, and the
 * bundle's own UMD wrapper decides what to export or attach to the global.
 * The sources are used verbatim; nothing is rewritten.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { minify } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const SITE_DIST = path.join(ROOT, 'docs', 'dist');

const VERSION = require('./package.json').version;

/* Load order is not cosmetic. The evaluator must come first — the others read
   its operator metadata — and k-conditions-skins.css must come after
   k-conditions-editor.css, because the skins deliberately override the base at
   equal specificity and rely on being later in the cascade. */
const JS_FILES = [
  'k-conditions-evaluator.js',
  'k-conditions-sql.js',
  'k-conditions-editor.js'
];
const CSS_FILES = [
  'k-conditions-editor.css',
  'k-conditions-skins.css'
];

const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const gzip = (text) => zlib.gzipSync(Buffer.from(text, 'utf8')).length;

function banner(what) {
  return '/*! kConditionsEditor ' + VERSION + ' — ' + what +
    ' | MIT | https://github.com/KAStrack/kConditionsEditor */\n';
}

/** One source file, given its own module scope and a registry-backed require. */
function wrapModule(name, code) {
  return '/* ---- ' + name + ' ---- */\n' +
    '(function () {\n' +
    'var module = { exports: {} };\n' +
    'var exports = module.exports;\n' +
    'var require = function (p) { return REGISTRY[String(p).replace(/^.*\\//, \'\')]; };\n' +
    code + '\n' +
    'REGISTRY[' + JSON.stringify(name) + '] = module.exports;\n' +
    '}());\n';
}

function buildJsBundle() {
  const parts = JS_FILES.map((name) => wrapModule(name, read(name)));
  return [
    '(function (root, factory) {',
    "  'use strict';",
    '  if (typeof module === \'object\' && module.exports) {',
    '    module.exports = factory();',
    '  } else {',
    '    var api = factory();',
    '    root.KConditions = api.KConditions;',
    '    root.KConditionsEditor = api.KConditionsEditor;',
    '  }',
    '}(typeof globalThis !== \'undefined\' ? globalThis : this, function () {',
    "  'use strict';",
    '  var REGISTRY = {};',
    parts.join('\n'),
    '  return {',
    '    KConditions: REGISTRY[' + JSON.stringify(JS_FILES[0]) + '],',
    '    KConditionsSql: REGISTRY[' + JSON.stringify(JS_FILES[1]) + '],',
    '    KConditionsEditor: REGISTRY[' + JSON.stringify(JS_FILES[2]) + ']',
    '  };',
    '}));',
    ''
  ].join('\n');
}

async function minifyJs(code, keepBanner) {
  const out = await minify(code, {
    // The sources are ES5 on purpose — no build step is required to use them,
    // so nothing here should raise the floor.
    ecma: 5,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: keepBanner ? /^!/ : false, ascii_only: true }
  });
  if (out.error) throw out.error;
  return out.code + '\n';
}

function minifyCss(code) {
  const out = new CleanCSS({ level: 2, format: false, returnPromise: false }).minify(code);
  if (out.errors && out.errors.length) throw new Error(out.errors.join('\n'));
  if (out.warnings && out.warnings.length) {
    out.warnings.forEach((w) => console.warn('  clean-css: ' + w));
  }
  return out.styles + '\n';
}

/**
 * Everything dist/ holds, as [{ name, text, source }], without writing it —
 * so a test can compare it with what is on disk.
 */
async function render() {
  const rows = [];
  const write = (name, text, source) => rows.push({ name: name, text: text, source: source || null });

  /* --- one minified file per source ------------------------------------- */
  for (const name of JS_FILES) {
    const source = read(name);
    // The minified files sit next to each other, so their CommonJS require of
    // a sibling has to name the minified sibling. Without this,
    // `require('dist/k-conditions-sql.min.js')` cannot resolve the evaluator.
    const relinked = source.replace(
      /(['"])\.\/(k-conditions-[a-z]+)\.js\1/g,
      (m, q, base) => q + './' + base + '.min.js' + q
    );
    write(name.replace(/\.js$/, '.min.js'), await minifyJs(relinked, true), source);
  }
  for (const name of CSS_FILES) {
    const source = read(name);
    write(name.replace(/\.css$/, '.min.css'), minifyCss(source), source);
  }

  /* --- the combined pair ------------------------------------------------ */
  const jsBundle = buildJsBundle();
  const jsSource = JS_FILES.map(read).join('\n');
  write('k-conditions.js', banner('editor, evaluator and SQL builder') + jsBundle, jsSource);
  write('k-conditions.min.js',
    banner('editor, evaluator and SQL builder') + await minifyJs(jsBundle, false), jsSource);

  const cssSource = CSS_FILES.map(read).join('\n');
  write('k-conditions.css', banner('base stylesheet and every skin') + cssSource, cssSource);
  write('k-conditions.min.css',
    banner('base stylesheet and every skin') + minifyCss(cssSource), cssSource);

  // The licence travels with the files, so dist/ can be vendored on its own.
  write('LICENSE', fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
  return rows;
}

async function main() {
  const rows = await render();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  rows.forEach((r) => fs.writeFileSync(path.join(DIST, r.name), r.text));

  /* --- the site's copy ------------------------------------------------- */
  // Only the minified files: the pages load those, as a real install would.
  fs.rmSync(SITE_DIST, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIST, { recursive: true });
  rows.filter((r) => /\.min\.(js|css)$/.test(r.name)).forEach((r) => {
    fs.copyFileSync(path.join(DIST, r.name), path.join(SITE_DIST, r.name));
  });

  // The schema's $id is its URL on the site, so the site has to carry it.
  const SCHEMA = path.join('schema', 'condition-document.schema.json');
  fs.mkdirSync(path.join(ROOT, 'docs', 'schema'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, SCHEMA), path.join(ROOT, 'docs', SCHEMA));

  /* --- report ----------------------------------------------------------- */
  const pad = (s, n) => String(s).padEnd(n);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('\nkConditionsEditor ' + VERSION + ' → dist/\n');
  console.log('  ' + pad('file', 30) + pad('size', 11) + pad('gzipped', 11) + 'vs source');
  console.log('  ' + '-'.repeat(62));
  rows.filter((r) => r.name !== 'LICENSE').forEach((r) => {
    const bytes = Buffer.byteLength(r.text);
    const from = r.source ? Buffer.byteLength(r.source) : null;
    const saved = from ? (100 - (bytes / from) * 100).toFixed(0) + '% smaller' : '';
    console.log('  ' + pad(r.name, 30) + pad(kb(bytes), 11) + pad(kb(gzip(r.text)), 11) + saved);
  });
  console.log('\n  minified files and the schema copied to docs/ for the GitHub Pages site\n');
}

module.exports = { render, DIST, SITE_DIST };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
