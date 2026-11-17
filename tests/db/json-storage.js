#!/usr/bin/env node
/*
 * `storage: 'json'` against real databases: every list and existence operator,
 * plain and negated, over thirty-odd stored forms, comparing the rows the SQL
 * picks with what the evaluator says for each stored value.
 *
 *   node tests/db/json-storage.js                       # SQLite (Node 22.5+)
 *   KCE_MYSQL="-h127.0.0.1 -P3306 -uroot test" node tests/db/json-storage.js
 *
 * KCE_MYSQL is passed to the `mysql` command-line client (connection options
 * and a database it may create tables in: `kce_json_t`, `kce_json_j`). With it,
 * MySQL is checked twice — a TEXT column holding every form, and a native JSON
 * column holding the forms that are valid JSON — plus a parameterised query.
 *
 * Not part of `npm test`: the project's suites have no database. Run it after
 * changing anything in the JSON-storage path (SPEC §7). It fails on any
 * disagreement except the two SPEC §7 documents, listed in KNOWN below, so a
 * new one cannot hide among them.
 */
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const K = require(path.join(__dirname, '..', '..', 'src', 'k-conditions-evaluator.js'));
require(path.join(__dirname, '..', '..', 'src', 'k-conditions-sql.js'));

const FORMS = [null, '', '[]', '["[]"]', '[""]', '[null]', 'null', '"[]"', '""', '"[\\"\\"]"',
  '["3184"]', '["3184","3152"]', '["3184", "3152"]', '["3152"]', 'claude claudesson (claude)',
  '["claude claudesson (claude)"]', '3184', '"3184"', '[3184]', '{"a":"3184"}', '["","3184"]',
  '["O\'Brien"]', '["a\\\\b"]', '["é"]', '["[\\"3184\\"]"]', '"[\\"3184\\"]"', 'true', '"null"',
  '["null"]', '[{"a":"3184"}]',
  // The two SPEC §7 leaves to differ: whitespace inside the brackets, and a nested array.
  '[ ]', '[["3184"]]'];

// Disagreements SPEC §7 documents. Anything else fails the run.
const KNOWN = [
  { form: '[ ]', why: 'the SQL compares spellings of empty; the evaluators decode' },
  { form: '[["3184"]]', engine: 'mysql', why: "MySQL's JSON_CONTAINS looks into nested arrays" }
];

const OPS = [['is_empty'], ['is_not_empty'], ['is_set'], ['is_not_set'],
  ['includes_any', ['3184']], ['includes_any', ['3184', '3152']], ['includes_all', ['3184', '3152']],
  ['includes_any', ["O'Brien"]], ['includes_any', ['a\\b']], ['includes_any', ['é']],
  ['includes_any', []], ['includes_all', []], ['includes_any', [3184]],
  ['includes_any', ['claude claudesson (claude)']], ['includes_any', ['[]']], ['includes_any', ['null']],
  ['includes_any', 'claude claudesson (claude),3184']];

const FIELDS = [{ name: 'f', column: 'v', type: 'list', storage: 'json' }];
const doc = (op, v, negate) => ({ version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'f', operator: op, negate, values: v === undefined ? [] : [{ source: 'literal', value: v }] }] } });
const evaluator = new K.Evaluator({ fields: FIELDS });

let checks = 0;
const unexpected = [];
const known = new Set();

function compare(engine, label, forms, rowsMatching) {
  for (const [op, v] of OPS) {
    for (const negate of [false, true]) {
      const d = doc(op, v, negate);
      const sql = K.toSql(d, { dialect: engine, fields: FIELDS }).sql;
      const got = rowsMatching(sql);
      forms.forEach((form, id) => {
        checks++;
        const want = evaluator.evaluate(d, { f: form });
        if (want === got.has(id)) return;
        const k = KNOWN.find((x) => x.form === form && (!x.engine || x.engine === engine));
        const line = `${label}: ${negate ? 'NOT ' : ''}${op}${v === undefined ? '' : ' ' + JSON.stringify(v)} on ${JSON.stringify(form)} — evaluator ${want}, SQL ${got.has(id)}`;
        if (k) known.add(`${label}: ${JSON.stringify(form)} (${k.why})`);
        else unexpected.push(line);
      });
    }
  }
}

/* SQLite, through node:sqlite. */
let sqlite = null;
try { sqlite = require('node:sqlite'); } catch (e) { /* Node before 22.5 */ }
if (sqlite) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
  FORMS.forEach((f, i) => insert.run(i, f));
  compare('sqlite', 'sqlite TEXT', FORMS, (sql) => new Set(db.prepare(`SELECT id FROM t WHERE ${sql}`).all().map((r) => r.id)));
} else {
  console.log('SQLite skipped: node:sqlite needs Node 22.5 or later.');
}

/* MySQL / MariaDB, through the mysql client. */
if (process.env.KCE_MYSQL) {
  const args = process.env.KCE_MYSQL.split(/\s+/).filter(Boolean);
  const my = (sql) => execFileSync('mysql', [...args, '-N', '-B', '-e', sql], { encoding: 'utf8' });
  const q = (s) => (s === null ? 'NULL' : "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'");
  const isJson = (s) => { if (s === null) return true; try { JSON.parse(s); return true; } catch (e) { return false; } };
  const jsonForms = FORMS.filter(isJson);
  let setup = 'DROP TABLE IF EXISTS kce_json_t; DROP TABLE IF EXISTS kce_json_j;' +
    'CREATE TABLE kce_json_t (id INT PRIMARY KEY, v TEXT) CHARACTER SET utf8mb4;' +
    'CREATE TABLE kce_json_j (id INT PRIMARY KEY, v JSON);';
  FORMS.forEach((f, i) => { setup += `INSERT INTO kce_json_t VALUES (${i}, ${q(f)});`; });
  jsonForms.forEach((f, i) => { setup += `INSERT INTO kce_json_j VALUES (${i}, ${q(f)});`; });
  my(setup);
  console.log('MySQL: ' + my('SELECT VERSION()').trim());
  const rows = (table) => (sql) => new Set(my(`SELECT id FROM ${table} WHERE ${sql}`).split('\n').filter(Boolean).map(Number));
  compare('mysql', 'mysql TEXT', FORMS, rows('kce_json_t'));
  compare('mysql', 'mysql JSON', jsonForms, rows('kce_json_j'));

  // Bound parameters, through a prepared statement.
  const d = doc('includes_any', ["O'Brien", 'a\\b'], true);
  const out = K.toSql(d, { dialect: 'mysql', fields: FIELDS, parameters: true });
  const sets = out.params.map((p, i) => `SET @p${i} = ${q(p)};`).join('');
  const got = new Set(my(`${sets} PREPARE s FROM ${q('SELECT id FROM kce_json_t WHERE ' + out.sql)};` +
    ` EXECUTE s USING ${out.params.map((_, i) => '@p' + i).join(', ')};`).split('\n').filter(Boolean).map(Number));
  FORMS.forEach((form, id) => {
    checks++;
    if (evaluator.evaluate(d, { f: form }) !== got.has(id)) unexpected.push('mysql parameters: ' + JSON.stringify(form));
  });
  my('DROP TABLE kce_json_t; DROP TABLE kce_json_j;');
} else {
  console.log('MySQL skipped: set KCE_MYSQL to mysql client options and a database to check it.');
}

console.log(`${checks} row checks.`);
if (known.size) console.log('Known, documented in SPEC §7:\n  ' + [...known].join('\n  '));
if (unexpected.length) {
  console.log(`FAIL ${unexpected.length} rows where the SQL and the evaluator disagree:\n  ` + unexpected.join('\n  '));
  process.exit(1);
}
console.log('The SQL and the evaluator pick the same rows.');
