/*!
 * kConditions Evaluator 0.1.2
 * Evaluates kConditions documents (spec version 1.0) in browsers and Node.
 * MIT Licence. https://github.com/KAStrack/kConditionsEditor
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KConditions = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPEC_VERSION = '1.0';
  var LIB_VERSION = '0.1.2';

  /* ------------------------------------------------------------------ *
   * Errors
   * ------------------------------------------------------------------ */

  function ConditionError(message, details) {
    var err = Error.call(this, message);
    this.name = 'ConditionError';
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) Error.captureStackTrace(this, ConditionError);
    else this.stack = err.stack;
  }
  ConditionError.prototype = Object.create(Error.prototype);
  ConditionError.prototype.constructor = ConditionError;

  function UnresolvedOperatorError(message, details) {
    ConditionError.call(this, message, details);
    this.name = 'UnresolvedOperatorError';
  }
  UnresolvedOperatorError.prototype = Object.create(ConditionError.prototype);
  UnresolvedOperatorError.prototype.constructor = UnresolvedOperatorError;

  /* ------------------------------------------------------------------ *
   * The SKIP sentinel
   *
   * A node that resolves to SKIP behaves as though it were never in the
   * document: it is dropped from its parent's children. A group whose
   * children all resolve to SKIP is itself SKIP, and so on upward. A
   * document that resolves entirely to SKIP yields options.emptyResult.
   * ------------------------------------------------------------------ */

  var SKIP = { kConditionsSkip: true };

  /* ------------------------------------------------------------------ *
   * Value helpers
   * ------------------------------------------------------------------ */

  var MISSING = { kConditionsMissing: true };

  function getPath(data, path) {
    if (data === null || data === undefined) return MISSING;
    if (Object.prototype.hasOwnProperty.call(Object(data), path)) return data[path];
    if (path.indexOf('.') === -1) return MISSING;
    var parts = path.split('.');
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return MISSING;
      if (typeof cur !== 'object') return MISSING;
      if (!Object.prototype.hasOwnProperty.call(cur, parts[i])) return MISSING;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function isMissing(v) { return v === MISSING; }

  function isNullish(v) { return v === null || v === undefined || v === MISSING; }

  function isEmptyValue(v) {
    if (isNullish(v)) return true;
    if (typeof v === 'string') return v.length === 0;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object' && !(v instanceof Date)) return Object.keys(v).length === 0;
    return false;
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      var t = v.trim();
      if (t === '') return null;
      var n = Number(t);
      return isFinite(n) ? n : null;
    }
    if (v instanceof Date) return v.getTime();
    return null;
  }

  var TRUE_WORDS = ['1', 'true', 'yes', 'on', 't', 'y'];
  var FALSE_WORDS = ['0', 'false', 'no', 'off', 'f', 'n', ''];

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1 ? true : (v === 0 ? false : null);
    if (v === null || v === undefined || v === MISSING) return false;
    if (typeof v === 'string') {
      var t = v.trim().toLowerCase();
      if (TRUE_WORDS.indexOf(t) !== -1) return true;
      if (FALSE_WORDS.indexOf(t) !== -1) return false;
      return null;
    }
    return null;
  }

  var DAY_MS = 86400000;

  // Epoch milliseconds of a UTC wall time, the year taken as written: Date.UTC() reads 0-99 as 1900-1999, and PHP's
  // gmmktime() reads them differently again, so both SDKs build the instant field by field.
  function utcMs(y, mo, d, h, mi, s, ms) {
    var t = new Date(0);
    t.setUTCFullYear(y, mo, d);
    t.setUTCHours(h || 0, mi || 0, s || 0, ms || 0);
    return t.getTime();
  }

  function toDate(v) {
    if (v instanceof Date) { var t0 = v.getTime(); return isNaN(t0) ? null : t0; }
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      // A bare four-digit number is read as a calendar year, matching the
      // "is before 1980" idiom. Anything else is epoch milliseconds.
      if (v >= 1000 && v <= 9999 && v % 1 === 0) return Date.UTC(v, 0, 1);
      return v;
    }
    if (typeof v !== 'string') return null;
    var s = v.trim();
    if (s === '') return null;
    var m;
    if ((m = /^(\d{4})$/.exec(s))) return utcMs(+m[1], 0, 1);
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return utcMs(+m[1], +m[2] - 1, 1);
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return utcMs(+m[1], +m[2] - 1, +m[3]);
    // A date and time with no zone is a UTC wall time, as a bare date is — never the reader's local time, which made
    // the browser and the server disagree (Date.parse() reads "2026-10-19T22:00" in the machine's zone).
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/.exec(s))) {
      return utcMs(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? +((m[7] + '00').slice(0, 3)) : 0);
    }
    if (/^-?\d+$/.test(s)) return toDate(Number(s));
    var parsed = Date.parse(s);
    return isNaN(parsed) ? null : parsed;
  }

  function startOfUtcDay(ts) {
    var d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  // A number as text, the same in both SDKs: its shortest round-trip digits written out in full — never an exponent
  // ("1e-7", "1e+21"), which a "contains" would otherwise read.
  function numberToString(n) {
    if (!isFinite(n)) return String(n);
    var s = String(n);
    var m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    if (!m) return s;
    var digits = m[2] + (m[3] || ''), point = m[2].length + parseInt(m[4], 10), out;
    if (point <= 0) out = '0.' + new Array(1 - point).join('0') + digits;
    else if (point >= digits.length) out = digits + new Array(point - digits.length + 1).join('0');
    else out = digits.slice(0, point) + '.' + digits.slice(point);
    return m[1] + out;
  }

  function asString(v) {
    if (isNullish(v)) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return numberToString(v);
    if (typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toISOString();
    return JSON.stringify(v);
  }

  function fold(s, ctx) {
    return ctx && ctx.caseInsensitive ? s.toLowerCase() : s;
  }

  function looseEquals(a, b, ctx) {
    if (isNullish(a) && isNullish(b)) return true;
    if (isNullish(a) || isNullish(b)) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      var ba = toBool(a), bb = toBool(b);
      if (ba !== null && bb !== null) return ba === bb;
    }
    var na = toNumber(a), nb = toNumber(b);
    if (na !== null && nb !== null && !(typeof a === 'string' && a.trim() === '') &&
        !(typeof b === 'string' && b.trim() === '')) {
      return na === nb;
    }
    return fold(asString(a), ctx) === fold(asString(b), ctx);
  }

  /**
   * Normalise a choice list into [{value, label}].
   *
   * Accepts an array of scalars, an array of {value, label} objects, or an
   * associative object mapping value to label — so a config generated from PHP
   * can pass ['FL' => 'Florida'] straight through as JSON.
   */
  function normaliseChoices(input) {
    if (!input) return [];
    var out = [];
    if (Array.isArray(input)) {
      input.forEach(function (c) {
        if (c && typeof c === 'object' && !Array.isArray(c)) {
          if (c.value === undefined) return;
          out.push({ value: c.value, label: c.label === undefined || c.label === null ? asString(c.value) : String(c.label) });
        } else {
          out.push({ value: c, label: asString(c) });
        }
      });
      return out;
    }
    if (typeof input === 'object') {
      Object.keys(input).forEach(function (k) {
        out.push({ value: k, label: input[k] === undefined || input[k] === null ? k : String(input[k]) });
      });
    }
    return out;
  }

  /** The bare values of a choice list, for comparison. */
  function choiceValues(input) {
    return normaliseChoices(input).map(function (c) { return c.value; });
  }

  function toList(v) {
    if (Array.isArray(v)) return v;
    if (isNullish(v)) return [];
    if (typeof v === 'string') {
      var t = v.trim();
      if (t === '') return [];
      return t.split(',').map(function (s) { return s.trim(); });
    }
    return [v];
  }

  function inList(value, list, ctx) {
    for (var i = 0; i < list.length; i++) {
      if (looseEquals(value, list[i], ctx)) return true;
    }
    return false;
  }

  function buildRegex(pattern, ctx) {
    return new RegExp(pattern, ctx && ctx.caseInsensitive ? 'i' : '');
  }

  function numericCompare(a, b, cmp) {
    var na = toNumber(a), nb = toNumber(b);
    if (na === null || nb === null) return false;
    return cmp(na, nb);
  }

  function dateCompare(a, b, cmp) {
    var da = toDate(a), db = toDate(b);
    if (da === null || db === null) return false;
    return cmp(da, db);
  }

  /* ------------------------------------------------------------------ *
   * Builtin operators
   * ------------------------------------------------------------------ */

  // `valueFromChoices` says whether the operand is drawn from the field's own
  // value set. It is true for operators that compare against a *whole* value
  // (`eq`, `in_list`) and false for the ones whose operand is a fragment or a
  // pattern (`contains`, `starts_with`, `regex`). On an enum field the
  // difference decides two things: whether the editor offers the choice list or
  // a free text box, and whether describe() may swap a stored value for its
  // label. Rendering `contains "FL"` as `contains "Florida"` is a lie — "FL" is
  // a substring being looked for, not the value Florida.
  function op(group, label, arity, valueKind, fn, extra) {
    var o = {
      group: group, label: label, arity: arity,
      valueKind: valueKind, kind: 'builtin', fn: fn,
      allowFieldValue: valueKind !== 'none' && valueKind !== 'list',
      valueFromChoices: true
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }

  var BUILTIN_OPERATORS = {
    /* equality */
    eq: op('equality', 'is equal to', 1, 'text', function (v, a, c) { return looseEquals(v, a[0], c); }),
    neq: op('equality', 'is not equal to', 1, 'text', function (v, a, c) { return !looseEquals(v, a[0], c); }),

    /* arithmetic */
    lt: op('arithmetic', 'is less than', 1, 'number', function (v, a) { return numericCompare(v, a[0], function (x, y) { return x < y; }); }),
    lte: op('arithmetic', 'is at most', 1, 'number', function (v, a) { return numericCompare(v, a[0], function (x, y) { return x <= y; }); }),
    gt: op('arithmetic', 'is greater than', 1, 'number', function (v, a) { return numericCompare(v, a[0], function (x, y) { return x > y; }); }),
    gte: op('arithmetic', 'is at least', 1, 'number', function (v, a) { return numericCompare(v, a[0], function (x, y) { return x >= y; }); }),
    between: op('arithmetic', 'is between', 2, 'number', function (v, a) {
      var n = toNumber(v), lo = toNumber(a[0]), hi = toNumber(a[1]);
      if (n === null || lo === null || hi === null) return false;
      if (lo > hi) { var s = lo; lo = hi; hi = s; }
      return n >= lo && n <= hi;
    }),
    not_between: op('arithmetic', 'is not between', 2, 'number', function (v, a) {
      var n = toNumber(v), lo = toNumber(a[0]), hi = toNumber(a[1]);
      if (n === null || lo === null || hi === null) return false;
      if (lo > hi) { var s = lo; lo = hi; hi = s; }
      return n < lo || n > hi;
    }),

    /* alphanumeric */
    contains: op('alphanumeric', 'contains', 1, 'text', function (v, a, c) {
      return fold(asString(v), c).indexOf(fold(asString(a[0]), c)) !== -1;
    }, { valueFromChoices: false }),
    not_contains: op('alphanumeric', 'does not contain', 1, 'text', function (v, a, c) {
      return fold(asString(v), c).indexOf(fold(asString(a[0]), c)) === -1;
    }, { valueFromChoices: false }),
    starts_with: op('alphanumeric', 'starts with', 1, 'text', function (v, a, c) {
      return fold(asString(v), c).indexOf(fold(asString(a[0]), c)) === 0;
    }, { valueFromChoices: false }),
    ends_with: op('alphanumeric', 'ends with', 1, 'text', function (v, a, c) {
      var s = fold(asString(v), c), n = fold(asString(a[0]), c);
      return n.length <= s.length && s.lastIndexOf(n) === s.length - n.length;
    }, { valueFromChoices: false }),
    regex: op('alphanumeric', 'matches regex', 1, 'text', function (v, a, c) {
      return buildRegex(asString(a[0]), c).test(asString(v));
    }, { allowFieldValue: false, valueFromChoices: false }),
    not_regex: op('alphanumeric', 'does not match regex', 1, 'text', function (v, a, c) {
      return !buildRegex(asString(a[0]), c).test(asString(v));
    }, { allowFieldValue: false, valueFromChoices: false }),
    in_list: op('alphanumeric', 'is one of', 'n', 'list', function (v, a, c) {
      return inList(v, toList(a[0]), c);
    }),
    not_in_list: op('alphanumeric', 'is not one of', 'n', 'list', function (v, a, c) {
      return !inList(v, toList(a[0]), c);
    }),

    /* list — the field's own value is a list (a multi-select, tags, a CSV
       string). `in_list` asks whether ONE value is among the operands; these
       ask about the overlap between two lists. An empty operand never matches,
       and neither does an empty or missing field value, so a condition with
       nothing chosen reads as false rather than as "always". */
    includes_any: op('list', 'includes any of', 'n', 'list', function (v, a, c) {
      var have = toList(v), want = toList(a[0]);
      if (!have.length || !want.length) return false;
      for (var i = 0; i < have.length; i++) if (inList(have[i], want, c)) return true;
      return false;
    }),
    includes_all: op('list', 'includes all of', 'n', 'list', function (v, a, c) {
      var have = toList(v), want = toList(a[0]);
      if (!have.length || !want.length) return false;
      for (var j = 0; j < want.length; j++) if (!inList(want[j], have, c)) return false;
      return true;
    }),

    /* date */
    date_eq: op('date', 'is on', 1, 'date', function (v, a) {
      return dateCompare(v, a[0], function (x, y) { return startOfUtcDay(x) === startOfUtcDay(y); });
    }),
    date_before: op('date', 'is before', 1, 'date', function (v, a) {
      return dateCompare(v, a[0], function (x, y) { return x < y; });
    }),
    date_after: op('date', 'is after', 1, 'date', function (v, a) {
      return dateCompare(v, a[0], function (x, y) { return x > y; });
    }),
    date_between: op('date', 'is between', 2, 'date', function (v, a) {
      var d = toDate(v), lo = toDate(a[0]), hi = toDate(a[1]);
      if (d === null || lo === null || hi === null) return false;
      if (lo > hi) { var s = lo; lo = hi; hi = s; }
      return d >= lo && d <= hi;
    }),
    date_is_today: op('date', 'is today', 0, 'none', function (v, a, c) {
      var d = toDate(v);
      if (d === null) return false;
      return startOfUtcDay(d) === startOfUtcDay(c.now);
    }),
    date_within_last_days: op('date', 'is within the last {value} days', 1, 'number', function (v, a, c) {
      var d = toDate(v), n = toNumber(a[0]);
      if (d === null || n === null) return false;
      return d >= c.now - n * DAY_MS && d <= c.now;
    }),
    date_within_next_days: op('date', 'is within the next {value} days', 1, 'number', function (v, a, c) {
      var d = toDate(v), n = toNumber(a[0]);
      if (d === null || n === null) return false;
      return d >= c.now && d <= c.now + n * DAY_MS;
    }),
    date_more_than_days_ago: op('date', 'is more than {value} days ago', 1, 'number', function (v, a, c) {
      var d = toDate(v), n = toNumber(a[0]);
      if (d === null || n === null) return false;
      return d < c.now - n * DAY_MS;
    }),
    date_more_than_days_ahead: op('date', 'is more than {value} days from now', 1, 'number', function (v, a, c) {
      var d = toDate(v), n = toNumber(a[0]);
      if (d === null || n === null) return false;
      return d > c.now + n * DAY_MS;
    }),

    /* boolean */
    is_true: op('boolean', 'is true', 0, 'none', function (v) { return toBool(v) === true; }),
    is_false: op('boolean', 'is false', 0, 'none', function (v) { return toBool(v) === false; }),

    /* existence */
    is_set: op('existence', 'is set', 0, 'none', function (v) { return !isNullish(v); }),
    is_not_set: op('existence', 'is not set', 0, 'none', function (v) { return isNullish(v); }),
    is_empty: op('existence', 'is empty', 0, 'none', function (v) { return isEmptyValue(v); }),
    is_not_empty: op('existence', 'is not empty', 0, 'none', function (v) { return !isEmptyValue(v); })
  };

  var OPERATOR_GROUPS = {
    equality: { label: 'Equality', operators: ['eq', 'neq'] },
    arithmetic: { label: 'Arithmetic', operators: ['lt', 'lte', 'gt', 'gte', 'between', 'not_between'] },
    alphanumeric: {
      label: 'Alphanumeric',
      operators: ['contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'not_regex', 'in_list', 'not_in_list']
    },
    list: { label: 'List', operators: ['includes_any', 'includes_all'] },
    date: {
      label: 'Date',
      operators: ['date_eq', 'date_before', 'date_after', 'date_between', 'date_is_today',
        'date_within_last_days', 'date_within_next_days', 'date_more_than_days_ago', 'date_more_than_days_ahead']
    },
    boolean: { label: 'Boolean', operators: ['is_true', 'is_false'] },
    existence: { label: 'Existence', operators: ['is_set', 'is_not_set', 'is_empty', 'is_not_empty'] }
  };

  var FIELD_TYPE_GROUPS = {
    text: ['equality', 'alphanumeric', 'existence'],
    number: ['equality', 'arithmetic', 'existence'],
    date: ['date', 'existence'],
    boolean: ['boolean', 'existence'],
    enum: ['equality', 'alphanumeric', 'existence'],
    list: ['list', 'existence']
  };

  /* ------------------------------------------------------------------ *
   * Policy resolution
   * ------------------------------------------------------------------ */

  var POLICY_NAMES = ['skip', 'true', 'false', 'error'];

  function resolvePolicy(policyValue, labels) {
    if (policyValue === null || policyValue === undefined) return null;
    if (typeof policyValue === 'string') {
      return POLICY_NAMES.indexOf(policyValue) === -1 ? null : policyValue;
    }
    if (typeof policyValue !== 'object') return null;
    for (var i = 0; i < labels.length; i++) {
      var key = labels[i];
      if (Object.prototype.hasOwnProperty.call(policyValue, key)) {
        var v = policyValue[key];
        if (POLICY_NAMES.indexOf(v) !== -1) return v;
      }
    }
    if (POLICY_NAMES.indexOf(policyValue['*']) !== -1) return policyValue['*'];
    if (POLICY_NAMES.indexOf(policyValue['default']) !== -1) return policyValue['default'];
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Evaluator
   * ------------------------------------------------------------------ */

  var DEFAULTS = {
    runtime: 'js',
    environment: null,
    profiles: [],
    unresolvedPolicy: 'error',
    errorPolicy: 'error',
    emptyResult: true,
    caseInsensitive: false,
    now: null,
    callbacks: null,
    operators: null,
    allowManifestCallbacks: false,
    callbackAllowList: null,
    callbackScope: null,
    trace: false
  };

  function Evaluator(options) {
    options = options || {};
    var self = this;
    this.options = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      self.options[k] = Object.prototype.hasOwnProperty.call(options, k) ? options[k] : DEFAULTS[k];
    });
    this.registry = {};
    if (this.options.callbacks) {
      Object.keys(this.options.callbacks).forEach(function (name) {
        self.registry[name] = self.options.callbacks[name];
      });
    }
    this.extraOperators = {};
    if (this.options.operators) {
      Object.keys(this.options.operators).forEach(function (name) {
        self.extraOperators[name] = self.options.operators[name];
      });
    }
  }

  Evaluator.prototype.registerOperator = function (name, fn, meta) {
    if (typeof fn === 'function') {
      this.registry[name] = fn;
    } else if (fn && typeof fn === 'object') {
      this.extraOperators[name] = fn;
    }
    if (meta) this.extraOperators[name] = meta;
    return this;
  };

  Evaluator.prototype.registerOperators = function (map) {
    var self = this;
    Object.keys(map || {}).forEach(function (name) { self.registerOperator(name, map[name]); });
    return this;
  };

  Evaluator.prototype.contextLabels = function () {
    var labels = [];
    (this.options.profiles || []).forEach(function (p) { if (p) labels.push(String(p)); });
    if (this.options.environment) labels.push(String(this.options.environment));
    if (this.options.runtime) labels.push(String(this.options.runtime));
    return labels;
  };

  Evaluator.prototype.nowMs = function () {
    var n = this.options.now;
    if (typeof n === 'function') n = n();
    if (n instanceof Date) return n.getTime();
    if (typeof n === 'number') return n;
    if (typeof n === 'string') { var d = toDate(n); if (d !== null) return d; }
    return Date.now();
  };

  Evaluator.prototype.evaluate = function (document, data, hook) {
    var details = this.evaluateDetailed(document, data);
    if (typeof hook === 'function') {
      return hook(document, data, this.options, details.result, details);
    }
    return details.result;
  };

  Evaluator.prototype.evaluateDetailed = function (document, data) {
    var doc = normaliseDocument(document);
    var state = {
      doc: doc,
      data: data || {},
      labels: this.contextLabels(),
      now: this.nowMs(),
      skipped: [],
      errors: [],
      trace: this.options.trace ? [] : null,
      evaluator: this
    };
    var outcome = this.evalNode(doc.root, state, 'root');
    var result = outcome === SKIP ? !!this.options.emptyResult : !!outcome;
    return {
      result: result,
      skipped: state.skipped,
      errors: state.errors,
      trace: state.trace,
      allSkipped: outcome === SKIP
    };
  };

  Evaluator.prototype.evalNode = function (node, state, path) {
    if (!node || typeof node !== 'object') return SKIP;
    if (node.type === 'group') return this.evalGroup(node, state, path);
    if (node.type === 'condition') return this.evalCondition(node, state, path);
    throw new ConditionError('Unknown node type "' + node.type + '" at ' + path, { path: path });
  };

  Evaluator.prototype.evalGroup = function (node, state, path) {
    var children = Array.isArray(node.children) ? node.children : [];
    var isAnd = (node.operator || 'and') !== 'or';
    var kept = 0;
    var acc = isAnd;
    for (var i = 0; i < children.length; i++) {
      var r = this.evalNode(children[i], state, path + '.children[' + i + ']');
      if (r === SKIP) continue;
      kept++;
      if (isAnd) { acc = acc && r; }
      else { acc = kept === 1 ? r : (acc || r); }
    }
    if (kept === 0) return SKIP;
    var out = node.negate ? !acc : acc;
    if (state.trace) state.trace.push({ path: path, type: 'group', operator: isAnd ? 'and' : 'or', result: out, evaluated: kept });
    return out;
  };

  Evaluator.prototype.evalCondition = function (node, state, path) {
    var self = this;
    var name = node.operator;
    var manifest = state.doc.operators[name] || null;
    var labels = state.labels;

    function policyFor(kind, reason) {
      var chosen = null;
      if (node.policy) chosen = resolvePolicy(node.policy[kind], labels);
      if (!chosen && manifest && manifest.policy) chosen = resolvePolicy(manifest.policy[kind], labels);
      if (!chosen) {
        var fallback = kind === 'unresolved' ? self.options.unresolvedPolicy : self.options.errorPolicy;
        chosen = resolvePolicy(fallback, labels) || 'error';
      }
      return chosen;
    }

    function applyPolicy(policy, reason, cause) {
      if (policy === 'skip') {
        state.skipped.push({ path: path, field: node.field, operator: name, reason: reason });
        return SKIP;
      }
      if (policy === 'true') { state.errors.push({ path: path, operator: name, reason: reason, handled: 'true', message: cause ? String(cause.message || cause) : null }); return true; }
      if (policy === 'false') { state.errors.push({ path: path, operator: name, reason: reason, handled: 'false', message: cause ? String(cause.message || cause) : null }); return false; }
      if (reason === 'unresolved' || reason === 'unavailable') {
        throw new UnresolvedOperatorError('Operator "' + name + '" could not be resolved at ' + path +
          (reason === 'unavailable' ? ' (not available in this context)' : ''),
          { path: path, operator: name, reason: reason, cause: cause });
      }
      throw new ConditionError('Error evaluating operator "' + name + '" at ' + path + ': ' +
        (cause ? (cause.message || cause) : 'unknown error'), { path: path, operator: name, cause: cause });
    }

    /* --- availability gate ------------------------------------------ */
    if (manifest && Array.isArray(manifest.availableIn) && manifest.availableIn.length) {
      var available = false;
      for (var i = 0; i < labels.length; i++) {
        if (manifest.availableIn.indexOf(labels[i]) !== -1) { available = true; break; }
      }
      if (!available) return applyPolicy(policyFor('unresolved'), 'unavailable', null);
    }

    /* --- resolve the implementation --------------------------------- */
    var impl = null;      // function (fieldValue, args, ctx) -> boolean
    var meta = this.extraOperators[name] || manifest || BUILTIN_OPERATORS[name] || null;

    if (Object.prototype.hasOwnProperty.call(this.registry, name)) {
      impl = this.registry[name];
    } else if (BUILTIN_OPERATORS[name] && !manifest) {
      impl = BUILTIN_OPERATORS[name].fn;
    } else if (manifest && manifest.kind === 'values') {
      impl = makeValuesOperator(manifest);
    } else if (manifest && manifest.kind === 'callback') {
      try {
        impl = this.resolveManifestCallback(name, manifest);
      } catch (e) {
        return applyPolicy(policyFor('unresolved'), 'unresolved', e);
      }
      if (!impl) return applyPolicy(policyFor('unresolved'), 'unresolved', null);
    } else if (BUILTIN_OPERATORS[name]) {
      impl = BUILTIN_OPERATORS[name].fn;
    }

    if (!impl) return applyPolicy(policyFor('unresolved'), 'unresolved', null);

    /* --- resolve operands ------------------------------------------- */
    var out;
    try {
      var fieldValue = getPath(state.data, node.field);
      var args = (node.values || []).map(function (v) { return resolveValue(v, state); });
      var ctx = {
        field: node.field,
        operator: name,
        manifest: manifest,
        data: state.data,
        document: state.doc,
        now: state.now,
        runtime: this.options.runtime,
        environment: this.options.environment,
        profiles: this.options.profiles,
        labels: labels,
        caseInsensitive: this.options.caseInsensitive,
        path: path
      };
      out = impl(isMissing(fieldValue) ? null : fieldValue, args, ctx);
      if (out === SKIP) {
        state.skipped.push({ path: path, field: node.field, operator: name, reason: 'callback-skip' });
        return SKIP;
      }
      out = !!out;
    } catch (e) {
      if (e instanceof ConditionError && e.name === 'UnresolvedOperatorError') throw e;
      return applyPolicy(policyFor('error'), 'error', e);
    }

    var final = node.negate ? !out : out;
    if (state.trace) state.trace.push({ path: path, type: 'condition', field: node.field, operator: name, result: final });
    return final;
  };

  Evaluator.prototype.resolveManifestCallback = function (name, manifest) {
    if (!this.options.allowManifestCallbacks) return null;
    var allow = this.options.callbackAllowList;
    if (allow && allow.indexOf(name) === -1) return null;
    var binding = (manifest.callbacks || {})[this.options.runtime] ||
                  (manifest.callbacks || {}).js || null;
    if (!binding) return null;
    var fnName = binding['function'] || binding.method || null;
    if (!fnName) return null;
    var scope = this.options.callbackScope || (typeof globalThis !== 'undefined' ? globalThis : null);
    if (binding['class']) {
      var holder = lookupDotted(scope, binding['class'].replace(/^\\+/, '').replace(/\\/g, '.'));
      if (!holder) return null;
      var target = binding['static'] === false && holder.prototype ? holder.prototype : holder;
      if (typeof target[fnName] !== 'function') return null;
      return target[fnName].bind(target);
    }
    var fn = lookupDotted(scope, fnName);
    return typeof fn === 'function' ? fn : null;
  };

  function lookupDotted(scope, path) {
    if (!scope) return null;
    var parts = String(path).split('.');
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return null;
      cur = cur[parts[i]];
    }
    return cur === undefined ? null : cur;
  }

  function makeValuesOperator(manifest) {
    var list = choiceValues(manifest.values);
    var negated = manifest.match === 'not_in';
    var arity = manifest.arity === undefined ? 0 : manifest.arity;
    return function (value, args, ctx) {
      var haystack = list;
      if (arity !== 0 && args.length) haystack = toList(args[0]);
      var hit = inList(value, haystack, ctx);
      return negated ? !hit : hit;
    };
  }

  function resolveValue(node, state) {
    if (node === null || node === undefined) return null;
    if (typeof node !== 'object') return node;
    if (node.source === 'field') {
      var v = getPath(state.data, node.field);
      return isMissing(v) ? null : v;
    }
    return node.value;
  }

  /* ------------------------------------------------------------------ *
   * Document helpers
   * ------------------------------------------------------------------ */

  function normaliseDocument(document) {
    if (typeof document === 'string') {
      var trimmed = document.trim();
      document = trimmed === '' ? null : JSON.parse(trimmed);
    }
    if (!document || typeof document !== 'object') {
      return { version: SPEC_VERSION, operators: {}, root: emptyGroup() };
    }
    if (document.type === 'group' || document.type === 'condition') {
      return { version: SPEC_VERSION, operators: {}, root: document.type === 'group' ? document : { type: 'group', operator: 'and', children: [document] } };
    }
    return {
      version: document.version || SPEC_VERSION,
      generator: document.generator,
      operators: document.operators || {},
      root: document.root || emptyGroup()
    };
  }

  function emptyGroup() {
    return { type: 'group', operator: 'and', negate: false, children: [] };
  }

  function createDocument(operators) {
    return {
      version: SPEC_VERSION,
      generator: 'kConditionsEditor/' + LIB_VERSION,
      operators: operators || {},
      root: emptyGroup()
    };
  }

  function isEmptyDocument(document) {
    var doc = normaliseDocument(document);
    return !doc.root || !Array.isArray(doc.root.children) || doc.root.children.length === 0;
  }

  /* ------------------------------------------------------------------ *
   * Validation
   * ------------------------------------------------------------------ */

  function operatorMeta(doc, name, extra) {
    if (extra && extra[name]) return extra[name];
    if (doc.operators && doc.operators[name]) return doc.operators[name];
    return BUILTIN_OPERATORS[name] || null;
  }

  function expectedArity(meta) {
    if (!meta) return null;
    if (meta.arity === undefined || meta.arity === null) return 1;
    return meta.arity;
  }

  /**
   * The English for each problem validateDocument() can report, keyed by its
   * `code`. `{name}` is filled from the problem's `params`. The editor's
   * `labels.problems` takes the same keys and placeholders.
   */
  var PROBLEM_MESSAGES = {
    notObject: 'Node is not an object',
    groupOperator: 'Group operator must be "and" or "or"',
    groupChildren: 'Group children must be an array',
    nodeType: 'Unknown node type "{type}"',
    noField: 'Condition has no field',
    unknownField: 'Unknown field "{field}"',
    unknownOperator: 'Unknown operator "{operator}"',
    listArity: 'Operator "{operator}" expects a single list value',
    arity: 'Operator "{operator}" expects {expected} value(s), got {actual}',
    valueNotObject: 'Value must be an object',
    valueNoField: 'Field value has no field name',
    valueSource: 'Value source must be "literal" or "field"'
  };

  function validateDocument(document, options) {
    options = options || {};
    var doc = normaliseDocument(document);
    var problems = [];
    var fieldNames = options.fields ? options.fields.map(function (f) { return typeof f === 'string' ? f : f.name; }) : null;

    // Each problem carries a `code` and the `params` its message was built
    // from, as well as the English `message`, so a caller can say the same
    // thing in another language. The editor does, through labels.problems.
    function report(path, code, params) {
      params = params || {};
      problems.push({ path: path, code: code, params: params, message: fillTemplate(PROBLEM_MESSAGES[code], params) });
    }

    (function walk(node, path) {
      if (!node || typeof node !== 'object') {
        report(path, 'notObject');
        return;
      }
      if (node.type === 'group') {
        if (['and', 'or'].indexOf(node.operator) === -1) report(path, 'groupOperator');
        if (!Array.isArray(node.children)) {
          report(path, 'groupChildren');
          return;
        }
        node.children.forEach(function (child, i) { walk(child, path + '.children[' + i + ']'); });
        return;
      }
      if (node.type !== 'condition') {
        report(path, 'nodeType', { type: String(node.type) });
        return;
      }
      if (!node.field) report(path, 'noField');
      else if (fieldNames && fieldNames.indexOf(node.field) === -1) {
        report(path, 'unknownField', { field: String(node.field) });
      }
      var meta = operatorMeta(doc, node.operator, options.operators);
      if (!meta) {
        report(path, 'unknownOperator', { operator: String(node.operator) });
        return;
      }
      var arity = expectedArity(meta);
      var values = node.values || [];
      if (arity === 'n') {
        if (values.length !== 1) report(path, 'listArity', { operator: node.operator });
      } else if (values.length !== arity) {
        report(path, 'arity', { operator: node.operator, expected: arity, actual: values.length });
      }
      values.forEach(function (v, i) {
        var at = path + '.values[' + i + ']';
        if (!v || typeof v !== 'object') {
          report(at, 'valueNotObject');
          return;
        }
        if (v.source === 'field') {
          if (!v.field) report(at, 'valueNoField');
          else if (fieldNames && fieldNames.indexOf(v.field) === -1) {
            report(at, 'unknownField', { field: String(v.field) });
          }
        } else if (v.source !== 'literal') {
          report(at, 'valueSource');
        }
      });
    }(doc.root, 'root'));

    return problems;
  }

  /* ------------------------------------------------------------------ *
   * Label templates
   *
   * A label may carry placeholders — `{name}` — so a translation can put a
   * value where its own word order wants it: 'Remove {value}' in English,
   * 'Ta bort {value}' in Swedish, '删除{value}' in Chinese. Concatenating
   * English around a value would fix the order for every language.
   * ------------------------------------------------------------------ */

  /** Fill `{name}` placeholders from `vars`; one with no value is left as written. */
  function fillTemplate(template, vars) {
    vars = vars || {};
    return String(template === null || template === undefined ? '' : template)
      .replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, function (m, key) {
        return Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== null && vars[key] !== undefined
          ? String(vars[key]) : m;
      });
  }

  var VALUE_SLOT = '{value}';

  /**
   * Split an operator label at its `{value}` slot, or null when it has none.
   *
   * 'is within the last {value} days' reads "is within the last 7 days" once
   * the operand is in place; 'är inom de senaste {value} dagarna' does the
   * same in Swedish. describe() and the editor both read this, so the
   * summary and the row put the operand in the same place. The whitespace on
   * either side of the slot is kept as written: '在过去{value}天内' wants none.
   * A second `{value}` means nothing and is dropped.
   */
  function splitOperatorLabel(label) {
    var text = String(label === null || label === undefined ? '' : label);
    var at = text.indexOf(VALUE_SLOT);
    if (at === -1) return null;
    var head = text.slice(0, at);
    var tail = text.slice(at + VALUE_SLOT.length).split(VALUE_SLOT).join('');
    var h = head.replace(/\s+$/, '');
    var t = tail.replace(/^\s+/, '');
    return {
      head: h,
      before: head.slice(h.length),
      after: tail.slice(0, tail.length - t.length),
      tail: t
    };
  }

  /** An operator label as a whole, with an ellipsis where the operand goes. */
  function operatorLabelText(label, gap) {
    var slot = splitOperatorLabel(label);
    if (!slot) return String(label);
    return (slot.head + slot.before + (gap === undefined ? '…' : gap) + slot.after + slot.tail).trim();
  }

  /** A non-empty string from a labels map, or the fallback. */
  function labelOr(map, key, fallback) {
    var v = map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    return typeof v === 'string' && v !== '' ? v : fallback;
  }

  /* ------------------------------------------------------------------ *
   * Human-readable description
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   * describe() and describeHtml()
   *
   * One walk, two formatters. The bracketing rules, the NOT placement and the
   * label lookups live in exactly one place, so the plain-text and HTML
   * renderings cannot come to different conclusions about the same rule — only
   * about how a leaf is decorated.
   * ------------------------------------------------------------------ */

  var TEXT_FORMAT = {
    field: function (s) { return '[' + s + ']'; },
    op: function (s) { return s; },
    value: function (s, quoted) { return quoted ? '"' + s + '"' : s; },
    list: function (parts) { return '[' + parts.join(', ') + ']'; },
    logic: function (s) { return s; },
    not: function (s) { return s; },
    open: function () { return '('; },
    close: function () { return ')'; },
    join: function (s) { return s; },
    document: function (s) { return s; }
  };

  var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * Everything that reaches the HTML formatter goes through this.
   *
   * Field labels and values come out of a document that arrived from a browser
   * — untrusted input by definition. A value of `<img src=x onerror=…>` must
   * render as text, not as an image, so escaping is not optional and not the
   * caller's job.
   */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }

  var HTML_FORMAT = {
    field: function (s) { return '<strong class="kcd-field">' + escapeHtml(s) + '</strong>'; },
    op: function (s) { return '<span class="kcd-op">' + escapeHtml(s) + '</span>'; },
    // No quotes: the styling delimits the value, and quotes inside a coloured,
    // underlined span read as part of the value itself.
    value: function (s) { return '<span class="kcd-value">' + escapeHtml(s) + '</span>'; },
    list: function (parts) {
      return '<span class="kcd-list">' + parts.join('<span class="kcd-sep">, </span>') + '</span>';
    },
    // The class is the operator, not the word: a translated "OR" still wants
    // the OR colour.
    logic: function (s, op) {
      return '<span class="kcd-logic kcd-' + (op === 'or' ? 'or' : 'and') + '">' + escapeHtml(s) + '</span>';
    },
    not: function (s) { return '<span class="kcd-not">' + escapeHtml(s) + '</span>'; },
    open: function () { return '<span class="kcd-paren">(</span>'; },
    close: function () { return '<span class="kcd-paren">)</span>'; },
    join: function (s) { return '<span class="kcd-join">' + escapeHtml(s) + '</span>'; },
    document: function (s) { return '<span class="kcd">' + s + '</span>'; }
  };

  function describeWith(document, options, f) {
    options = options || {};
    var doc = normaliseDocument(document);
    // The editor's own `labels` object can be passed as it is: the words of
    // the rule (AND, OR, NOT, the "and" of `between`, the empty text) and the
    // operator names in `labels.operators`. Anything missing is English.
    var labels = options.labels || {};
    var opNames = labels.operators || {};
    var words = {
      and: labelOr(labels, 'and', 'AND'),
      or: labelOr(labels, 'or', 'OR'),
      not: labelOr(labels, 'not', 'NOT'),
      join: labelOr(labels, 'andJoin', 'and')
    };
    var labelFor = {};
    var choiceLabels = {};
    (options.fields || []).forEach(function (field) {
      if (typeof field === 'string') { labelFor[field] = field; return; }
      labelFor[field.name] = field.label || field.name;
      if (field.choices) {
        var map = {};
        normaliseChoices(field.choices).forEach(function (c) { map[asString(c.value)] = c.label; });
        choiceLabels[field.name] = map;
      }
    });

    function fieldLabel(name) { return labelFor[name] || name; }

    // A rule reads better as "State is equal to Florida" than as "FL".
    function choiceLabel(fieldName, value) {
      var map = choiceLabels[fieldName];
      if (!map) return null;
      var hit = map[asString(value)];
      return hit === undefined ? null : hit;
    }

    /* One scalar value, as the display text plus whether the text form quotes
       it. JSON.stringify is what the text renderer used for list items, so it
       is unwrapped here to keep both renderings working from the same string. */
    function scalar(raw, fieldName, useChoices) {
      var label = useChoices ? choiceLabel(fieldName, raw) : null;
      if (label !== null) return f.value(label, true);
      if (typeof raw === 'string') return f.value(raw, true);
      return f.value(String(raw), false);
    }

    function valueText(v, fieldName, useChoices) {
      if (!v || typeof v !== 'object') return f.value(String(v), typeof v === 'string');
      if (v.source === 'field') return f.field(fieldLabel(v.field));
      var val = v.value;
      if (Array.isArray(val)) {
        return f.list(val.map(function (x) { return scalar(x, fieldName, useChoices); }));
      }
      return scalar(val, fieldName, useChoices);
    }

    function opLabel(name) {
      var own = labelOr(opNames, name, null);
      if (own !== null) return own;
      var m = operatorMeta(doc, name, options.operators);
      return (m && m.label) || name;
    }

    function node(n) {
      if (!n) return '';
      if (n.type === 'group') {
        var parts = (n.children || []).map(node).filter(Boolean);
        if (!parts.length) return '';
        var op = n.operator === 'or' ? 'or' : 'and';
        var joined = parts.join(' ' + f.logic(words[op], op) + ' ');
        var wrapped = parts.length > 1 ? f.open() + joined + f.close() : joined;
        return n.negate
          ? f.not(words.not) + ' ' + (parts.length > 1 ? wrapped : f.open() + wrapped + f.close())
          : wrapped;
      }
      var meta = operatorMeta(doc, n.operator, options.operators);
      var arity = expectedArity(meta);
      var values = n.values || [];
      // A substring or a pattern is not one of the field's choices, so it must
      // not be swapped for a choice label: `contains "FL"` is looking for the
      // letters F and L, and rendering it as `contains "Florida"` misreads the
      // rule. Only operators that compare against a whole value get the label.
      var useChoices = !meta || meta.valueFromChoices !== false;
      var operands = '';
      if (arity === 2 && values.length === 2) {
        operands = valueText(values[0], n.field, useChoices) +
          f.join(' ' + words.join + ' ') + valueText(values[1], n.field, useChoices);
      } else if (values.length) {
        operands = values.map(function (v) { return valueText(v, n.field, useChoices); })
          .join(f.join(', '));
      }
      // An operator label with a {value} slot has its operand put there —
      // "is within the last 7 days" — and the words either side of it are
      // both the operator's. Without one, the operand follows the label.
      var label = opLabel(n.operator);
      var slot = splitOperatorLabel(label);
      var text = f.field(fieldLabel(n.field)) + ' ';
      if (!slot) text += f.op(label) + (operands ? ' ' + operands : '');
      else if (!operands) text += f.op(operatorLabelText(label));
      else {
        text += (slot.head ? f.op(slot.head) + slot.before : '') + operands +
          (slot.tail ? slot.after + f.op(slot.tail) : '');
      }
      return n.negate ? f.not(words.not) + ' ' + f.open() + text + f.close() : text;
    }

    var out = node(doc.root);
    if (!out) {
      var empty = options.emptyText || labelOr(labels, 'empty', 'Always');
      return f.document(f === HTML_FORMAT ? escapeHtml(empty) : empty);
    }
    return f.document(out);
  }

  function describe(document, options) {
    return describeWith(document, options, TEXT_FORMAT);
  }

  /**
   * The same sentence as describe(), marked up: the field in <strong>, the
   * operator and value in spans you can style. Everything from the document is
   * escaped, so the result is safe to insert with innerHTML.
   */
  function describeHtml(document, options) {
    return describeWith(document, options, HTML_FORMAT);
  }

  /* ------------------------------------------------------------------ *
   * Functional entry points
   * ------------------------------------------------------------------ */

  function evaluate(document, data, options, hook) {
    var ev = new Evaluator(options || {});
    var details = ev.evaluateDetailed(document, data);
    if (typeof hook === 'function') {
      return hook(document, data, options || {}, details.result, details);
    }
    return details.result;
  }

  function evaluateDetailed(document, data, options) {
    return new Evaluator(options || {}).evaluateDetailed(document, data);
  }

  function createEvaluator(options) { return new Evaluator(options); }

  return {
    SPEC_VERSION: SPEC_VERSION,
    VERSION: LIB_VERSION,
    SKIP: SKIP,
    Evaluator: Evaluator,
    ConditionError: ConditionError,
    UnresolvedOperatorError: UnresolvedOperatorError,
    BUILTIN_OPERATORS: BUILTIN_OPERATORS,
    OPERATOR_GROUPS: OPERATOR_GROUPS,
    FIELD_TYPE_GROUPS: FIELD_TYPE_GROUPS,
    createEvaluator: createEvaluator,
    evaluate: evaluate,
    evaluateDetailed: evaluateDetailed,
    describe: describe,
    describeHtml: describeHtml,
    escapeHtml: escapeHtml,
    validateDocument: validateDocument,
    PROBLEM_MESSAGES: PROBLEM_MESSAGES,
    createDocument: createDocument,
    isEmptyDocument: isEmptyDocument,
    normaliseDocument: normaliseDocument,
    normaliseChoices: normaliseChoices,
    choiceValues: choiceValues,
    helpers: {
      getPath: getPath, toNumber: toNumber, toDate: toDate, toBool: toBool,
      normaliseChoices: normaliseChoices, choiceValues: choiceValues, asString: asString,
      toList: toList, isEmptyValue: isEmptyValue, looseEquals: looseEquals,
      startOfUtcDay: startOfUtcDay, resolvePolicy: resolvePolicy,
      fillTemplate: fillTemplate, splitOperatorLabel: splitOperatorLabel,
      operatorLabelText: operatorLabelText
    }
  };
}));
