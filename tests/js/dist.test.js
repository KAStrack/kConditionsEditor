'use strict';

/*
 * dist/ and docs/dist/ are committed, so a tag carries the built files and the
 * GitHub Pages site runs the current code. Both are generated, though, and a
 * commit that changed src/ without rebuilding would ship the previous version
 * under the new one's name. This builds in memory and compares, byte for byte.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { render, DIST, SITE_DIST } = require('../../build.js');

const FIX = 'run `npm run build` and commit dist/ and docs/dist/ with the change';

test('dist/ and docs/dist/ are what build.js makes from src/ now', async () => {
  const rows = await render();
  const expected = rows.map((r) => r.name).sort();
  const onDisk = fs.existsSync(DIST) ? fs.readdirSync(DIST).sort() : [];
  assert.deepStrictEqual(onDisk, expected, 'dist/ holds exactly the built files — ' + FIX);
  for (const r of rows) {
    assert.ok(fs.readFileSync(path.join(DIST, r.name), 'utf8') === r.text, 'dist/' + r.name + ' is stale — ' + FIX);
    if (/\.min\.(js|css)$/.test(r.name)) {
      assert.ok(fs.readFileSync(path.join(SITE_DIST, r.name), 'utf8') === r.text, 'docs/dist/' + r.name + ' is stale — ' + FIX);
    }
  }
});
