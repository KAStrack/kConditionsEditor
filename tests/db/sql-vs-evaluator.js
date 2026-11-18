#!/usr/bin/env node
/*
 * The SQL against real databases, for the stored-value options (SPEC §7):
 * `storage: 'json'` and `countAsBlank`. For every operator they decide, plain
 * and negated, over forty-odd stored forms, it compares the rows the SQL picks
 * with what the evaluator says about each row's value.
 *
 *   node tests/db/sql-vs-evaluator.js                       # SQLite (Node 22.5+)
 *   KCE_MYSQL="-h127.0.0.1 -P3306 -uroot test" node tests/db/sql-vs-evaluator.js
 *
 * KCE_MYSQL is passed to the `mysql` command-line client (connection options
 * and a database it may create tables in: `kce_json_t`, `kce_json_j`). With it,
 * MySQL is checked twice — a TEXT column holding every form, and a native JSON
 * column holding the forms that are valid JSON — plus a parameterised query.
 * SQLite is checked on a plain TEXT column and on a COLLATE NOCASE one.
 *
 * The evaluator is given what the server hands back for the row, as a host
 * reading the column would be: on a native JSON column that is the server's
 * own spelling (`[ ]` comes back `[]`).
 *
 * Not part of `npm test`: the project's suites have no database. Run it after
 * changing anything in the stored-value path. It fails on any disagreement
 * except the ones SPEC §7 documents, listed in KNOWN below, so a new one
 * cannot hide among them.
 */
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const K = require(path.join(__dirname, '..', '..', 'src', 'k-conditions-evaluator.js'));
require(path.join(__dirname, '..', '..', 'src', 'k-conditions-sql.js'));

const OTHER_EMPTY = ['[ ]', '["",""]', '["", ""]', '[null,""]', '[[]]'];

const FORMS = [null, '', '[]', '["[]"]', '[""]', '[null]', 'null', '"[]"', '""', '"[\\"\\"]"',
  '["3184"]', '["3184","3152"]', '["3184", "3152"]', '["3152"]', 'claude claudesson (claude)',
  '["claude claudesson (claude)"]', '3184', '"3184"', '[3184]', '{"a":"3184"}', '["","3184"]',
  '["O\'Brien"]', '["a\\\\b"]', '["é"]', '["[\\"3184\\"]"]', '"[\\"3184\\"]"', 'true', '"null"',
  '["null"]', '[{"a":"3184"}]', '["0"]', '["0","3184"]',
  // Spellings a case- or space-blind comparison would get wrong.
  'NULL', 'Null', '[NULL]', ' ', 'N/A', 'n/a', 'N/A ', '-', "O'Brien", 'a\\b', 'é', 'É',
  // Empty lists spelled another way, and a nested array: SPEC §7 leaves these to differ.
  ...OTHER_EMPTY, '[["3184"]]'];

const STORED = { name: 'f', column: 'v', type: 'list', storage: 'json' };
const SETS = [
  { label: 'storage json', field: STORED, list: true },
  { label: "countAsBlank 'json'", field: { name: 'f', column: 'v', type: 'text', countAsBlank: 'json' } },
  { label: 'countAsBlank values', field: { name: 'f', column: 'v', type: 'text', countAsBlank: ['N/A', '-', "O'Brien", 'a\\b', 'é', '[ ]'] } },
  { label: 'storage json + countAsBlank', field: Object.assign({}, STORED, { countAsBlank: ['["0"]', '[ ]', '["",""]', 'N/A'] }), list: true }
];

// Disagreements SPEC §7 documents. Anything else fails the run.
const KNOWN = [
  { list: true, forms: OTHER_EMPTY, why: 'an empty list spelled another way: the SQL compares spellings, the evaluators decode' },
  { list: true, forms: ['[["3184"]]'], engine: 'mysql', why: "MySQL's JSON_CONTAINS looks into nested arrays" }
];

const EXISTENCE = [['is_empty'], ['is_not_empty'], ['is_set'], ['is_not_set']];
const LIST = [['includes_any', ['3184']], ['includes_any', ['3184', '3152']], ['includes_all', ['3184', '3152']],
  ['includes_any', ["O'Brien"]], ['includes_any', ['a\\b']], ['includes_any', ['é']], ['includes_any', ['0']],
  ['includes_any', []], ['includes_all', []], ['includes_any', [3184]],
  ['includes_any', ['claude claudesson (claude)']], ['includes_any', ['[]']], ['includes_any', ['null']],
  ['includes_any', 'claude claudesson (claude),3184']];

const doc = (op, v, negate) => ({ version: '1.0', root: { type: 'group', operator: 'and', children: [
  { type: 'condition', field: 'f', operator: op, negate, values: v === undefined ? [] : [{ source: 'literal', value: v }] }] } });

let checks = 0;
const unexpected = [];
const known = {};

// rows: [{ id, value }] as the server returns them; rowsMatching(sql) → Set of ids.
function compare(engine, label, rows, rowsMatching) {
  for (const set of SETS) {
    const fields = [set.field];
    const evaluator = new K.Evaluator({ fields });
    for (const [op, v] of set.list ? EXISTENCE.concat(LIST) : EXISTENCE) {
      for (const negate of [false, true]) {
        const d = doc(op, v, negate);
        const got = rowsMatching(K.toSql(d, { dialect: engine, fields }).sql);
        for (const { id, value } of rows) {
          checks++;
          const want = evaluator.evaluate(d, { f: value });
          if (want === got.has(id)) continue;
          const form = FORMS[id];
          const k = KNOWN.find((x) => !!x.list === !!set.list && x.forms.includes(form) && (!x.engine || x.engine === engine));
          if (k) { (known[k.why] = known[k.why] || new Set()).add(JSON.stringify(form)); continue; }
          unexpected.push(`${label}, ${set.label}: ${negate ? 'NOT ' : ''}${op}${v === undefined ? '' : ' ' + JSON.stringify(v)}` +
            ` on ${JSON.stringify(form)}${value === form ? '' : ' (read back ' + JSON.stringify(value) + ')'} — evaluator ${want}, SQL ${got.has(id)}`);
        }
      }
    }
  }
}

/* SQLite, through node:sqlite. */
let sqlite = null;
try { sqlite = require('node:sqlite'); } catch (e) { /* Node before 22.5 */ }
if (sqlite) {
  for (const collation of ['', ' COLLATE NOCASE']) {
    const db = new sqlite.DatabaseSync(':memory:');
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT${collation})`);
    const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
    FORMS.forEach((f, i) => insert.run(i, f));
    const rows = db.prepare('SELECT id, v FROM t ORDER BY id').all().map((r) => ({ id: r.id, value: r.v }));
    compare('sqlite', `sqlite TEXT${collation}`, rows, (sql) => new Set(db.prepare(`SELECT id FROM t WHERE ${sql}`).all().map((r) => r.id)));
  }
} else {
  console.log('SQLite skipped: node:sqlite needs Node 22.5 or later.');
}

/* MySQL / MariaDB, through the mysql client. */
if (process.env.KCE_MYSQL) {
  const args = process.env.KCE_MYSQL.split(/\s+/).filter(Boolean);
  const my = (sql) => execFileSync('mysql', [...args, '-N', '-B', '-e', sql], { encoding: 'utf8' });
  const q = (s) => (s === null ? 'NULL' : "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'");
  const isJson = (s) => { if (s === null) return true; try { JSON.parse(s); return true; } catch (e) { return false; } };
  let setup = 'DROP TABLE IF EXISTS kce_json_t; DROP TABLE IF EXISTS kce_json_j;' +
    'CREATE TABLE kce_json_t (id INT PRIMARY KEY, v TEXT) CHARACTER SET utf8mb4;' +
    'CREATE TABLE kce_json_j (id INT PRIMARY KEY, v JSON);';
  FORMS.forEach((f, i) => {
    setup += `INSERT INTO kce_json_t VALUES (${i}, ${q(f)});`;
    if (isJson(f)) setup += `INSERT INTO kce_json_j VALUES (${i}, ${q(f)});`;
  });
  my(setup);
  console.log('MySQL: ' + my('SELECT VERSION()').trim() + ', ' + my('SELECT @@collation_connection').trim());
  // What the server hands back, exactly: as hex, so nothing in the client's
  // batch output (escapes, the word NULL) can blur it.
  const readBack = (table) => my(`SELECT id, v IS NULL, HEX(CAST(v AS CHAR)) FROM ${table} ORDER BY id`)
    .split('\n').filter(Boolean).map((line) => {
      const [id, isNull, hex] = line.split('\t');
      return { id: Number(id), value: isNull === '1' ? null : Buffer.from(hex, 'hex').toString('utf8') };
    });
  const textRows = readBack('kce_json_t');
  textRows.forEach((r) => { if (r.value !== FORMS[r.id]) throw new Error('kce_json_t did not keep ' + JSON.stringify(FORMS[r.id])); });
  const rowsOf = (table) => (sql) => new Set(my(`SELECT id FROM ${table} WHERE ${sql}`).split('\n').filter(Boolean).map(Number));
  compare('mysql', 'mysql TEXT', textRows, rowsOf('kce_json_t'));
  compare('mysql', 'mysql JSON', readBack('kce_json_j'), rowsOf('kce_json_j'));

  // Bound parameters, through a prepared statement.
  const bound = [
    { fields: [STORED], d: doc('includes_any', ["O'Brien", 'a\\b'], true) },
    { fields: [SETS[2].field], d: doc('is_not_empty', undefined, false) }
  ];
  for (const { fields, d } of bound) {
    const out = K.toSql(d, { dialect: 'mysql', fields, parameters: true });
    const sets = out.params.map((p, i) => `SET @p${i} = ${q(p)};`).join('');
    const got = new Set(my(`${sets} PREPARE s FROM ${q('SELECT id FROM kce_json_t WHERE ' + out.sql)};` +
      ` EXECUTE s USING ${out.params.map((_, i) => '@p' + i).join(', ')};`).split('\n').filter(Boolean).map(Number));
    const evaluator = new K.Evaluator({ fields });
    textRows.forEach(({ id, value }) => {
      checks++;
      if (evaluator.evaluate(d, { f: value }) !== got.has(id)) unexpected.push('mysql parameters: ' + out.sql + ' on ' + JSON.stringify(value));
    });
  }
  my('DROP TABLE kce_json_t; DROP TABLE kce_json_j;');
} else {
  console.log('MySQL skipped: set KCE_MYSQL to mysql client options and a database to check it.');
}

console.log(`${checks} row checks.`);
Object.keys(known).forEach((why) => console.log(`Known, documented in SPEC §7 — ${why}: ${[...known[why]].join(', ')}`));
if (unexpected.length) {
  console.log(`FAIL ${unexpected.length} rows where the SQL and the evaluator disagree:\n  ` + unexpected.join('\n  '));
  process.exit(1);
}
console.log('The SQL and the evaluator pick the same rows.');
