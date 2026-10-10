# kConditions Document Specification

Version `1.0` — emitted by kConditionsEditor 0.0.34

A **condition document** is a JSON object describing a boolean expression over a
set of named fields. It is produced by the editor and consumed by any SDK.

```json
{
  "version": "1.0",
  "generator": "kConditionsEditor/0.0.34",
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

A `regex` value is a plain pattern string without delimiters, e.g. `^ben`.
Patterns are evaluated with the host language's engine; keep to the common subset
(character classes, anchors, quantifiers, groups) for cross-language parity.

### Date — group `date`

| Name                      | Label                              | Arity | Value        |
|---------------------------|------------------------------------|-------|--------------|
| `date_eq`                 | is on                              | 1     | date         |
| `date_before`             | is before                          | 1     | date         |
| `date_after`              | is after                           | 1     | date         |
| `date_between`            | is between                         | 2     | date, date   |
| `date_is_today`           | is today                           | 0     | —            |
| `date_within_last_days`   | is within the last N days          | 1     | number       |
| `date_within_next_days`   | is within the next N days          | 1     | number       |
| `date_more_than_days_ago` | is more than N days ago            | 1     | number       |
| `date_more_than_days_ahead` | is more than N days from now     | 1     | number       |

Accepted date literals: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, full ISO 8601
timestamps, epoch milliseconds, and native date objects. A partial date expands
to its earliest instant in UTC, so `is before 1980` means before
`1980-01-01T00:00:00Z`. `date_eq` and `date_is_today` compare calendar days in
UTC; all other date operators compare instants.

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
