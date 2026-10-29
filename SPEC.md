# kConditions Document Specification

Version `1.0` — emitted by kConditionsEditor 0.1.4

A **condition document** is a JSON object describing a boolean expression over a
set of named fields. It is produced by the editor and consumed by any SDK.

```json
{
  "version": "1.0",
  "generator": "kConditionsEditor/0.1.4",
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
`existence` groups by default. The SQL builders emit nothing for these two
operators: a multi-valued column has no portable storage shape (a CSV string, a
JSON array, a junction table), so they are translated only through a custom
operator with an `sql` template that knows the host's schema; otherwise the
unresolved-operator policy applies.

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
true for `""`, `[]` and `{}`.

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
