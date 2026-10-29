'use strict';

/*
 * `kselect: true` loads kSelect from a pinned CDN URL with subresource
 * integrity. The hashes in the editor must be the hashes of the files at that
 * tag, or every browser refuses the load. tests/browser/vendor/kselect/ holds
 * the same files (the browser checks serve them in place of the CDN), so the
 * constants are held to their bytes here, and the vendored copy to the tag
 * named in the URL.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/k-conditions-editor.js'), 'utf8');
const VENDOR = path.join(ROOT, 'tests/browser/vendor/kselect');
const sri = (file) => 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(VENDOR, file))).digest('base64');

test('the pinned kSelect integrity hashes are those of the vendored files', () => {
  const js = /jsIntegrity: '([^']+)'/.exec(SRC);
  const css = /cssIntegrity: '([^']+)'/.exec(SRC);
  assert.ok(js && css, 'KSELECT_SRC carries both hashes');
  assert.strictEqual(js[1], sri('kselect.min.js'), 'kselect.min.js');
  assert.strictEqual(css[1], sri('kselect.min.css'), 'kselect.min.css');
});

test('the vendored kSelect is the version the CDN URL names', () => {
  const version = /var KSELECT_VERSION = '([^']+)'/.exec(SRC)[1];
  const banner = fs.readFileSync(path.join(VENDOR, 'kselect.min.js'), 'utf8').slice(0, 400);
  assert.ok(banner.indexOf(version) !== -1, 'kselect.min.js banner names ' + version);
});
