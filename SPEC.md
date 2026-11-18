# kConditions Document Specification

Version `1.0` — emitted by kConditionsEditor 0.1.7

A **condition document** is a JSON object describing a boolean expression over a
set of named fields. It is produced by the editor and consumed by any SDK.

```json
{
  "version": "1.0",
  "generator": "kConditionsEditor/0.1.7",
  "operators": {},
  "root": {
    "type": "group",
    "operator": "and",
    "negate": false,
    "children": []
  }
}
```

An empty `root.children` array means **no conditions** — the document evaluates
to the evaluator's `emptyResult` option, which defaults to `true` ("Always").

---

## 1. Nodes

### 1.1 Group node

```json
{
  "type": "group",
  "operator": "and",
  "negate": false,
  "children": [ /* group and condition nodes */ ]
}
```

| Key        | Type    | Required | Notes                                      |
|------------|---------|----------|--------------------------------------------|
| `type`     | string  | yes      | `"group"`                                  |
| `operator` | string  | yes      | `"and"` or `"or"`                          |
| `negate`   | boolean | no       | Invert the group's result. Default `false` |
| `children` | array   | yes      | Zero or more nodes                         |
| `id`       | string  | no       | Editor-assigned, ignored by evaluators     |

### 1.2 Condition node

```json
{
  "type": "condition",
  "field": "name",
  "operator": "regex",
  "negate": false,
  "values": [ { "source": "literal", "value": "^ben" } ]
}
```

| Key        | Type    | Required | Notes                                              |
|------------|---------|----------|----------------------------------------------------|
| `type`     | string  | yes      | `"condition"`                                      |
| `field`    | string  | yes      | Field name; dot paths (`user.email`) are supported |
| `operator` | string  | yes      | Builtin name, or a key in the document `operators` |
| `values`   | array   | yes      | Length must match the operator's arity             |
| `negate`   | boolean | no       | Invert this condition                              |
| `policy`   | object  | no       | Per-condition failure policy (§4)                  |
| `id`       | string  | no       | Editor-assigned, ignored by evaluators             |

### 1.3 Value node

```json
{ "source": "literal", "value": "^ben" }
{ "source": "field",   "field": "billing_email" }
```

`source` is `"literal"` or `"field"`. A literal `value` may be any JSON value,
including an array (used by list operators such as `in_list`).

---

## 2. Builtin operators

`arity` is the number of entries required in `values`. Arity `"n"` means a single
value node whose value is an array.

### Equality — group `equality`

| Name  | Label             | Arity |
|-------|-------------------|-------|
| `eq`  | is equal to       | 1     |
| `neq` | is not equal to   | 1     |

### Arithmetic — group `arithmetic`

| Name          | Label                  | Arity |
|---------------|------------------------|-------|
| `lt`          | is less than           | 1     |
| `lte`         | is at most             | 1     |
| `gt`          | is greater than        | 1     |
| `gte`         | is at least            | 1     |
| `between`     | is between             | 2     |
| `not_between` | is not between         | 2     |

Numeric comparison. Non-numeric operands make the condition false.

### Alphanumeric — group `alphanumeric`

| Name            | Label                | Arity | Operand      |
|-----------------|----------------------|-------|--------------|
| `contains`      | contains             | 1     | fragment     |
| `not_contains`  | does not contain     | 1     | fragment     |
| `starts_with`   | starts with          | 1     | fragment     |
| `ends_with`     | ends with            | 1     | fragment     |
| `regex`         | matches regex        | 1     | pattern      |
| `not_regex`     | does not match regex | 1     | pattern      |
| `in_list`       | is one of            | n     | whole values |
| `not_in_list`   | is not one of        | n     | whole values |

The **operand** column is `valueFromChoices` in the operator metadata: `whole
values` (the default, and true of every operator not listed as otherwise) means
the operand is drawn from the field's own value set, so a host may render it from
the field's `choices` and may display it by its label. `fragment` and `pattern`
mean it is not — a substring or a regular expression is not one of the choices,
and rendering `contains "FL"` as `contains "Florida"` misreads the rule. Only
presentation depends on this; evaluation and SQL are unaffected.

String comparison is case-sensitive by default. Append `_i` handling via the
evaluator option `caseInsensitive: true` to compare case-insensitively across all
string operators.

A number compared as text is written as its shortest round-trip digits in plain
decimal notation — `0.0000001`, never `1e-7`; `1000000000000000000000`, never
`1e+21` — so `contains "e"` never matches a number. Whitespace trimmed from a value
before it is read as a number, a boolean, a date or a list is JavaScript's
`String.prototype.trim()` set in every SDK: the ASCII spaces and line breaks plus
every Unicode space separator, U+00A0 (no-break space) and U+FEFF included.

A `regex` value is a plain pattern string without delimiters, e.g. `^ben`.
Patterns are evaluated with the host language's engine; keep to the common subset
(character classes, anchors, quantifiers, groups) for cross-language parity.

### List — group `list`

| Name           | Label           | Arity | Operand      |
|----------------|-----------------|-------|--------------|
| `includes_any` | includes any of | n     | whole values |
| `includes_all` | includes all of | n     | whole values |

For a field whose **value is itself a list** — a multi-select, a set of tags, a
comma-separated string. `in_list` asks whether one value is among several
operands; these ask about the overlap between two lists. `includes_any` is
true when at least one of the field's values is among the operands,
`includes_all` when every operand is among the field's values. A string value
is split on commas, as an operand is. An empty operand list never matches, and
neither does an empty or missing field value — a condition with nothing chosen
is false, not "always". Case folding follows the evaluator's `caseInsensitive`
option.

A host exposes such a field as `type: 'list'`, which offers the `list` and
`existence` groups by default. A multi-valued column has no portable storage
shape (a CSV string, a JSON array, a junction table), so the SQL builders
translate these two operators only when the field says which shape it is —
`storage: 'json'`, §7 — or through a custom operator with an `sql` template
that knows the host's schema; otherwise the unresolved-operator policy applies.

### Date — group `date`

| Name                      | Label                              | Arity | Value        |
|---------------------------|------------------------------------|-------|--------------|
| `date_eq`                 | is on                              | 1     | date         |
| `date_before`             | is before                          | 1     | date         |
| `date_after`              | is after                           | 1     | date         |
| `date_between`            | is between                         | 2     | date, date   |
| `date_is_today`           | is today                           | 0     | —            |
| `date_within_last_days`   | is within the last {value} days    | 1     | number       |
| `date_within_next_days`   | is within the next {value} days    | 1     | number       |
| `date_more_than_days_ago` | is more than {value} days ago      | 1     | number       |
| `date_more_than_days_ahead` | is more than {value} days from now | 1   | number       |

`{value}` in a label marks where the operand reads: `describe()` gives
`[Arrival] is within the last 7 days`, and the editor puts the value box there. Any
operator label may carry one (a custom operator's, or a translation passed in
`labels.operators`); the spacing round it is kept as written. A label without one
has its operand after it. Labels are presentation only: nothing in a document
refers to them.

Accepted date literals: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, a date and time with no
zone (`YYYY-MM-DD HH:MM[:SS[.mmm]]`, a space or a `T` between them), full ISO 8601
timestamps, epoch milliseconds, and native date objects. A partial date expands
to its earliest instant in UTC, so `is before 1980` means before
`1980-01-01T00:00:00Z`, and a date and time with no zone is read as that wall time
in UTC — never in the reader's own zone, which would make two SDKs on two machines
disagree. A year is taken as written: `0026-10-19` is the year 26, not 1926 or
2026. `date_eq` and `date_is_today` compare calendar days in UTC; all other date
operators compare instants.

A host whose users think in their own zone passes `now` as that zone's wall time
read as UTC (the instant plus the zone's offset) and hands dates over as naive
wall times; every UTC-day comparison is then a comparison of the user's days.

### Boolean — group `boolean`

| Name       | Label       | Arity |
|------------|-------------|-------|
| `is_true`  | is true     | 0     |
| `is_false` | is false    | 0     |

Truthiness follows the document rule: `true`, `1`, `"1"`, `"true"`, `"yes"`,
`"on"` are true; `false`, `0`, `"0"`, `"false"`, `"no"`, `"off"`, `""`, `null`
are false. Anything else is neither, and both operators return false.

### Existence — group `existence`

| Name           | Label            | Arity |
|----------------|------------------|-------|
| `is_set`       | is set           | 0     |
| `is_not_set`   | is not set       | 0     |
| `is_empty`     | is empty         | 0     |
| `is_not_empty` | is not empty     | 0     |

`is_set` is false only when the field is absent or `null`. `is_empty` is also
true for `""`, `[]` and `{}`. A field definition can widen what counts as empty —
`storage: 'json'` (§7.1) or `countAsBlank` (§7.2) — and on such a field `is_set` /
`is_not_set` mean `is_not_empty` / `is_empty`.

---

### Validation

`validateDocument()` (both SDKs) returns a list of problems, empty when the document
is valid. Each is `{ path, code, params, message }`: `message` is the English, and
`code` and `params` are what it was built from, so a host can say it in another
language. The editor's `labels.problems` takes the same keys and placeholders.

| `code`            | `params`                       | English                                                |
|-------------------|--------------------------------|--------------------------------------------------------|
| `notObject`       | —                              | Node is not an object                                  |
| `groupOperator`   | —                              | Group operator must be "and" or "or"                   |
| `groupChildren`   | —                              | Group children must be an array                        |
| `nodeType`        | `type`                         | Unknown node type "{type}"                             |
| `noField`         | —                              | Condition has no field                                 |
| `unknownField`    | `field`                        | Unknown field "{field}" (a condition's, or a value's)  |
| `unknownOperator` | `operator`                     | Unknown operator "{operator}"                          |
| `listArity`       | `operator`                     | Operator "{operator}" expects a single list value      |
| `arity`           | `operator`, `expected`, `actual` | Operator "{operator}" expects {expected} value(s), got {actual} |
| `valueNotObject`  | —                              | Value must be an object                                |
| `valueNoField`    | —                              | Field value has no field name                          |
| `valueSource`     | —                              | Value source must be "literal" or "field"              |

The shared fixtures (`validateCases`) hold both SDKs to the same problems, in the
same order, with the same path, code, params and message.

## 3. Custom operators

Custom operators are declared in the document's top-level `operators` map so the
document stays self-contained and portable. Three kinds:

### 3.1 `values` — a fixed value set defined at initialisation

```json
"operators": {
  "is_gulf_state": {
    "kind": "values",
    "label": "is a Gulf state",
    "match": "in",
    "values": ["Florida", "Louisiana", "Texas", "Mississippi"],
    "arity": 0
  }
}
```

`match` is `"in"` or `"not_in"`. With `arity: 0` the list is fixed and the editor
shows no value input. With `arity: 1` the list becomes the set of *choices*
offered in the editor and the chosen value is stored on the condition.

`values` — and a field's `choices` — may be written three ways. All three mean
the same thing; the first is what gets stored in the condition, the second is
what the user sees:

```json
["Florida", "Texas"]
[{ "value": "FL", "label": "Florida" }, { "value": "TX", "label": "Texas" }]
{ "FL": "Florida", "TX": "Texas" }
```

### 3.2 `callback` — dispatch to a host function

```json
"operators": {
  "email_is_unique": {
    "kind": "callback",
    "label": "is not already registered",
    "arity": 0,
    "callbacks": {
      "js":     { "function": "emailIsUnique" },
      "php":    { "class": "\\App\\Rules\\Email", "method": "isUnique", "static": true },
      "python": { "module": "app.rules", "function": "email_is_unique" }
    },
    "policy": {
      "unresolved": { "client": "skip", "server": "error", "*": "error" },
      "error":      { "client": "skip", "*": "error" }
    }
  }
}
```

The callback receives `(fieldValue, args, context)` where `args` is the array of
resolved values and `context` carries `{ field, operator, data, document, now,
runtime, environment }`.

**Security.** Resolving a function name out of a JSON document is arbitrary
dispatch. Every SDK therefore looks in its own **registry first**, and will only
fall back to the names in `callbacks` when you explicitly opt in with
`allowManifestCallbacks: true`, optionally narrowed by `callbackAllowList`.
Registering callables yourself is the recommended route:

```js
evaluator.registerOperator('email_is_unique', (value, args, ctx) => { /* … */ });
```

```php
$evaluator->registerOperator('email_is_unique', fn ($value, $args, $ctx) => /* … */);
```

### 3.3 `sql` — a SQL template

Any custom operator may carry a `sql` template, used when the document is
rendered as SQL. `{field}` is the quoted column, `{0}`/`{1}` the rendered
values, `{values}` the comma-separated list:

```json
{ "kind": "callback", "sql": "NOT EXISTS (SELECT 1 FROM blocked b WHERE b.email = {field})" }
```

The template is trusted configuration from your own operator definitions, not
user input. A callback operator without one has no SQL translation, and falls to
the `unresolved` policy.

### 3.4 `availableIn` — declaring where an operator can run

```json
{ "kind": "callback", "availableIn": ["server"], "...": "..." }
```

If the evaluator's context labels do not intersect `availableIn`, the operator is
treated as **unresolved** without any lookup being attempted, and the unresolved
policy applies. This is the declarative way to say "server only".

---

## 4. Failure policies

Two things can go wrong with a condition: the operator cannot be **resolved** in
this runtime, or evaluating it **throws**. Each is governed by a policy that
resolves to one of:

| Policy   | Meaning                                                                    |
|----------|----------------------------------------------------------------------------|
| `skip`   | The condition behaves as if it were not in the document at all (§4.2)      |
| `true`   | The condition evaluates to `true`                                           |
| `false`  | The condition evaluates to `false`                                          |
| `error`  | Evaluation aborts and the SDK raises an error                               |

### 4.1 Where a policy comes from

Checked in order, first hit wins:

1. `condition.policy.unresolved` / `condition.policy.error`
2. `operators[name].policy.unresolved` / `.error`
3. The evaluator's `unresolvedPolicy` / `errorPolicy` init option
   (both default to `"error"`)

A policy value may be a bare string (`"skip"`) or a map keyed by **context
label**:

```json
{ "client": "skip", "server": "error", "js": "skip", "*": "error" }
```

Context labels are matched in this order, first hit wins:

1. each entry of the evaluator's `profiles` array, in order
2. the evaluator's `environment` (e.g. `client`, `server`, `worker`)
3. the evaluator's `runtime` (`js`, `php`, `python`, …)
4. `"*"` or `"default"`

So a rule can be keyed by deployment tier, by language, or by any custom label
you invent — the JS SDK running under Node with `environment: 'server'` picks the
`server` branch, and the same file loaded in a browser with
`environment: 'client'` picks the `client` branch.

### 4.2 Skip semantics

A skipped condition is removed from its parent's children. The remaining
siblings decide the group. If **every** child of a group is skipped, that group
is itself skipped and drops out of *its* parent, and so on. If the whole document
ends up skipped, the evaluator returns its `emptyResult` option (default `true`).

This holds for `and` and `or` alike — a skipped condition can never turn an `or`
true on its own.

Skipped nodes are reported in the detailed result so a server-side pass can see
what a client-side pass deferred.

---

## 5. Detailed results

```jsonc
{
  "result": true,          // the boolean
  "skipped": [             // conditions dropped by a skip policy
    { "path": "root.children[1]", "field": "email",
      "operator": "email_is_unique", "reason": "unresolved" }
  ],
  "errors": [],            // non-fatal errors captured under a non-error policy
  "trace": { /* per-node results, only when trace: true */ }
}
```

---

## 6. Result hook

Every SDK entry point accepts an optional trailing callable. When supplied, the
SDK returns **that callable's return value** instead of the boolean. It receives
the original call's arguments, then the computed result, then the details object:

```js
evaluate(document, data, options, (document, data, options, result, details) => {
  log(details.skipped);
  return { ok: result, deferred: details.skipped };
});
```

```php
evaluate($document, $data, $options, function ($document, $data, $options, $result, $details) {
    return new RuleOutcome($result, $details['skipped']);
});
```

---

## 7. Field definitions

A host describes its fields once, as a list of definitions, and hands the same
list to the editor (`fields`), the evaluators (`fields`), the SQL builders
(`fields`), `describe()` (`fields`) and `validateDocument()` (`fields`). Field
definitions are host configuration, not part of the document: nothing from them
is copied into it, so a document stays the same rule whichever schema it is run
against. Each SDK reads only the keys it needs:

| Key       | Read by                     | Meaning                                                        |
|-----------|-----------------------------|----------------------------------------------------------------|
| `name`    | all                         | The key a condition's `field` names; dot paths supported       |
| `label`   | `describe()`, the editor    | Shown for the field; defaults to `name`                        |
| `choices` | `describe()`, the editor    | The field's value set (§3.1's three forms); labels values      |
| `type`    | the editor, the SQL builders | `text`, `number`, `date`, `boolean`, `enum`, `list`           |
| `column`  | the SQL builders            | The SQL column; defaults to `name`                             |
| `storage` | the evaluators, the SQL builders, the editor | How the value is stored (§7.1)                 |
| `countAsBlank` | the evaluators, the SQL builders, the editor | Stored values that count as empty (§7.2)  |

A field with no definition behaves as it always has. So does a field whose
definition has no `storage` or `countAsBlank`, or a value of either that an SDK
does not know.

### 7.1 `storage: 'json'` — a list stored as a JSON array

The field's value is a list kept as JSON array text — `["3184","3152"]`, and `[]`
for none — the shape a multi-select usually takes in a text column. The value is
compared case-insensitively (`'JSON'` works). It describes the column, so it
belongs next to `column`, and is meant for `type: 'list'` fields; a definition with
`storage: 'json'` and no `type` is a list.

**Reading the value.** A value may arrive as the stored text or already decoded
(an array). It is read as follows, in every SDK:

1. `null`, absent, or `""` — **empty**.
2. Text is decoded as JSON. Text that is not JSON at all is **something that names
   nothing**: not empty, and it includes no value.
3. The decoded value:
   - `null` or `""` — **empty**;
   - an array — a list of its elements;
   - a string — a list of that one string, unless the string is itself an empty
     list saved a second time (`"[]"`, `"[\"\"]"`), which is **empty**;
   - anything else (a number, a boolean, an object) — not empty, includes no value.
4. An element is **empty** when it is `null`, `""`, or a string or array that is
   itself an empty list (the `"[]"` of `["[]"]`). A list whose elements are all
   empty is empty. Of the rest, the **string** elements are the list's values;
   a number element (`3184`) is not the value `"3184"`.

A value saved twice is decoded the second time only to see whether it is empty;
its contents are not read from it. No SQL dialect can decode twice, and a rule must
pick the same rows in SQL as in an evaluator — for the same reason, text that is
not JSON includes nothing, which is what the SQL says about it.

**The operators.** With the value read that way:

| Operator                     | True when                                              |
|------------------------------|--------------------------------------------------------|
| `is_empty`, `is_not_set`     | the value is empty                                     |
| `is_not_empty`, `is_set`     | the value is not empty                                 |
| `includes_any`               | at least one operand is among the list's values        |
| `includes_all`               | every operand is among the list's values               |

`is_set` and `is_not_set` mean `is_not_empty` and `is_empty` here: a list column
clears to `[]` on one save path and to `NULL` on another, so "set but empty" is
nothing a person could ask about, and "is not set" must not miss the `[]` rows.
The editor offers only the `is_empty` / `is_not_empty` pair for such a field
unless the field's `operators` lists the others.

Operands are compared with the values as strings (`3184` matches `"3184"`), folded
by the evaluator's `caseInsensitive` option. An operand that is itself empty (`""`,
`"[]"`) is dropped, and with none left the condition is false — nothing chosen
never matches, as in §2. Any other operator, a registered callback or a custom
operator is handed the decoded value, as it would be handed an array passed in
directly.

**SQL.** The column is text, so the SQL builders list the spellings of empty and
keep the JSON functions off text that is not JSON (they raise an error on it, `""`
included, which fails the whole query). Every expression is 0 or 1, never `NULL`,
so a `NOT` in front of it never drops a row. MySQL / MariaDB:

| Operator                 | SQL                                                                                                   |
|--------------------------|-------------------------------------------------------------------------------------------------------|
| `is_empty`, `is_not_set` | `(col IS NULL OR <text> IN (<empty forms>))`                                                          |
| `is_not_empty`, `is_set` | `(col IS NOT NULL AND <text> NOT IN (<empty forms>))`                                                 |
| `includes_any` A, B      | `CASE WHEN JSON_VALID(col) THEN JSON_CONTAINS(col, '"A"') OR JSON_CONTAINS(col, '"B"') ELSE 0 END`    |
| `includes_all` A, B      | the same, joined with `AND`                                                                           |

`<empty forms>` is `'', '[]', '["[]"]', '[""]', '[null]', 'null', '"[]"', '""',
'"[\"\"]"'`, escaped for the dialect. Each operand is JSON-encoded as a string and
then quoted as SQL (`'"O''Brien"'`), or bound as a parameter. SQLite uses the same
shape with `json_valid(col)` and, for each operand, `EXISTS (SELECT 1 FROM
json_each(col) WHERE json_each.type = 'text' AND typeof(json_each.key) <> 'text' AND
json_each.value = 'A')`. Other dialects have no tested translation, and any other
operator on such a field (`eq`, `contains` against JSON text) has no faithful one;
both fall to the unsupported-operator policy. A custom operator with an `sql`
template is used as written.

`<text>` is the column's stored text, compared **exactly** — byte for byte, not
through the column's collation — because the evaluators compare exactly:

| Dialect          | `<text>`                               |
|------------------|----------------------------------------|
| MySQL / MariaDB  | `CAST(CAST(col AS CHAR) AS BINARY)`    |
| SQLite           | `CAST(col AS TEXT) COLLATE BINARY`     |

MySQL's default collation is case- and accent-insensitive, and a `PAD SPACE`
collation (`utf8mb4_bin`, MariaDB's defaults) ignores trailing spaces, so through a
plain cast `NULL` was a spelling of `null` and `' '` of `''` — empty to the SQL, not
to the evaluators. SQLite compares a cast of a column with the column's collation
(`NOCASE`, say) unless told otherwise. The inner cast reads a native `JSON` column
too — none of the forms has a comma, so the server's own normalised text of one is
the same characters — and brings a column in another character set into the
connection's, which the literals are in. (Until 0.1.7 `<text>` was the plain cast.)

Where the SQL and the evaluators can differ: an empty list spelled any other way —
whitespace inside the brackets (`[ ]`), more than one empty element (`["", ""]`,
`[null, ""]`), an empty list inside a list (`[[]]`) — is empty to the evaluators and
not to the SQL, which compares spellings; and MySQL's `JSON_CONTAINS` looks inside
nested arrays (`[["3184"]]`), which the evaluators and SQLite do not. No save path
is known to write any of them; a host whose data holds one can list it in
`countAsBlank` (§7.2), which the SQL then lists too.

### 7.2 `countAsBlank` — stored values that count as empty

`null`, an absent value and `""` are always empty. `countAsBlank` names stored values
that count as empty **as well**, for a field whose column holds a placeholder for
"nothing" — `[]` in a names column, `N/A` in a phone column — while the field is
offered and compared as what it is (usually `text`). It takes one of two shapes:

- **A preset name** — a string, compared case-insensitively. `'json'` is the
  spellings of empty §7.1 lists: `[]`, `null`, `[""]`, `["[]"]`, `[null]`, `"[]"`,
  `""`, `"[\"\"]"`. It is the same list in every SDK, read from the same place as
  §7.1's. More presets may follow; a name an SDK does not know is ignored, as an
  unknown `storage` is.
- **An array of strings** — each an exact stored value: `['N/A', '-']`. Elements that
  are not strings are ignored, and an array with none left is no option at all. A
  string in the array is always a value, never a preset: `['json']` makes the text
  `json` empty, and nothing else.

```json
{ "name": "Assigned To", "type": "text", "countAsBlank": "json" }
{ "name": "Phone", "type": "text", "countAsBlank": ["N/A", "-"] }
```

**Reading the value.** A value is empty when it was empty before (`null`, absent,
`""`, `[]`, `{}`) or when its text is one of the field's values. The comparison is
**exact**: case counts, nothing is trimmed, and the evaluators' `caseInsensitive`
option does not apply — the SQL compares bytes, and a rule must pick the same rows in
SQL as in an evaluator. Under `'json'` a value is compared by its spelling, as the
SQL compares it: `[ ]` and `["",""]` are not empty (list them in an array if your
data holds them). A value that arrives already decoded has no spelling, so it is
compared by its text — a number by its digits, an array or object by its compact JSON
(`["x"]`) — and under `'json'` an array whose elements are all empty (§7.1, rule 4)
is empty too.

**The operators.**

| Operator                     | True when                                              |
|------------------------------|--------------------------------------------------------|
| `is_empty`, `is_not_set`     | the value is empty                                     |
| `is_not_empty`, `is_set`     | the value is not empty                                 |
| any other                    | as without the option: the stored value, unchanged     |

`is_set` and `is_not_set` mean `is_not_empty` and `is_empty`, for §7.1's reason: a
column that clears to `[]` on one save path and to `NULL` on another makes "set but
empty" nothing a person could ask about, and "is not set" must not keep the `[]`
rows. The editor offers only the `is_empty` / `is_not_empty` pair unless the field's
`operators` lists the others; a rule that already uses one keeps it. Every other
operator — `eq`, `contains`, `starts_with`, a registered callback, a custom operator
— reads the stored value exactly as it would without the option, and nothing is
refused. `describe()` reads as before ("Assigned To is not empty"), and the editor's
value controls do not change.

**SQL.** The SQL builders list the field's empty values, with `''` always first.
MySQL / MariaDB and SQLite, with `<text>` as in §7.1:

| Operator                 | SQL                                                          |
|--------------------------|--------------------------------------------------------------|
| `is_empty`, `is_not_set` | `(col IS NULL OR <text> IN ('', <values>))`                  |
| `is_not_empty`, `is_set` | `(col IS NOT NULL AND <text> NOT IN ('', <values>))`         |

`'json'`'s values are written into the SQL, as §7.1's are; an array's values are
the host's own, so they are escaped like any other literal, or bound with
`parameters`. Neither expression can be `NULL`, so a `NOT` in front of it keeps every
row it should. The exact `<text>` matters most here: under MySQL's default collation
a plain cast would make `n/a` empty for `['N/A']`, and `É` for `['é']`. It reads a
native `JSON` column too, by the server's own spelling (`[]`, `["a", "b"]` with a
space after each comma). Other dialects have no tested exact comparison, and fall to
the unsupported-operator policy for these four operators; every other operator is
translated as usual.

**With `storage: 'json'`.** The two combine, and `countAsBlank` adds to §7.1's rule:

- `'json'` adds nothing — §7.1 already reads every one of its spellings as empty.
- An array adds stored values that are empty **as well**, whatever they decode to:
  `["0"]`, say, or one of the other spellings of an empty list above (`[ ]`). Such a
  value holds nothing, so `includes_any` / `includes_all` find nothing in it: the SQL
  adds `AND <text> NOT IN (<values>)` to the `JSON_VALID` guard, and the existence
  operators list the values after §7.1's forms. Every other operator is still
  refused (§7.1).
