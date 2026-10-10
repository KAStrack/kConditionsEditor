'use strict';

const test = require('node:test');
const assert = require('node:assert');

const K = require('../../src/k-conditions-evaluator.js');

function doc(children, operators) {
  return {
    version: '1.0',
    operators: operators || {},
    root: { type: 'group', operator: 'and', children: children }
  };
}

function cond(field, operator, values) {
  return { type: 'condition', field: field, operator: operator, values: values || [] };
}

function lit(v) { return { source: 'literal', value: v }; }

test('registered operators take priority over the manifest', () => {
  const d = doc([cond('email', 'email_is_unique')], {
    email_is_unique: { kind: 'callback', arity: 0, policy: { unresolved: 'skip' } }
  });
  const ev = new K.Evaluator();
  ev.registerOperator('email_is_unique', (value) => value === 'new@example.com');

  assert.strictEqual(ev.evaluate(d, { email: 'new@example.com' }), true);
  assert.strictEqual(ev.evaluate(d, { email: 'taken@example.com' }), false);
});

test('a registered callback may return SKIP at runtime', () => {
  const d = doc([
    cond('state', 'eq', [lit('Texas')]),
    cond('email', 'maybe')
  ], { maybe: { kind: 'callback', arity: 0 } });

  const ev = new K.Evaluator();
  ev.registerOperator('maybe', () => K.SKIP);

  const details = ev.evaluateDetailed(d, { state: 'Texas', email: 'x@y.z' });
  assert.strictEqual(details.result, true);
  assert.strictEqual(details.skipped.length, 1);
  assert.strictEqual(details.skipped[0].reason, 'callback-skip');
});

test('a throwing callback follows the error policy', () => {
  const d = doc([cond('email', 'boom')], {
    boom: { kind: 'callback', arity: 0, policy: { error: 'skip' } }
  });
  const ev = new K.Evaluator();
  ev.registerOperator('boom', () => { throw new Error('database is down'); });

  const details = ev.evaluateDetailed(d, { email: 'x@y.z' });
  assert.strictEqual(details.result, true, 'skipped, so the empty document result applies');
  assert.strictEqual(details.skipped[0].reason, 'error');
});

test('errorPolicy "false" records the cause', () => {
  const d = doc([cond('email', 'boom')], { boom: { kind: 'callback', arity: 0 } });
  const ev = new K.Evaluator({ errorPolicy: 'false' });
  ev.registerOperator('boom', () => { throw new Error('database is down'); });

  const details = ev.evaluateDetailed(d, { email: 'x@y.z' });
  assert.strictEqual(details.result, false);
  assert.strictEqual(details.errors[0].message, 'database is down');
});

test('manifest callbacks are refused unless explicitly allowed', () => {
  globalThis.__kceProbe = () => true;
  const d = doc([cond('email', 'probe')], {
    probe: { kind: 'callback', arity: 0, callbacks: { js: { function: '__kceProbe' } }, policy: { unresolved: 'skip' } }
  });

  const locked = new K.Evaluator();
  assert.strictEqual(locked.evaluateDetailed(d, {}).skipped.length, 1, 'refused by default');

  const opened = new K.Evaluator({ allowManifestCallbacks: true });
  assert.strictEqual(opened.evaluate(d, {}), true);

  const narrowed = new K.Evaluator({ allowManifestCallbacks: true, callbackAllowList: ['something_else'] });
  assert.strictEqual(narrowed.evaluateDetailed(d, {}).skipped.length, 1, 'refused by allow list');

  delete globalThis.__kceProbe;
});

test('the result hook replaces the return value and receives the original arguments', () => {
  const d = doc([cond('state', 'eq', [lit('Texas')])]);
  const options = { environment: 'server' };

  const out = K.evaluate(d, { state: 'Texas' }, options, function (document, data, opts, result, details) {
    assert.strictEqual(document, d);
    assert.deepStrictEqual(data, { state: 'Texas' });
    assert.strictEqual(opts, options);
    assert.strictEqual(result, true);
    assert.ok(Array.isArray(details.skipped));
    return { ok: result, deferred: details.skipped.length };
  });

  assert.deepStrictEqual(out, { ok: true, deferred: 0 });
});

test('Evaluator#evaluate also accepts a hook', () => {
  const d = doc([cond('state', 'eq', [lit('Nevada')])]);
  const ev = new K.Evaluator();
  const out = ev.evaluate(d, { state: 'Texas' }, (document, data, opts, result) => (result ? 'yes' : 'no'));
  assert.strictEqual(out, 'no');
});

test('describe renders the worked example', () => {
  const d = {
    version: '1.0',
    root: {
      type: 'group', operator: 'and', children: [
        cond('name', 'regex', [lit('^ben')]),
        {
          type: 'group', operator: 'or', children: [
            cond('dob', 'date_before', [lit('1980')]),
            {
              type: 'group', operator: 'and', children: [
                cond('dob', 'date_before', [lit('1982')]),
                cond('state', 'in_list', [lit(['Florida', 'Texas'])])
              ]
            }
          ]
        }
      ]
    }
  };

  const text = K.describe(d, {
    fields: [{ name: 'name', label: 'Name' }, { name: 'dob', label: 'Date of Birth' }, { name: 'state', label: 'State' }]
  });

  assert.strictEqual(
    text,
    '([Name] matches regex "^ben" AND ([Date of Birth] is before "1980" OR ([Date of Birth] is before "1982" AND [State] is one of ["Florida", "Texas"])))'
  );
});

test('describe falls back to the empty text', () => {
  assert.strictEqual(K.describe(K.createDocument(), { emptyText: 'No conditions' }), 'No conditions');
});

test('validateDocument catches arity and field problems', () => {
  const d = doc([
    cond('name', 'between', [lit(1)]),
    cond('nope', 'eq', [lit(1)]),
    cond('name', 'not_an_operator', [])
  ]);

  const problems = K.validateDocument(d, { fields: [{ name: 'name' }] });
  const messages = problems.map((p) => p.message);

  assert.ok(messages.some((m) => m.includes('expects 2 value(s)')));
  assert.ok(messages.some((m) => m.includes('Unknown field "nope"')));
  assert.ok(messages.some((m) => m.includes('Unknown operator "not_an_operator"')));
});

test('documents may be passed as JSON strings or bare nodes', () => {
  const d = doc([cond('state', 'eq', [lit('Texas')])]);
  assert.strictEqual(K.evaluate(JSON.stringify(d), { state: 'Texas' }), true);
  assert.strictEqual(K.evaluate(d.root, { state: 'Texas' }), true);
  assert.strictEqual(K.evaluate(cond('state', 'eq', [lit('Texas')]), { state: 'Texas' }), true);
  assert.strictEqual(K.evaluate('', {}), true);
});

test('date helpers read partial dates as their earliest UTC instant', () => {
  assert.strictEqual(K.helpers.toDate('1980'), Date.UTC(1980, 0, 1));
  assert.strictEqual(K.helpers.toDate('1980-06'), Date.UTC(1980, 5, 1));
  assert.strictEqual(K.helpers.toDate(1980), Date.UTC(1980, 0, 1));
  assert.strictEqual(K.helpers.toDate('nonsense'), null);
});

test('trace records every evaluated node when enabled', () => {
  const d = doc([cond('state', 'eq', [lit('Texas')])]);
  const details = new K.Evaluator({ trace: true }).evaluateDetailed(d, { state: 'Texas' });
  assert.strictEqual(details.trace.length, 2);
  assert.strictEqual(details.trace[0].type, 'condition');
  assert.strictEqual(details.trace[1].type, 'group');
});
