'use strict';

/**
 * Runs the shared cross-language fixtures against the JavaScript SDK.
 * The PHP suite runs the very same file, so the two runtimes cannot drift.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const KConditions = require('../../src/k-conditions-evaluator.js');
require('../../src/k-conditions-sql.js');

const fixturePath = path.join(__dirname, '..', 'fixtures', 'cases.json');
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('shared fixtures', async (t) => {
  for (const testCase of fixtures.cases) {
    await t.test(testCase.name, () => {
      const options = Object.assign({}, testCase.options || {});
      const evaluator = new KConditions.Evaluator(options);

      if (testCase.expectThrows) {
        assert.throws(
          () => evaluator.evaluateDetailed(testCase.document, testCase.data),
          KConditions.ConditionError,
          'expected evaluation to throw'
        );
        return;
      }

      const details = evaluator.evaluateDetailed(testCase.document, testCase.data);
      assert.strictEqual(details.result, testCase.expected, 'boolean result');

      if (testCase.expectSkipped) {
        const names = details.skipped.map((s) => s.operator);
        for (const expected of testCase.expectSkipped) {
          assert.ok(names.includes(expected), `expected "${expected}" among skipped: ${JSON.stringify(names)}`);
        }
      }

      if (testCase.expectErrorHandled) {
        const names = details.errors.map((e) => e.operator);
        for (const expected of testCase.expectErrorHandled) {
          assert.ok(names.includes(expected), `expected "${expected}" among handled errors: ${JSON.stringify(names)}`);
        }
      }
    });
  }
});

test('shared SQL fixtures', async (t) => {
  for (const testCase of fixtures.sqlCases) {
    await t.test(testCase.name, () => {
      const options = Object.assign({}, testCase.options || {});

      if (testCase.expectThrows) {
        assert.throws(() => KConditions.toSql(testCase.document, options), /cannot be expressed|Unknown/);
        return;
      }

      const out = KConditions.toSql(testCase.document, options);
      assert.strictEqual(out.sql, testCase.expectedSql, 'generated SQL');

      if (testCase.expectedParams) {
        assert.deepStrictEqual(out.params, testCase.expectedParams, 'bound parameters');
      }
      if (testCase.expectSkipped) {
        const names = out.skipped.map((s) => s.operator);
        for (const expected of testCase.expectSkipped) {
          assert.ok(names.includes(expected), `expected "${expected}" among skipped: ${JSON.stringify(names)}`);
        }
      }
    });
  }
});

test('shared describe fixtures', async (t) => {
  for (const testCase of fixtures.describeCases) {
    await t.test(testCase.name, () => {
      const options = testCase.options || {};
      assert.strictEqual(KConditions.describe(testCase.document, options),
        testCase.expectedText, 'plain text');
      assert.strictEqual(KConditions.describeHtml(testCase.document, options),
        testCase.expectedHtml, 'HTML');
      // Whatever else changes, nothing from the document may reach the output
      // as live markup.
      assert.ok(!/<(img|script|b)\b/i.test(KConditions.describeHtml(testCase.document, options)
        .replace(/<\/?(span|strong)\b[^>]*>/g, '')), 'no unescaped tags survive');
    });
  }
});
