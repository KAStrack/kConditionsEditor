/*!
 * kConditions SQL 0.1.5
 * Translates a kConditions document into a self-contained SQL boolean
 * expression — the part that goes after WHERE in a SELECT.
 *
 * Load after k-conditions-evaluator.js. Attaches toSql() to KConditions.
 * MIT Licence. https://github.com/KAStrack/kConditionsEditor
 *
 * WHERE TO GENERATE: both places are supported. Server-side, from the posted
 * document, is right when your endpoint receives a rule. Client-side, into the
 * textarea (`output: 'sql'`), is right when the field already accepted SQL —
 * the trust boundary has not moved and your existing sanitising still applies.
 * What to avoid is widening a JSON endpoint into executing client-supplied SQL.
 * See the "SQL output" section of the docs.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./k-conditions-evaluator.js'));
  } else {
    if (!root.KConditions) {
      throw new Error('kConditionsSql: load k-conditions-evaluator.js first');
    }
    factory(root.KConditions);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
  'use strict';

  var VERSION = '0.1.5';
  var DAY_MS = 86400000;

  /* ------------------------------------------------------------------ *
   * Dialects
   * ------------------------------------------------------------------ */

  function escapeStandard(s) { return s.replace(/'/g, "''"); }

  // MySQL treats backslash as an escape character inside string literals
  // unless NO_BACKSLASH_ESCAPES is set, so doubling the quote is not enough.
  function escapeMysql(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "''"); }

  var DIALECTS = {
    standard: {
      open: '"', close: '"', escape: escapeStandard,
      bool: ['TRUE', 'FALSE'], regex: null, placeholder: 'question'
    },
    mysql: {
      open: '`', close: '`', escape: escapeMysql,
      bool: ['1', '0'], regex: ['REGEXP', 'NOT REGEXP'], placeholder: 'question'
    },
    postgres: {
      open: '"', close: '"', escape: escapeStandard,
      bool: ['TRUE', 'FALSE'], regex: ['~', '!~'], placeholder: 'numbered'
    },
    sqlite: {
      open: '"', close: '"', escape: escapeStandard,
      bool: ['1', '0'], regex: ['REGEXP', 'NOT REGEXP'], placeholder: 'question',
      regexNote: 'SQLite has no built-in REGEXP; register a REGEXP function on the connection.'
    },
    sqlserver: {
      open: '[', close: ']', escape: escapeStandard,
      bool: ['1', '0'], regex: null, placeholder: 'named'
    }
  };

  DIALECTS.mariadb = DIALECTS.mysql;
  DIALECTS.postgresql = DIALECTS.postgres;
  DIALECTS.mssql = DIALECTS.sqlserver;
  DIALECTS.ansi = DIALECTS.standard;

  /* ------------------------------------------------------------------ *
   * Builder
   * ------------------------------------------------------------------ */

  var DEFAULTS = {
    dialect: 'standard',
    fields: null,
    columns: null,
    parameters: false,
    placeholderStyle: null,
    quoteIdentifiers: true,
    nullSafeNegation: true,
    emptyResult: true,
    now: null,
    pretty: false,
    unresolvedPolicy: 'error',
    errorPolicy: 'error',
    unsupportedPolicy: 'error',
    environment: null,
    profiles: [],
    operators: null
  };

  function SqlError(message, details) {
    var e = new K.ConditionError(message, details);
    e.name = 'SqlError';
    return e;
  }

  function Builder(options) {
    var self = this;
    this.o = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      self.o[k] = Object.prototype.hasOwnProperty.call(options || {}, k) ? options[k] : DEFAULTS[k];
    });

    var name = String(this.o.dialect || 'standard').toLowerCase();
    this.dialectName = DIALECTS[name] ? name : 'standard';
    this.d = DIALECTS[this.dialectName];
    if (!DIALECTS[name]) {
      this.unknownDialect = String(this.o.dialect);
    }

    this.columnFor = {};
    this.typeFor = {};
    (this.o.fields || []).forEach(function (f) {
      if (typeof f === 'string') { self.columnFor[f] = f; return; }
      self.columnFor[f.name] = f.column || f.sql || f.name;
      if (f.type) self.typeFor[f.name] = f.type;
    });
    if (this.o.columns) {
      Object.keys(this.o.columns).forEach(function (k) { self.columnFor[k] = self.o.columns[k]; });
    }

    this.params = [];
    this.warnings = [];
    this.skipped = [];
  }

  Builder.prototype.labels = function () {
    var out = [];
    (this.o.profiles || []).forEach(function (p) { if (p) out.push(String(p)); });
    if (this.o.environment) out.push(String(this.o.environment));
    out.push(this.dialectName);
    out.push('sql');
    return out;
  };

  Builder.prototype.nowMs = function () {
    var n = this.o.now;
    if (typeof n === 'function') n = n();
    if (n instanceof Date) return n.getTime();
    if (typeof n === 'number') return n;
    if (typeof n === 'string') { var d = K.helpers.toDate(n); if (d !== null) return d; }
    return Date.now();
  };

  /* --- lexical bits -------------------------------------------------- */

  Builder.prototype.ident = function (name) {
    var self = this;
    if (!this.o.quoteIdentifiers) return String(name);
    return String(name).split('.').map(function (part) {
      return self.d.open + part.split(self.d.close).join(self.d.close + self.d.close) + self.d.close;
    }).join('.');
  };

  Builder.prototype.column = function (fieldName) {
    return this.ident(this.columnFor[fieldName] || fieldName);
  };

  Builder.prototype.placeholder = function (value) {
    this.params.push(value);
    var style = this.o.placeholderStyle || this.d.placeholder;
    if (style === 'numbered') return '$' + this.params.length;
    if (style === 'named') return '@p' + this.params.length;
    return '?';
  };

  Builder.prototype.literal = function (value, hint) {
    if (value === null || value === undefined) return 'NULL';
    if (this.o.parameters) return this.placeholder(value);

    if (typeof value === 'boolean') return value ? this.d.bool[0] : this.d.bool[1];
    if (typeof value === 'number') {
      if (!isFinite(value)) throw SqlError('Cannot render a non-finite number in SQL');
      return String(value);
    }
    if (hint === 'number') {
      var n = K.helpers.toNumber(value);
      if (n !== null) return String(n);
    }
    return "'" + this.d.escape(K.helpers.asString(value)) + "'";
  };

  Builder.prototype.dateLiteral = function (value, fieldName) {
    var ms = K.helpers.toDate(value);
    if (ms === null) throw SqlError('Value is not a date: ' + K.helpers.asString(value));
    return this.literal(this.formatDate(ms, fieldName));
  };

  Builder.prototype.formatDate = function (ms, fieldName) {
    var d = new Date(ms);
    var pad = function (n, w) { return String(n).padStart(w || 2, '0'); };
    var date = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    var midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
                   d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    if (midnight && this.typeFor[fieldName] === 'date') return date;
    if (midnight && this.typeFor[fieldName] === undefined) return date;
    return date + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  };

  // LIKE metacharacters are escaped with a backslash, declared via ESCAPE.
  Builder.prototype.likePattern = function (value, mode) {
    var raw = K.helpers.asString(value)
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    if (mode === 'contains') return '%' + raw + '%';
    if (mode === 'starts') return raw + '%';
    if (mode === 'ends') return '%' + raw;
    return raw;
  };

  Builder.prototype.escapeClause = function () {
    return " ESCAPE '" + this.d.escape('\\') + "'";
  };

  /* --- policy -------------------------------------------------------- */

  Builder.prototype.policyFor = function (kind, node, manifest) {
    var labels = this.labels();
    var chosen = null;
    if (node && node.policy) chosen = K.helpers.resolvePolicy(node.policy[kind], labels);
    if (!chosen && manifest && manifest.policy) chosen = K.helpers.resolvePolicy(manifest.policy[kind], labels);
    if (!chosen) {
      var fallback = kind === 'unresolved' ? this.o.unresolvedPolicy
        : (kind === 'unsupported' ? this.o.unsupportedPolicy : this.o.errorPolicy);
      chosen = K.helpers.resolvePolicy(fallback, labels);
    }
    return chosen || 'error';
  };

  var SKIP = {};

  Builder.prototype.applyPolicy = function (policy, reason, node, path, message) {
    if (policy === 'skip') {
      this.skipped.push({ path: path, field: node.field, operator: node.operator, reason: reason });
      return SKIP;
    }
    if (policy === 'true') { this.warnings.push({ path: path, operator: node.operator, reason: reason, handled: 'true', message: message }); return '1 = 1'; }
    if (policy === 'false') { this.warnings.push({ path: path, operator: node.operator, reason: reason, handled: 'false', message: message }); return '1 = 0'; }
    throw SqlError('Operator "' + node.operator + '" at ' + path + ' cannot be expressed in ' +
      this.dialectName + ' SQL' + (message ? ': ' + message : ''), { path: path, operator: node.operator, reason: reason });
  };

  /* --- walking ------------------------------------------------------- */

  Builder.prototype.build = function (document) {
    var doc = K.normaliseDocument(document);
    this.doc = doc;
    if (this.unknownDialect) {
      this.warnings.push({ reason: 'dialect', message: 'Unknown dialect "' + this.unknownDialect + '"; using standard SQL.' });
    }
    var sql = this.node(doc.root, 'root', 0);
    if (sql === SKIP) sql = this.o.emptyResult ? '1 = 1' : '1 = 0';
    return {
      sql: sql,
      params: this.params,
      dialect: this.dialectName,
      skipped: this.skipped,
      warnings: this.warnings
    };
  };

  Builder.prototype.node = function (node, path, depth) {
    if (!node || typeof node !== 'object') return SKIP;
    if (node.type === 'group') return this.group(node, path, depth);
    if (node.type === 'condition') return this.condition(node, path);
    throw SqlError('Unknown node type "' + node.type + '" at ' + path);
  };

  Builder.prototype.group = function (node, path, depth) {
    var children = Array.isArray(node.children) ? node.children : [];
    var joiner = (node.operator || 'and') === 'or' ? 'OR' : 'AND';
    var parts = [];

    for (var i = 0; i < children.length; i++) {
      var sql = this.node(children[i], path + '.children[' + i + ']', depth + 1);
      if (sql === SKIP) continue;
      parts.push(sql);
    }

    if (!parts.length) return SKIP;

    var joined;
    if (this.o.pretty && parts.length > 1) {
      var pad = new Array(depth + 2).join('    ');
      joined = parts.join('\n' + pad + joiner + ' ');
    } else {
      joined = parts.join(' ' + joiner + ' ');
    }

    var wrapped = parts.length > 1 ? '(' + joined + ')' : joined;
    return node.negate ? 'NOT ' + (parts.length > 1 ? wrapped : '(' + wrapped + ')') : wrapped;
  };

  Builder.prototype.condition = function (node, path) {
    var manifest = (this.doc.operators || {})[node.operator] ||
                   (this.o.operators || {})[node.operator] || null;
    var sql;
    try {
      sql = this.operator(node, manifest, path);
    } catch (e) {
      if (e && e.kceUnsupported) {
        return this.applyPolicy(this.policyFor('unsupported', node, manifest), 'unsupported', node, path, e.message);
      }
      if (e && e.kceUnresolved) {
        return this.applyPolicy(this.policyFor('unresolved', node, manifest), 'unresolved', node, path, e.message);
      }
      throw e;
    }
    if (sql === SKIP) return SKIP;
    return node.negate ? 'NOT (' + sql + ')' : sql;
  };

  function unsupported(message) {
    var e = new Error(message);
    e.kceUnsupported = true;
    return e;
  }

  function unresolved(message) {
    var e = new Error(message);
    e.kceUnresolved = true;
    return e;
  }

  /** Resolve a value node to a SQL fragment. */
  Builder.prototype.operand = function (v, hint, fieldName) {
    if (!v || typeof v !== 'object') return this.literal(v, hint);
    if (v.source === 'field') return this.column(v.field);
    if (hint === 'date') return this.dateLiteral(v.value, fieldName);
    return this.literal(v.value, hint);
  };

  Builder.prototype.operator = function (node, manifest, path) {
    var self = this;
    var col = this.column(node.field);
    var values = node.values || [];
    var op = node.operator;
    var nullSafe = this.o.nullSafeNegation;

    function v(i, hint) { return self.operand(values[i], hint, node.field); }

    function orNull(expr) {
      return nullSafe ? '(' + col + ' IS NULL OR ' + expr + ')' : expr;
    }

    function like(mode, negated) {
      var pattern = self.likePattern(values[0] && values[0].source === 'field'
        ? null : (values[0] || {}).value, mode);
      if (values[0] && values[0].source === 'field') {
        throw unsupported('LIKE against another column is not generated; use a raw SQL operator template');
      }
      var expr = col + (negated ? ' NOT LIKE ' : ' LIKE ') + self.literal(pattern) + self.escapeClause();
      return negated ? orNull(expr) : expr;
    }

    function inList(negated) {
      var raw = values[0] && values[0].source === 'field' ? null : (values[0] || {}).value;
      var list = K.helpers.toList(raw);
      if (!list.length) return negated ? '1 = 1' : '1 = 0';
      var rendered = list.map(function (x) { return self.literal(x); }).join(', ');
      var expr = col + (negated ? ' NOT IN (' : ' IN (') + rendered + ')';
      return negated ? orNull(expr) : expr;
    }

    function dayRange(ms) {
      return '(' + col + ' >= ' + self.literal(self.formatDate(ms, node.field)) +
             ' AND ' + col + ' < ' + self.literal(self.formatDate(ms + DAY_MS, node.field)) + ')';
    }

    /* --- custom operators ------------------------------------------- */

    if (manifest) {
      if (manifest.sql) return this.template(manifest.sql, node, col);
      if (manifest.kind === 'values') {
        var list = K.choiceValues(manifest.values);
        var arity = manifest.arity === undefined ? 0 : manifest.arity;
        if (arity !== 0 && values.length) list = K.helpers.toList((values[0] || {}).value);
        if (!list.length) return manifest.match === 'not_in' ? '1 = 1' : '1 = 0';
        var expr = col + (manifest.match === 'not_in' ? ' NOT IN (' : ' IN (') +
          list.map(function (x) { return self.literal(x); }).join(', ') + ')';
        return manifest.match === 'not_in' ? orNull(expr) : expr;
      }
      if (manifest.kind === 'callback') {
        throw unresolved('callback operators have no SQL equivalent; give the operator an "sql" template');
      }
    } else if (!K.BUILTIN_OPERATORS[op]) {
      throw unresolved('unknown operator');
    }

    /* --- builtins ---------------------------------------------------- */

    switch (op) {
      case 'eq': return col + ' = ' + v(0);
      case 'neq': return orNull(col + ' <> ' + v(0));

      case 'lt': return col + ' < ' + v(0, 'number');
      case 'lte': return col + ' <= ' + v(0, 'number');
      case 'gt': return col + ' > ' + v(0, 'number');
      case 'gte': return col + ' >= ' + v(0, 'number');
      case 'between': return col + ' BETWEEN ' + v(0, 'number') + ' AND ' + v(1, 'number');
      case 'not_between': return orNull(col + ' NOT BETWEEN ' + v(0, 'number') + ' AND ' + v(1, 'number'));

      case 'contains': return like('contains', false);
      case 'not_contains': return like('contains', true);
      case 'starts_with': return like('starts', false);
      case 'ends_with': return like('ends', false);

      case 'regex':
      case 'not_regex': {
        if (!this.d.regex) {
          throw unsupported(this.dialectName + ' has no regular expression operator');
        }
        if (this.d.regexNote) this.warnings.push({ path: path, operator: op, message: this.d.regexNote });
        var rop = this.d.regex[op === 'regex' ? 0 : 1];
        var rexpr = col + ' ' + rop + ' ' + v(0);
        return op === 'regex' ? rexpr : orNull(rexpr);
      }

      case 'in_list': return inList(false);
      case 'not_in_list': return inList(true);

      case 'includes_any':
      case 'includes_all':
        // A multi-valued column has no portable storage shape (a CSV string, a
        // JSON array, a junction table), so there is nothing dialect-neutral to
        // emit. A custom operator with an `sql` template says how YOUR schema
        // stores it; otherwise the unresolved-operator policy applies.
        throw unresolved('operator "' + op + '" has no SQL translation: a multi-valued column has no portable shape; use a custom operator with an "sql" template');

      case 'date_eq': {
        var ms = K.helpers.toDate((values[0] || {}).value);
        if (ms === null) throw unsupported('date_eq needs a literal date');
        return dayRange(ms);
      }
      case 'date_before': return col + ' < ' + v(0, 'date');
      case 'date_after': return col + ' > ' + v(0, 'date');
      case 'date_between': return '(' + col + ' >= ' + v(0, 'date') + ' AND ' + col + ' <= ' + v(1, 'date') + ')';
      case 'date_is_today': return dayRange(K.helpers.startOfUtcDay(this.nowMs()));

      case 'date_within_last_days': {
        var n1 = K.helpers.toNumber((values[0] || {}).value);
        if (n1 === null) throw unsupported('date_within_last_days needs a number');
        var now1 = this.nowMs();
        return '(' + col + ' >= ' + this.literal(this.formatDate(now1 - n1 * DAY_MS, node.field)) +
               ' AND ' + col + ' <= ' + this.literal(this.formatDate(now1, node.field)) + ')';
      }
      case 'date_within_next_days': {
        var n2 = K.helpers.toNumber((values[0] || {}).value);
        if (n2 === null) throw unsupported('date_within_next_days needs a number');
        var now2 = this.nowMs();
        return '(' + col + ' >= ' + this.literal(this.formatDate(now2, node.field)) +
               ' AND ' + col + ' <= ' + this.literal(this.formatDate(now2 + n2 * DAY_MS, node.field)) + ')';
      }
      case 'date_more_than_days_ago': {
        var n3 = K.helpers.toNumber((values[0] || {}).value);
        if (n3 === null) throw unsupported('date_more_than_days_ago needs a number');
        return col + ' < ' + this.literal(this.formatDate(this.nowMs() - n3 * DAY_MS, node.field));
      }
      case 'date_more_than_days_ahead': {
        var n4 = K.helpers.toNumber((values[0] || {}).value);
        if (n4 === null) throw unsupported('date_more_than_days_ahead needs a number');
        return col + ' > ' + this.literal(this.formatDate(this.nowMs() + n4 * DAY_MS, node.field));
      }

      case 'is_true': return col + ' = ' + this.d.bool[0];
      case 'is_false': return col + ' = ' + this.d.bool[1];

      case 'is_set': return col + ' IS NOT NULL';
      case 'is_not_set': return col + ' IS NULL';
      case 'is_empty': return '(' + col + ' IS NULL OR ' + col + " = '')";
      case 'is_not_empty': return '(' + col + ' IS NOT NULL AND ' + col + " <> '')";

      default:
        throw unresolved('operator "' + op + '" has no SQL translation');
    }
  };

  /**
   * Render a raw SQL template from an operator manifest.
   *
   *   "sql": "email_is_unique({field})"
   *   "sql": "{field} @> {0}::jsonb"
   *
   * {field} is the quoted column, {0}/{1} the rendered values, {values} the
   * comma-separated list. The template itself is trusted configuration, not
   * user input — it comes from your own operator definitions.
   */
  Builder.prototype.template = function (tpl, node, col) {
    var self = this;
    var values = node.values || [];
    return String(tpl).replace(/\{(field|values|\d+)\}/g, function (_, key) {
      if (key === 'field') return col;
      if (key === 'values') {
        var raw = K.helpers.toList((values[0] || {}).value);
        return raw.map(function (x) { return self.literal(x); }).join(', ');
      }
      var i = Number(key);
      return values[i] === undefined ? 'NULL' : self.operand(values[i], null, node.field);
    });
  };

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */

  function toSql(document, options) {
    return new Builder(options || {}).build(document);
  }

  K.toSql = toSql;
  K.SQL_VERSION = VERSION;
  K.SQL_DIALECTS = Object.keys(DIALECTS);

  return { toSql: toSql, VERSION: VERSION, DIALECTS: DIALECTS };
}));
