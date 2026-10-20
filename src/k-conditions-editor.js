/*!
 * kConditionsEditor 0.1.1
 * A zero-dependency conditions builder that takes over a <textarea>.
 * MIT Licence. https://github.com/KAStrack/kConditionsEditor
 *
 * Requires k-conditions-evaluator.js to be loaded first.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./k-conditions-evaluator.js'));
  } else {
    if (!root.KConditions) {
      throw new Error('kConditionsEditor: load k-conditions-evaluator.js before k-conditions-editor.js');
    }
    root.KConditionsEditor = factory(root.KConditions);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (KConditions) {
  'use strict';

  var VERSION = '0.1.1';
  var BUILTIN = KConditions.BUILTIN_OPERATORS;
  var GROUPS = KConditions.OPERATOR_GROUPS;
  var TYPE_GROUPS = KConditions.FIELD_TYPE_GROUPS;

  var uid = 0;
  function nextId() { uid += 1; return 'n' + uid; }

  // The property on a <textarea> that points back at its editor. It is how
  // get() and detach() find an instance whose attach() return value was lost,
  // and how attach() knows to replace one. Visible in devtools as
  // $0.kConditionsEditor, which is deliberate.
  var HANDLE = 'kConditionsEditor';

  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  /**
   * Wrap a fully populated <select> so it renders at the width of its *chosen*
   * option rather than its widest one.
   *
   * The select stays the real control — it keeps focus, keyboard and screen
   * reader behaviour — but is laid transparently over a span carrying the
   * selected label. Without this a row is as wide as the longest field name in
   * the configuration, which is what makes a builder read as a form rather than
   * as a sentence.
   */
  function selectShell(select, extraClass) {
    var wrap = el('span', 'kce-sel' + (extraClass ? ' ' + extraClass : ''));
    var label = el('span', 'kce-sel-label', { 'aria-hidden': 'true' });

    function refresh() {
      var opt = select.options[select.selectedIndex];
      label.textContent = opt ? opt.textContent : '';
      wrap.setAttribute('data-empty', label.textContent === '' ? 'true' : 'false');
    }

    select.addEventListener('change', refresh);
    wrap.appendChild(label);
    wrap.appendChild(select);
    refresh();
    return wrap;
  }

  /**
   * Carry the document inside the generated SQL, as a leading block comment.
   *
   * This is what makes `output: 'sql'` round-trip in a form that has only the
   * one SQL field — there is nowhere else to put the JSON. A block comment
   * cannot contain its own terminator, and a JSON string legitimately can, so
   * the terminator is rewritten using JSON's escaped solidus. That is still
   * valid JSON, and it parses straight back.
   */
  var DOC_COMMENT = /\/\*\s*kconditions:1\.0\s+([\s\S]*?)\*\//;

  function embedDocument(sql, json) {
    // Trailing, not leading: in a field a person can see, the SQL is the point
    // and the document is baggage. Put the baggage last.
    return sql + '\n/* kconditions:1.0 ' + json.replace(/\*\//g, '*\\/') + ' */';
  }

  function extractDocument(text) {
    var m = DOC_COMMENT.exec(text || '');
    return m ? m[1].trim() : '';
  }

  /** Keep a text/number input at the width of its content. */
  function autosize(input, min, max) {
    min = min || 4;
    max = max || 44;
    function fit() {
      var len = (input.value || input.getAttribute('placeholder') || '').length;
      input.size = Math.max(min, Math.min(max, len + 1));
    }
    input.addEventListener('input', fit);
    input.kceFit = fit;
    fit();
    return input;
  }

  var DEFAULT_LABELS = {
    edit: 'Edit Conditions',
    done: 'Done',
    empty: 'Always',
    addCondition: '+ Condition',
    addGroup: '+ Group',
    addAnd: '+AND',
    addOr: '+OR',
    wrapAnd: 'AND(…)',
    wrapOr: 'OR(…)',
    removeGroup: 'Remove group',
    removeCondition: 'Remove condition',
    and: 'AND',
    or: 'OR',
    not: 'NOT',
    valueSourceLiteral: 'Value',
    valueSourceField: 'Field',
    chooseField: 'Choose a field…',
    chooseOperator: 'Choose…',
    listHint: 'add…',
    listHintEmpty: 'type a value, press Enter',
    andJoin: 'and',
    invalid: 'This rule is incomplete:',
    jsonHeading: 'JSON output',
    viewSource: 'View source',
    hideSource: 'Hide source',
    // The hideTextarea: 'toggle' control. Distinct keys from viewSource /
    // hideSource above, which belong to the debug panel — that one shows the
    // generated document, this one shows the field it was written into.
    revealField: 'Show source',
    concealField: 'Hide source',
    tabDocument: 'Document',
    tabSql: 'SQL',
    tabSummary: 'Summary',
    copy: 'Copy',
    copied: 'Copied',
    ghostCondition: 'new condition',
    clear: 'Clear and start over',
    clearConfirm: 'Clear every condition?',
    clearYes: 'Clear',
    clearCancel: 'Cancel',
    undo: 'Undo',
    redo: 'Redo',
    // The note after a change took out brackets that no longer did anything.
    bracketsRemoved: 'Removed unneeded brackets',
    moveUp: 'Move up',
    moveDown: 'Move down',
    dragHandle: 'Drag to reorder',
    // The notice for a field whose content the editor could not read.
    preservedText: 'The existing contents of this field could not be read as a rule. ' +
      'Build the rule here; the original is shown for reference and the field keeps it until you change anything.',
    preservedDismiss: 'Dismiss'
  };

  var DEFAULTS = {
    fields: [],
    operators: {},
    labels: {},
    emptyText: null,
    startOpen: false,
    collapsible: true,
    readOnly: false,
    showJson: false,
    pretty: true,
    skin: 'prose',
    theme: null,
    maxDepth: 6,
    allowGroupNegate: true,
    allowConditionNegate: false,
    allowWrapGroup: true,
    defaultGroupOperator: 'and',
    // Comparing one field against another is a real feature but a niche one,
    // and it costs a "Value / Field" selector on *every* row that has a value.
    // Off unless asked for. A field that names `comparableWith` has asked for
    // it explicitly and keeps the selector regardless of this setting.
    allowFieldValues: false,
    // Render the collapsed summary as marked-up HTML rather than plain text.
    // Safe by construction: describeHtml() escapes everything from the document.
    summaryHtml: false,
    // true hides the field, false leaves it visible, 'toggle' hides it but
    // adds a control that shows it again.
    hideTextarea: true,
    // What to hide instead of the textarea: a selector, an element, or a list
    // of them. Useful when the field has a label and a wrapper that should go
    // with it.
    hideTarget: null,
    output: 'json',
    sql: null,
    documentInput: null,
    documentInComment: false,
    allowClear: true,
    history: true,
    historyLimit: 50,
    historyIdle: 500,
    allowReorder: true,
    allowDrag: true,
    // Where the flow layout (prose) puts a group's AND / OR. 'below': on a line
    // of its own under the row, lined up beneath the field name (or under the
    // bracket, after a group) — the rule
    // reads down the page like a formatted query. 'inline': on the row's line,
    // just after the value — more compact, and it reads along the line. Either
    // way it does not move when the row's controls appear.
    connectorPlacement: 'below',
    // 'inline' only: line each indent level's AND / OR up in a column.
    alignConnectors: true,
    // How a preview is drawn — what hovering or focusing an add button or a ×
    // shows. Independent of the skin; see PREVIEW_STYLES.
    previewStyle: 'bar',
    // When the row controls — grip, arrows, ×, the add buttons and a group's
    // tools — are shown: 'hover' reveals them on the row being pointed at (or
    // focused); 'always' shows them at rest. A screen with no hover gets
    // 'always' whatever this says.
    controls: 'hover',
    // In the flow layout (prose), a thin line down the left of each bracketed
    // group's rows, in the group's AND / OR colour, so a row can be traced to
    // the group it belongs to. Pointing at a group's AND / OR or a bracket
    // strengthens its line.
    groupGuides: true,
    debug: false,
    onChange: null
  };

  /**
   * The ways a preview can be drawn. Every one paints the same set of elements
   * (previewTargets) in the same colour (--kce-mark); they differ only in how.
   *
   *   highlight  a tint and outline on each element (the 0.0.16 look)
   *   bar        one thin bar in the margin beside the whole range
   *   region     one soft wash behind the whole range
   *   fade       everything outside the range fades back
   *   color      text in the range takes the colour
   *   marker     a coloured dot where each row's drag grip sits
   *   underline  names, operators and AND / OR in the range are underlined
   */
  var PREVIEW_STYLES = { highlight: true, bar: true, region: true, fade: true, color: true, marker: true, underline: true };

  function previewStyleOf(style) {
    return Object.prototype.hasOwnProperty.call(PREVIEW_STYLES, style) ? style : 'bar';
  }

  function controlsOf(mode) {
    return mode === 'always' ? 'always' : 'hover';
  }

  function placementOf(mode) {
    return mode === 'inline' ? 'inline' : 'below';
  }

  /* ------------------------------------------------------------------ *
   * Field / operator metadata
   * ------------------------------------------------------------------ */

  function normaliseField(f) {
    if (typeof f === 'string') f = { name: f };
    var field = extend({}, f);
    field.name = field.name || field.id;
    field.label = field.label || field.name;
    // Choices may be scalars, {value,label} objects, or an associative map
    // ({ FL: 'Florida' }); they are normalised to [{value,label}] once, here.
    if (field.choices) field.choices = KConditions.normaliseChoices(field.choices);
    field.type = field.type || (field.choices && field.choices.length ? 'enum' : 'text');
    field.values = field.values || ['literal', 'field'];
    // The SQL builder needs a column name; default it to the field name.
    if (!field.column) field.column = field.name;
    return field;
  }

  function Editor(target, options) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target || target.tagName !== 'TEXTAREA') {
      throw new Error('kConditionsEditor: target must be a <textarea>');
    }

    // A textarea carries at most one editor. Attaching to one that already has
    // an editor replaces it: the old instance is torn down first, so its root is
    // gone and the field is restored before the new one hides it again. There
    // is no "same options, do nothing" shortcut — an options object can hold
    // callbacks, which cannot be compared, and the field's value may have
    // changed since the first attach; attach() always takes the field as it
    // stands now.
    if (target[HANDLE]) target[HANDLE].destroy();

    this.textarea = target;
    this.options = extend({}, DEFAULTS, options || {});
    this.labels = extend({}, DEFAULT_LABELS, this.options.labels || {});
    if (this.options.emptyText) this.labels.empty = this.options.emptyText;

    this.fields = (this.options.fields || []).map(normaliseField);
    this.fieldIndex = {};
    var self = this;
    this.fields.forEach(function (f) { self.fieldIndex[f.name] = f; });

    this.customOperators = extend({}, this.options.operators || {});
    this.listeners = {};
    this.open = false;

    // With output: 'sql' the textarea holds SQL, which cannot be parsed back
    // into a rule. documentInput names a second field that carries the JSON so
    // the rule survives a round trip.
    this.documentInput = null;
    if (this.options.documentInput) {
      this.documentInput = typeof this.options.documentInput === 'string'
        ? document.querySelector(this.options.documentInput)
        : this.options.documentInput;
    }
    if (this.options.output === 'sql' && !this.documentInput &&
        !this.options.documentInComment && typeof console !== 'undefined') {
      console.warn('kConditionsEditor: output "sql" with neither documentInput nor ' +
        'documentInComment — the rule cannot be reloaded from the form, because SQL ' +
        'does not parse back into a document. The field is left as it is until ' +
        'something changes, but the rule in it cannot be edited.');
    }

    // Content the editor could not read — SQL written by hand, usually. It is
    // kept in the field untouched until the first change (`pristine`, see
    // sync() and touch()) and shown above the rule so it can be rebuilt while
    // reading it.
    this.preserved = null;
    this.pristine = false;

    this.hideTargets = this.resolveHideTargets();
    this.doc = this.parseInitial();
    this.dropRedundantGroups();

    // The whole editable state is one small JSON tree, so the history is just a
    // list of serialised documents with a cursor. Undo moves the cursor and
    // reloads; there are no inverse operations to get wrong.
    this.history = this.options.history === false ? null : {
      stack: [],
      at: -1,
      limit: Math.max(2, this.options.historyLimit || 50),
      idle: Math.max(0, this.options.historyIdle === undefined ? 500 : this.options.historyIdle),
      burstKey: null,
      burstTimer: null
    };

    this.build();
    this.setOpen(!!this.options.startOpen && !this.options.readOnly);
    this.sync();
    // Seeded last, so the baseline is the document as it actually stands once
    // the first render has settled it — otherwise undo could reach a state the
    // user never saw.
    this.pushHistory();

    // The handle KConditionsEditor.get() reads. Set last, so a constructor that
    // throws leaves nothing registered.
    target[HANDLE] = this;
  }

  /* ------------------------------------------------------------------ *
   * What gets hidden
   *
   * By default the editor conceals the textarea it took over. `hideTarget`
   * widens that to anything else on the page — typically the row that carries
   * the field's label, which would otherwise be left behind labelling nothing.
   * ------------------------------------------------------------------ */

  Editor.prototype.resolveHideTargets = function () {
    var raw = this.options.hideTarget;
    if (!raw) return [this.textarea];

    var list;
    if (typeof raw === 'string') list = Array.prototype.slice.call(document.querySelectorAll(raw));
    else if (raw.nodeType === 1) list = [raw];
    else if (typeof raw.length === 'number') list = Array.prototype.slice.call(raw);
    else list = [];

    list = list.filter(function (el) { return el && el.nodeType === 1; });

    if (!list.length) {
      if (typeof console !== 'undefined') {
        console.warn('kConditionsEditor: hideTarget matched nothing; hiding the textarea instead.');
      }
      return [this.textarea];
    }

    // The textarea must end up hidden too, or the form shows a raw JSON field
    // next to the builder. It usually sits inside a target already.
    var self = this;
    var covered = list.some(function (el) { return el === self.textarea || el.contains(self.textarea); });
    if (!covered) list.push(this.textarea);
    return list;
  };

  /** Apply or lift the concealment on every target. */
  Editor.prototype.applyConcealment = function () {
    var show = this.sourceVisible;
    this.hideTargets.forEach(function (el) {
      var isField = el.tagName === 'TEXTAREA';
      if (show) {
        el.classList.remove('kce-concealed');
        if (isField) el.classList.remove('kce-hidden-textarea');
        el.removeAttribute('aria-hidden');
        if (isField) el.removeAttribute('tabindex');
      } else {
        el.classList.add('kce-concealed');
        // Kept for anyone who styled the old class name.
        if (isField) el.classList.add('kce-hidden-textarea');
        el.setAttribute('aria-hidden', 'true');
        if (isField) el.setAttribute('tabindex', '-1');
      }
    });
    if (this.sourceToggle) {
      this.sourceToggle.textContent = show ? this.labels.concealField : this.labels.revealField;
      this.sourceToggle.setAttribute('aria-expanded', String(show));
    }
    return this;
  };

  /**
   * Show or hide the field the editor took over.
   *
   * Only meaningful with `hideTextarea: 'toggle'` — with `true` there is no
   * control, and calling this is how you would build your own.
   */
  Editor.prototype.setSourceVisible = function (visible) {
    this.sourceVisible = !!visible;
    this.applyConcealment();
    this.emit('source', { visible: this.sourceVisible, targets: this.hideTargets });
    return this;
  };

  Editor.prototype.isSourceVisible = function () { return !!this.sourceVisible; };

  Editor.prototype.buildSourceToggle = function () {
    var self = this;
    var wrap = el('div', 'kce-source-toggle-wrap');
    this.sourceToggle = el('button', 'kce-btn kce-source-toggle', {
      type: 'button',
      text: this.labels.revealField,
      'aria-expanded': 'false'
    });
    this.sourceToggle.addEventListener('click', function () {
      self.setSourceVisible(!self.sourceVisible);
    });
    wrap.appendChild(this.sourceToggle);
    return wrap;
  };

  Editor.prototype.parseInitial = function () {
    // The document input is authoritative when it holds anything, but an empty
    // one falls back to the textarea — otherwise adding documentInput to an
    // existing form would silently discard the rule already in the field.
    var source = '';
    if (this.documentInput) source = (this.documentInput.value || '').trim();
    if (!source) source = (this.textarea.value || '').trim();
    var raw = source;
    // SQL in the field? The document may be riding along in a trailing comment.
    if (raw && raw.charAt(0) !== '{' && raw.charAt(0) !== '[') raw = extractDocument(raw);
    if (raw && raw.charAt(0) !== '{' && raw.charAt(0) !== '[') raw = '';
    // Something was there and none of it is a document: keep it, do not
    // replace it. Hand-written SQL in a field the editor is taking over is
    // the usual case, and it may be the only copy of that rule.
    if (!raw) return source ? this.preserve(source) : KConditions.createDocument();
    try {
      var doc = KConditions.normaliseDocument(raw);
      this.assignIds(doc.root);
      return {
        version: doc.version,
        generator: doc.generator || ('kConditionsEditor/' + VERSION),
        operators: doc.operators || {},
        root: doc.root
      };
    } catch (e) {
      this.parseError = e;
      return this.preserve(source);
    }
  };

  /**
   * Content the editor cannot read stays in the field.
   *
   * The editor used to attach, find nothing it recognised, and write an empty
   * rule over whatever was there before the person had touched anything — so
   * an untouched form submitted a destroyed rule. Now the content is recorded
   * and the field is `pristine`: sync() leaves it alone until touch() ends
   * that, on the first real change. The notice built from `preserved` shows
   * the content so the rule can be rebuilt while reading it.
   */
  Editor.prototype.preserve = function (text) {
    this.preserved = { text: text };
    this.pristine = true;
    return KConditions.createDocument();
  };

  Editor.prototype.assignIds = function (node) {
    if (!node || typeof node !== 'object') return;
    if (!node.id) node.id = nextId();
    if (node.type === 'group' && Array.isArray(node.children)) {
      for (var i = 0; i < node.children.length; i++) this.assignIds(node.children[i]);
    }
  };

  /* ------------------------------------------------------------------ *
   * Operator resolution for a given field
   * ------------------------------------------------------------------ */

  Editor.prototype.operatorMeta = function (name) {
    if (this.customOperators[name]) {
      var custom = extend({}, this.customOperators[name]);
      custom.name = name;
      if (custom.arity === undefined) custom.arity = custom.kind === 'values' ? 0 : 1;
      if (!custom.valueKind) {
        custom.valueKind = custom.arity === 0 ? 'none' : (custom.values ? 'choice' : 'text');
      }
      if (!custom.label) custom.label = name;
      if (!custom.group) custom.group = 'custom';
      return custom;
    }
    if (BUILTIN[name]) return extend({ name: name }, BUILTIN[name]);
    return null;
  };

  Editor.prototype.operatorsForField = function (field) {
    var names = [];
    var self = this;

    function push(n) { if (n && names.indexOf(n) === -1) names.push(n); }

    function expand(entry) {
      if (typeof entry !== 'string') return;
      if (entry.indexOf('group:') === 0) {
        var g = GROUPS[entry.slice(6)];
        if (g) g.operators.forEach(push);
        // custom operators tagged with this group
        Object.keys(self.customOperators).forEach(function (n) {
          if (self.customOperators[n].group === entry.slice(6)) push(n);
        });
        return;
      }
      push(entry);
    }

    if (Array.isArray(field.operators) && field.operators.length) {
      field.operators.forEach(expand);
    } else {
      var groups = field.operatorGroups || TYPE_GROUPS[field.type] || TYPE_GROUPS.text;
      groups.forEach(function (g) { expand('group:' + g); });
      Object.keys(this.customOperators).forEach(function (n) {
        var applies = self.customOperators[n].appliesTo;
        if (applies === '*' || (Array.isArray(applies) && applies.indexOf(field.name) !== -1)) push(n);
      });
    }
    if (Array.isArray(field.excludeOperators)) {
      names = names.filter(function (n) { return field.excludeOperators.indexOf(n) === -1; });
    }
    return names.filter(function (n) { return !!self.operatorMeta(n); });
  };

  Editor.prototype.comparableFields = function (field) {
    var self = this;
    var rule = field.comparableWith;
    if (rule === false || (Array.isArray(rule) && rule.length === 0)) return [];
    if (rule === undefined || rule === null) {
      return this.fields.filter(function (f) { return f.name !== field.name && f.type === field.type; });
    }
    if (rule === '*') return this.fields.filter(function (f) { return f.name !== field.name; });
    var list = Array.isArray(rule) ? rule : [rule];
    var out = [];
    list.forEach(function (entry) {
      if (typeof entry !== 'string') return;
      if (entry === '*') {
        self.fields.forEach(function (f) { if (f.name !== field.name && out.indexOf(f) === -1) out.push(f); });
      } else if (entry.indexOf('type:') === 0) {
        var t = entry.slice(5);
        self.fields.forEach(function (f) {
          if (f.name !== field.name && f.type === t && out.indexOf(f) === -1) out.push(f);
        });
      } else if (entry.indexOf('group:') === 0) {
        var g = entry.slice(6);
        self.fields.forEach(function (f) {
          if (f.name !== field.name && f.group === g && out.indexOf(f) === -1) out.push(f);
        });
      } else {
        var f2 = self.fieldIndex[entry];
        if (f2 && f2.name !== field.name && out.indexOf(f2) === -1) out.push(f2);
      }
    });
    return out;
  };

  /* ------------------------------------------------------------------ *
   * DOM construction
   * ------------------------------------------------------------------ */

  Editor.prototype.build = function () {
    var self = this;
    var wrap = el('div', 'kce');
    wrap.setAttribute('data-kce-version', VERSION);
    wrap.setAttribute('data-kce-skin', this.options.skin || 'boxed');
    this.options.previewStyle = previewStyleOf(this.options.previewStyle);
    wrap.setAttribute('data-kce-preview', this.options.previewStyle);
    this.options.controls = controlsOf(this.options.controls);
    this.options.connectorPlacement = placementOf(this.options.connectorPlacement);
    wrap.setAttribute('data-kce-connectors', this.options.connectorPlacement);
    // The stylesheet keeps a margin for the guides when they are on.
    wrap.setAttribute('data-kce-guides', this.options.groupGuides === false ? 'off' : 'on');
    if (this.options.theme) wrap.setAttribute('data-kce-theme', this.options.theme);
    if (this.options.readOnly) wrap.classList.add('kce--readonly');

    this.summary = el('div', 'kce-summary');
    this.summaryText = el('div', 'kce-summary-text');
    this.editButton = el('button', 'kce-btn kce-btn-primary kce-edit', { type: 'button', text: this.labels.edit });
    this.summary.appendChild(this.summaryText);
    if (!this.options.readOnly) this.summary.appendChild(this.editButton);

    this.body = el('div', 'kce-body');
    this.tree = el('div', 'kce-tree');
    this.messages = el('div', 'kce-messages');
    this.footer = el('div', 'kce-footer');
    this.doneButton = el('button', 'kce-btn kce-done', { type: 'button', text: this.labels.done });
    this.footer.appendChild(this.messages);
    // Read out when a change takes out brackets (see announceTidy). A live
    // region has to exist before its text changes to be heard reliably, so it
    // is here from the start rather than arriving with the note.
    this.liveRegion = el('div', 'kce-live', { role: 'status', 'aria-live': 'polite' });
    this.footer.appendChild(this.liveRegion);
    if (this.options.hideTextarea === 'toggle') this.footer.appendChild(this.buildSourceToggle());
    if (this.history && !this.options.readOnly) this.footer.appendChild(this.buildHistoryControls());
    if (this.options.allowClear && !this.options.readOnly) this.footer.appendChild(this.buildClear());
    if (this.options.collapsible) this.footer.appendChild(this.doneButton);

    this.body.appendChild(this.tree);
    this.body.appendChild(this.footer);

    if (this.options.showJson) {
      this.jsonBox = el('pre', 'kce-json');
      var jsonWrap = el('details', 'kce-json-wrap');
      jsonWrap.appendChild(el('summary', null, { text: this.labels.jsonHeading }));
      jsonWrap.appendChild(this.jsonBox);
      this.body.appendChild(jsonWrap);
    }

    if (this.options.debug) this.buildSourcePanel();

    wrap.appendChild(this.summary);
    // Between the summary and the body: on screen whether the editor is
    // collapsed or open, and outside the tree, which render() rebuilds.
    if (this.preserved) wrap.appendChild(this.buildPreserved());
    wrap.appendChild(this.body);

    // Insert after whatever is being hidden, not after the textarea. With a
    // hideTarget wrapping the field — a row carrying its label — inserting
    // after the textarea would put the editor *inside* the element about to be
    // hidden, and the editor would never be seen.
    var anchor = this.textarea;
    this.hideTargets.forEach(function (el) {
      if (el !== anchor && el.contains(anchor)) anchor = el;
    });
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    this.root = wrap;

    this.sourceVisible = !this.options.hideTextarea;
    if (this.options.hideTextarea) this.applyConcealment();

    this.editButton.addEventListener('click', function () { self.setOpen(true); });
    this.doneButton.addEventListener('click', function () { self.setOpen(false); });

    // Rows can wrap at a narrower width, which moves the operators.
    this.onViewportResize = function () {
      if (self.resizeFrame) return;
      self.resizeFrame = (window.requestAnimationFrame || setTimeout)(function () {
        self.resizeFrame = null;
        self.fitLayout();
      }, 16);
    };
    window.addEventListener('resize', this.onViewportResize);

    // A screen with no hover cannot reveal anything on hover, so it gets
    // 'always' regardless of the option. Decided here, in one place, rather than
    // in a media query that would have to repeat every reveal rule; and kept
    // live, because a tablet can gain a mouse.
    this.noHover = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: none)') : null;
    this.onHoverCapability = function () { self.applyControls(); };
    if (this.noHover) {
      if (this.noHover.addEventListener) this.noHover.addEventListener('change', this.onHoverCapability);
      else if (this.noHover.addListener) this.noHover.addListener(this.onHoverCapability);
    }
    this.applyControls();

    // Pointing at (or focusing) a group's AND / OR, or one of its brackets,
    // strengthens that group's guide. Delegated, because the tree is rebuilt
    // on every render.
    this.onGuideOver = function (e) { self.lightGuide(self.guideGroupOf(e.target)); };
    this.onGuideOut = function (e) {
      if (self.guideGroupOf(e.relatedTarget) !== self.litGuide) self.lightGuide(null);
    };
    this.tree.addEventListener('mouseover', this.onGuideOver);
    this.tree.addEventListener('mouseout', this.onGuideOut);
    this.tree.addEventListener('focusin', this.onGuideOver);
    this.tree.addEventListener('focusout', this.onGuideOut);

    // The window is not the only thing that resizes an editor. A dialog
    // opens, a sidebar collapses, a tab is shown — and an editor attached
    // while hidden measured everything as zero and never looked again. Only a
    // change of width matters; height changes with every edit.
    if (typeof ResizeObserver === 'function') {
      var observedWidth = -1;
      this.resizeObserver = new ResizeObserver(function (entries) {
        var width = entries[entries.length - 1].contentRect.width;
        if (width === observedWidth) return;
        observedWidth = width;
        self.onViewportResize();
      });
      this.resizeObserver.observe(this.tree);
    }

    if (this.history && !this.options.readOnly) {
      // Bound to the document rather than to the editor's own element. A
      // structural change rebuilds the tree, which destroys the button that was
      // just clicked, and focus falls back to the page body — so an element-
      // scoped listener would stop hearing the keystroke exactly when someone
      // most wants to undo what they just did.
      this.engaged = false;
      this.onPointerAnywhere = function (e) {
        self.engaged = !!(self.root && self.root.contains(e.target));
      };
      this.onKeyAnywhere = function (e) { self.onHistoryKey(e); };
      document.addEventListener('pointerdown', this.onPointerAnywhere, true);
      document.addEventListener('keydown', this.onKeyAnywhere);
    }
  };

  /**
   * Does this editor own the keyboard right now?
   *
   * Focus decides when there is any: only one editor can contain it. Otherwise
   * it falls to whichever editor was last clicked in — which is what makes the
   * shortcut work after a change that rebuilt the tree and dropped focus, and
   * what keeps five editors on one page from all reacting to one keystroke.
   */
  Editor.prototype.hasKeyboard = function () {
    if (!this.open || !this.root) return false;
    var active = document.activeElement;
    if (active && active !== document.body && this.root.contains(active)) return true;
    if (active && active !== document.body && !this.root.contains(active)) return false;
    return !!this.engaged;
  };

  /**
   * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y).
   *
   * Inside a text input the browser has its own undo stack, and there is no way
   * to ask an input whether it still has anything to undo — so the shortcut is
   * left to the browser there, and the field's own input event feeds the result
   * back into the document. Everywhere else it is ours.
   */
  Editor.prototype.onHistoryKey = function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var key = (e.key || '').toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (!this.hasKeyboard()) return;
    var target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (key === 'y' || e.shiftKey) this.redo(); else this.undo();
  };

  Editor.prototype.buildHistoryControls = function () {
    var self = this;
    var wrap = el('div', 'kce-history');
    this.historyWrap = wrap;

    this.undoButton = el('button', 'kce-btn kce-history-btn kce-undo', {
      type: 'button', text: this.labels.undo, title: this.labels.undo + ' (Ctrl+Z)'
    });
    this.redoButton = el('button', 'kce-btn kce-history-btn kce-redo', {
      type: 'button', text: this.labels.redo, title: this.labels.redo + ' (Ctrl+Shift+Z or Ctrl+Y)'
    });

    this.undoButton.addEventListener('click', function () { self.undo(); });
    this.redoButton.addEventListener('click', function () { self.redo(); });

    wrap.appendChild(this.undoButton);
    wrap.appendChild(this.redoButton);
    this.updateHistoryButtons();
    return wrap;
  };

  /**
   * The debug source panel: a "View source" button and a tabbed dump of what
   * the editor is producing. Off unless `debug: true`, because it exposes the
   * SQL column names and the whole document to whoever is looking at the page.
   */
  Editor.prototype.buildSourcePanel = function () {
    var self = this;

    this.sourceButton = el('button', 'kce-btn kce-devtools-toggle', {
      type: 'button', text: this.labels.viewSource, 'aria-expanded': 'false'
    });

    this.sourcePanel = el('div', 'kce-devtools', { hidden: 'hidden' });

    this.sourceTabs = el('div', 'kce-devtools-tabs', { role: 'tablist' });
    this.sourceBody = el('pre', 'kce-devtools-body');

    var copy = el('button', 'kce-btn kce-devtools-copy', { type: 'button', text: this.labels.copy });
    copy.addEventListener('click', function () {
      var text = self.sourceBody.textContent;
      var done = function () {
        copy.textContent = self.labels.copied;
        setTimeout(function () { copy.textContent = self.labels.copy; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var ta = el('textarea', null, { style: 'position:fixed;opacity:0' });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
      }
    });

    this.sourceTab = 'document';
    var tabs = [['document', this.labels.tabDocument], ['sql', this.labels.tabSql], ['summary', this.labels.tabSummary]];
    this.sourceTabButtons = {};
    tabs.forEach(function (pair) {
      var b = el('button', 'kce-devtools-tab' + (pair[0] === 'document' ? ' is-active' : ''), {
        type: 'button', text: pair[1], role: 'tab', 'aria-selected': String(pair[0] === 'document')
      });
      b.addEventListener('click', function () {
        self.sourceTab = pair[0];
        Object.keys(self.sourceTabButtons).forEach(function (k) {
          var active = k === pair[0];
          self.sourceTabButtons[k].classList.toggle('is-active', active);
          self.sourceTabButtons[k].setAttribute('aria-selected', String(active));
        });
        self.sync();
      });
      self.sourceTabButtons[pair[0]] = b;
      self.sourceTabs.appendChild(b);
    });

    var head = el('div', 'kce-devtools-head');
    head.appendChild(this.sourceTabs);
    head.appendChild(el('span', 'kce-spacer'));
    head.appendChild(copy);

    this.sourcePanel.appendChild(head);
    this.sourcePanel.appendChild(this.sourceBody);

    this.sourceButton.addEventListener('click', function () {
      var showing = !self.sourcePanel.hidden;
      self.sourcePanel.hidden = showing;
      self.sourceButton.textContent = showing ? self.labels.viewSource : self.labels.hideSource;
      self.sourceButton.setAttribute('aria-expanded', String(!showing));
      if (!showing) self.sync();
    });

    // The Done button always exists but is only in the footer when the editor
    // is collapsible, so it is only a valid reference point when it is actually
    // a child — otherwise insertBefore throws and the editor never renders.
    var before = this.doneButton && this.doneButton.parentNode === this.footer
      ? this.doneButton
      : null;
    this.footer.insertBefore(this.sourceButton, before);
    this.body.appendChild(this.sourcePanel);
  };

  Editor.prototype.renderSource = function (json, sql, sqlError) {
    if (!this.sourcePanel || this.sourcePanel.hidden) return;
    if (this.sourceTab === 'document') {
      this.sourceBody.textContent = json;
      return;
    }
    if (this.sourceTab === 'sql') {
      if (sqlError) {
        this.sourceBody.textContent = sqlError.message;
        return;
      }
      if (!sql) {
        this.sourceBody.textContent = 'Load k-conditions-sql.js to generate SQL.';
        return;
      }
      var out = ['WHERE ' + sql.sql];
      if (sql.params && sql.params.length) {
        out.push('', 'parameters: ' + JSON.stringify(sql.params));
      }
      out.push('', 'dialect: ' + sql.dialect);
      (sql.skipped || []).forEach(function (s) {
        out.push('skipped: ' + s.operator + ' on ' + s.field + ' (' + s.reason + ')');
      });
      (sql.warnings || []).forEach(function (w) {
        out.push('warning: ' + (w.message || w.reason));
      });
      this.sourceBody.textContent = out.join('\n');
      return;
    }
    var problems = this.validate();
    this.sourceBody.textContent = this.describe() +
      (problems.length ? '\n\nproblems:\n' + problems.map(function (p) {
        return '  · ' + p.path + ': ' + p.message;
      }).join('\n') : '');
  };

  /**
   * "Clear and start over", with the confirmation inline rather than in a
   * window.confirm: a modal dialog blocks the page, cannot be styled to match,
   * and is awkward to drive from a test. The button swaps itself for a
   * question, and Escape or a click elsewhere backs out.
   */
  Editor.prototype.buildClear = function () {
    var self = this;

    this.clearWrap = el('div', 'kce-clear');

    this.clearButton = el('button', 'kce-btn kce-clear-start', { type: 'button', text: this.labels.clear });
    this.clearPrompt = el('div', 'kce-clear-prompt', { hidden: 'hidden' });
    this.clearPrompt.appendChild(el('span', 'kce-clear-question', { text: this.labels.clearConfirm }));

    var yes = el('button', 'kce-btn kce-clear-yes', { type: 'button', text: this.labels.clearYes });
    var no = el('button', 'kce-btn kce-clear-cancel', { type: 'button', text: this.labels.clearCancel });

    function ask(on) {
      self.clearButton.hidden = on;
      self.clearPrompt.hidden = !on;
      self.clearWrap.classList.toggle('is-asking', on);
      if (on) yes.focus(); else self.clearButton.focus();
    }

    this.clearButton.addEventListener('click', function () { ask(true); });
    no.addEventListener('click', function () { ask(false); });

    yes.addEventListener('click', function () {
      self.clear();
      ask(false);
    });

    this.clearPrompt.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); ask(false); }
    });

    // Clicking anywhere else abandons the question rather than leaving it armed.
    this.clearOutside = function (e) {
      if (!self.clearWrap.hidden && !self.clearPrompt.hidden && !self.clearWrap.contains(e.target)) ask(false);
    };
    document.addEventListener('click', this.clearOutside, true);

    this.clearPrompt.appendChild(yes);
    this.clearPrompt.appendChild(no);
    this.clearWrap.appendChild(this.clearButton);
    this.clearWrap.appendChild(this.clearPrompt);
    return this.clearWrap;
  };

  /** Empty the rule back to "Always". Undoable, like any other change. */
  /**
   * The notice for content the editor could not read — see preserve().
   *
   * Built once and never rebuilt; Dismiss hides it for the life of the editor.
   * The field itself keeps the content until the first change, and with the
   * default hideTextarea the field is concealed, so this is the only place a
   * person sees what they are replacing. The text is set as textContent: field
   * content is client-supplied and must never be interpreted as markup.
   */
  Editor.prototype.buildPreserved = function () {
    var self = this;
    var wrap = el('div', 'kce-preserved', { role: 'status' });
    wrap.appendChild(el('div', 'kce-preserved-text', { text: this.labels.preservedText }));
    var source = el('pre', 'kce-preserved-source');
    source.textContent = this.preserved.text;
    wrap.appendChild(source);
    var dismiss = el('button', 'kce-btn kce-preserved-dismiss', { type: 'button', text: this.labels.preservedDismiss });
    dismiss.addEventListener('click', function () {
      wrap.hidden = true;
      // Focus would otherwise fall to the body. Land on the rule when it is
      // open, and on the Edit button when it is not.
      var next = self.open
        ? self.tree.querySelector('button:not([disabled]), input, select, textarea')
        : self.editButton;
      if (next) { try { next.focus(); } catch (e) { /* best effort */ } }
    });
    wrap.appendChild(dismiss);
    this.preservedNotice = wrap;
    return wrap;
  };

  Editor.prototype.clear = function () {
    var self = this;
    this.mutate(function () {
      self.doc.root = {
        id: nextId(),
        type: 'group',
        operator: self.options.defaultGroupOperator,
        negate: false,
        children: []
      };
    }, { render: this.open });
    this.emit('clear', this.getDocument());
    return this;
  };

  Editor.prototype.setOpen = function (open) {
    this.open = !!open && !this.options.readOnly;
    this.root.setAttribute('data-state', this.open ? 'open' : 'collapsed');
    if (this.open) this.render();
    this.emit(this.open ? 'open' : 'close', this.getDocument());
  };

  /* ------------------------------------------------------------------ *
   * History
   *
   * Every structural change funnels through mutate(), which records the state
   * that results. Text edits are different: they fire on each keystroke and
   * deliberately do not re-render, so snapshotting per keystroke would give
   * one-character undo. Those go through noteEdit() instead, which coalesces a
   * run of typing in one field into a single entry — committed when the typing
   * pauses, when focus leaves, or when anything else happens.
   * ------------------------------------------------------------------ */

  Editor.prototype.pushHistory = function () {
    var h = this.history;
    if (!h || h.applying) return this;
    var json = JSON.stringify(this.getDocument());
    if (h.at >= 0 && json === h.stack[h.at]) return this;
    h.stack.length = h.at + 1;
    h.stack.push(json);
    if (h.stack.length > h.limit) h.stack.shift();
    h.at = h.stack.length - 1;
    this.updateHistoryButtons();
    return this;
  };

  /**
   * Note that a text field changed. The entry is not written until the burst
   * ends, so a typed word is one undo step rather than five.
   */
  Editor.prototype.noteEdit = function (key) {
    var h = this.history;
    if (!h || h.applying) return this;
    if (h.burstKey && h.burstKey !== key) this.flushEdit();
    h.burstKey = key;
    var self = this;
    if (h.burstTimer) clearTimeout(h.burstTimer);
    h.burstTimer = setTimeout(function () { self.flushEdit(); }, h.idle);
    this.updateHistoryButtons();
    return this;
  };

  /** Close off any run of typing and commit it as one history entry. */
  Editor.prototype.flushEdit = function () {
    var h = this.history;
    if (!h || !h.burstKey) return this;
    if (h.burstTimer) { clearTimeout(h.burstTimer); h.burstTimer = null; }
    h.burstKey = null;
    return this.pushHistory();
  };

  /**
   * The first change a person makes.
   *
   * A field the editor could not read is left exactly as it was — see
   * preserve() — and sync() skips writing to it while `pristine` is set. The
   * first real change ends that; from then on the field carries the editor's
   * output like any other. Only paths a person drives call this: mutate(),
   * setValue(), commitValue(), setDocument() and undo/redo. The constructor,
   * opening, re-skinning and rendering do not, or an untouched form would
   * submit a destroyed rule. It is one-way on purpose: undoing back to the
   * empty rule does not bring the old content back, because by then the
   * person has seen the notice and chosen to replace it.
   */
  Editor.prototype.touch = function () {
    if (this.pristine) this.pristine = false;
    return this;
  };

  /**
   * A value edit that does not go through mutate(): the chip inputs and the
   * field-value select change the document in place and record one entry.
   * One name for that pair, so the list of paths that bypass mutate() — and
   * must still count as a change for touch() — is this method alone.
   */
  Editor.prototype.commitValue = function () {
    this.touch();
    this.sync();
    this.pushHistory();
    return this;
  };

  /**
   * Apply a change to the document and record it.
   *
   * `opts.render: false` syncs without rebuilding the DOM — for changes that
   * cannot alter the layout. `opts.focus` names the control to land on
   * afterwards, for moves, where the position-based focus key of the thing you
   * were on has changed under you. `opts.announce: false` keeps quiet about
   * brackets the change merged away — see announceTidy().
   */
  Editor.prototype.mutate = function (fn, opts) {
    opts = opts || {};
    this.flushEdit();
    if (fn.call(this) === false) return this;
    var tidied = this.dropRedundantGroups();
    this.dismissTidyNote();
    this.touch();
    if (typeof opts.focus === 'function') this.focusOverride = opts.focus.call(this);
    else if (opts.focus) this.focusOverride = opts.focus;
    // render() is a no-op while collapsed, so the sync has to happen either way.
    if (opts.render === false || !this.open) this.sync();
    else this.render();
    this.focusOverride = null;
    // Recorded after the render, not before: rendering can settle the document
    // itself — an empty enum value takes the first choice as it draws — and a
    // snapshot taken beforehand would be of a state that never existed.
    this.pushHistory();
    // Brackets went that the person did not take out themselves: say so where
    // it happened, with the way back. `announce: false` is for a change whose
    // own plan is to merge them (wrapAndContinue).
    if (opts.announce !== false && tidied.dropped.length) this.announceTidy(tidied);
    return this;
  };

  Editor.prototype.canUndo = function () { return !!(this.history && this.history.at > 0); };
  Editor.prototype.canRedo = function () {
    return !!(this.history && this.history.at < this.history.stack.length - 1);
  };

  Editor.prototype.undo = function () {
    this.flushEdit();
    if (!this.canUndo()) return this;
    this.history.at -= 1;
    return this.applyHistory('undo');
  };

  Editor.prototype.redo = function () {
    this.flushEdit();
    if (!this.canRedo()) return this;
    this.history.at += 1;
    return this.applyHistory('redo');
  };

  Editor.prototype.applyHistory = function (direction) {
    var h = this.history;
    this.touch();
    this.dismissTidyNote();
    h.applying = true;
    try {
      var parsed = KConditions.normaliseDocument(h.stack[h.at]);
      this.doc = {
        version: parsed.version,
        generator: parsed.generator,
        operators: parsed.operators,
        root: parsed.root
      };
      if (this.open) this.render(); else this.sync();
    } finally {
      h.applying = false;
    }
    this.updateHistoryButtons();
    this.emit(direction, this.getDocument());
    return this;
  };

  Editor.prototype.updateHistoryButtons = function () {
    if (this.undoButton) this.undoButton.disabled = !this.canUndo();
    if (this.redoButton) this.redoButton.disabled = !this.canRedo();
  };

  /* ------------------------------------------------------------------ *
   * Mutations
   *
   * Everything that changes the document goes through one of these, so the
   * history layer has exactly one place to hook and reordering has a primitive
   * to build on.
   * ------------------------------------------------------------------ */

  /**
   * Take out the brackets that do nothing.
   *
   * Removing the sibling of a group used to leave that group alone inside its
   * own brackets — `(a OR b) AND c`, less `c`, drew `((a OR b))` — and flipping
   * a group's AND / OR to match its parent's left `a AND (b AND c)`. Neither
   * bracket changes the result, and both make a rule read as more nested than
   * it is. Three shapes go, wherever they are in the tree:
   *
   * - a group of one stands aside for its only child;
   * - a group using its parent's AND / OR gives its children to the parent;
   * - an empty group goes (the evaluator and SQL skip it already).
   *
   * Brackets carrying a NOT are not redundant, so a negated group stays — but
   * a group of one hands its NOT to its child where the child can carry one the
   * person can still switch off (a group, or a condition with
   * allowConditionNegate). The root stays the root: it adopts a lone group
   * child's operator and children rather than being replaced by it.
   *
   * Run on every path that brings a document in or changes its shape — load,
   * setDocument() and mutate() — so a redundant bracket is gone the moment it
   * would appear, rather than each mutation having to avoid making one.
   * Nothing here changes what the rule evaluates to.
   *
   * Reports what it did: `dropped`, the groups whose brackets went, and
   * `lifted`, the nodes that came out of them — which the preview, the note
   * and the tint after a change are all drawn from.
   */
  function tidyTree(root, opts) {
    var dropped = [];
    var lifted = [];
    var opOf = function (g) { return g.operator === 'or' ? 'or' : 'and'; };
    var canNegate = function (n) {
      return n.type === 'group' ? !!opts.allowGroupNegate : !!opts.allowConditionNegate;
    };

    function tidy(group) {
      var kids = Array.isArray(group.children) ? group.children : [];
      var out = [];
      for (var i = 0; i < kids.length; i++) {
        var child = kids[i];
        if (child && child.type === 'group') {
          tidy(child);
          var inner = Array.isArray(child.children) ? child.children : [];
          if (!inner.length) { dropped.push(child); continue; }
          if (inner.length === 1 && (!child.negate || inner[0].negate || canNegate(inner[0]))) {
            if (child.negate) inner[0].negate = !inner[0].negate;
            dropped.push(child);
            lifted.push(inner[0]);
            child = inner[0];
          }
          if (child.type === 'group' && !child.negate && opOf(child) === opOf(group)) {
            dropped.push(child);
            lifted.push.apply(lifted, child.children);
            out.push.apply(out, child.children);
            continue;
          }
        }
        out.push(child);
      }
      // In place: callers may still hold this array.
      if (Array.isArray(group.children)) Array.prototype.splice.apply(group.children, [0, kids.length].concat(out));
    }

    if (root && root.type === 'group' && Array.isArray(root.children)) {
      tidy(root);
      var only = root.children.length === 1 ? root.children[0] : null;
      if (only && only.type === 'group' && !only.negate) {
        dropped.push(only);
        lifted.push.apply(lifted, only.children);
        root.operator = opOf(only);
        root.children = only.children;
      }
    }
    return { dropped: dropped, lifted: lifted };
  }

  /** Tidy the document in hand, and say what went. See tidyTree(). */
  Editor.prototype.dropRedundantGroups = function () {
    return tidyTree(this.doc && this.doc.root, this.options);
  };

  /**
   * The bracketed groups a change would leave with nothing to do: the ones
   * dropRedundantGroups() would take out straight after it.
   *
   * Worked out by making the change to a copy and tidying that, with the same
   * two functions the click runs, so what a preview marks cannot drift from
   * what the click does. `change` receives `find`, which maps a node on
   * screen to its copy. Returns the groups' node ids.
   */
  Editor.prototype.planTidy = function (change) {
    var root = this.doc && this.doc.root;
    if (!root) return [];
    var copy = JSON.parse(JSON.stringify(root));
    var byId = {};
    (function index(n) {
      if (!n || typeof n !== 'object') return;
      if (n.id) byId[n.id] = n;
      if (Array.isArray(n.children)) n.children.forEach(index);
    })(copy);
    var find = function (node) { return node ? byId[node.id] : null; };
    if (change(find) === false) return [];
    return tidyTree(copy, this.options).dropped.map(function (g) { return g.id; });
  };

  /*
   * The changes that can leave brackets with nothing to do, as plain
   * functions of the nodes they touch: the click runs them on the document,
   * and planTidy() runs them on a copy for the preview. Each returns false
   * when it would change nothing.
   */
  function removeChild(parent, node) {
    var i = parent && node ? parent.children.indexOf(node) : -1;
    if (i === -1) return false;
    parent.children.splice(i, 1);
  }

  function switchOperator(group, op) {
    var next = op === 'or' ? 'or' : 'and';
    if (!group || (group.operator === 'or' ? 'or' : 'and') === next) return false;
    group.operator = next;
  }

  function negateNode(node, on) {
    if (!node || !!node.negate === !!on) return false;
    node.negate = !!on;
  }

  Editor.prototype.removeNode = function (node, parent) {
    return this.mutate(function () { return removeChild(parent, node); });
  };

  Editor.prototype.setGroupOperator = function (group, op) {
    return this.mutate(function () { return switchOperator(group, op); });
  };

  Editor.prototype.setNegate = function (node, on) {
    return this.mutate(function () { return negateNode(node, on); });
  };

  Editor.prototype.setField = function (node, name) {
    var self = this;
    return this.mutate(function () {
      node.field = name;
      var previousOp = node.operator;
      var ops = self.operatorsForField(self.fieldIndex[node.field] || {});
      if (ops.indexOf(node.operator) === -1) node.operator = ops[0] || '';
      node.values = self.remapValues(node.values, previousOp, node.operator);
    });
  };

  Editor.prototype.setOperator = function (node, name) {
    var self = this;
    return this.mutate(function () {
      var previousOp = node.operator;
      node.operator = name;
      node.values = self.remapValues(node.values, previousOp, node.operator);
    });
  };

  Editor.prototype.setValueSource = function (node, index, source, fallbackField) {
    return this.mutate(function () {
      node.values[index] = source === 'field'
        ? { source: 'field', field: fallbackField || '' }
        : { source: 'literal', value: '' };
    });
  };

  /**
   * Set a literal value. `burstKey` marks it as a keystroke in a run of typing,
   * which is coalesced into one history entry; without it the change is
   * committed on its own, which is what a dropdown or a chip wants.
   */
  Editor.prototype.setValue = function (value, v, burstKey) {
    value.value = v;
    this.touch();
    this.sync();
    if (burstKey) this.noteEdit(burstKey); else this.pushHistory();
    return this;
  };

  /* ------------------------------------------------------------------ *
   * Reordering
   *
   * Note that sibling order is presentational today: evalGroup evaluates every
   * child and accumulates, with no short-circuiting, so neither the result nor
   * which callbacks run depends on it. This is for readability.
   * ------------------------------------------------------------------ */

  Editor.prototype.moveChild = function (group, from, to) {
    var kids = group.children || [];
    if (from === to || from < 0 || from >= kids.length || to < 0 || to >= kids.length) return this;
    return this.mutate(function () {
      kids.splice(to, 0, kids.splice(from, 1)[0]);
    }, {
      // Focus keys are position-based, so without this the keyboard lands on
      // whatever row just took the old position instead of following the move.
      focus: function () { return group.id + '.' + to + ':move-' + (to < from ? 'up' : 'down'); }
    });
  };

  /** Move a child to an insertion boundary (0…n), as a drop reports it. */
  Editor.prototype.moveToBoundary = function (group, from, boundary) {
    var to = boundary > from ? boundary - 1 : boundary;
    return this.moveChild(group, from, to);
  };

  /* ------------------------------------------------------------------ *
   * Showing what a removal would take
   *
   * A × on a group takes everything inside it, which is not obvious from a
   * small button sitting at the end of one line — especially in the prose
   * layout, where a group is a range of lines rather than a visible box. So
   * pointing at a × tints exactly what would go.
   * ------------------------------------------------------------------ */

  /**
   * Every element belonging to a node or anything beneath it.
   *
   * Node ids are paths, so "is this element inside that subtree" is a string
   * prefix test — `r.1.0` is under `r.1`, and `r.10` is not (the dot is
   * required). Elements nested inside another match are dropped, so the tint
   * never stacks on itself.
   */
  Editor.prototype.subtreeTargets = function (node) {
    var id = node.id;
    var all = Array.prototype.filter.call(this.tree.querySelectorAll('[data-node]'), function (elm) {
      var owner = elm.getAttribute('data-node');
      return owner === id || owner.indexOf(id + '.') === 0;
    });
    return all.filter(function (elm) {
      return !all.some(function (other) { return other !== elm && other.contains(elm); });
    });
  };

  /**
   * Everything a preview marks: the nodes' own elements, and the operators
   * that belong with them. Every preview style paints exactly this set — the
   * styles differ in how, never in what — so they cannot disagree about what a
   * button affects.
   *
   * `nodes` are siblings in `group` (or a lone node). Two kinds of connector
   * join the set, because connectors are tagged by group (`data-conn-group`)
   * rather than by node and `subtreeTargets()` cannot see them: the ones inside
   * an enclosed subgroup, and the ones *between* two enclosed siblings. The
   * latter is what an `AND(…)` / `OR(…)` preview left out until 0.0.27 — the
   * operators that end up inside the new bracket.
   *
   * A group's tool strip is a set of controls, not part of the rule, and is
   * left out. Connector buttons are marked rather than their wrappers, which in
   * the tree layout also hold the add buttons — including the hovered one.
   */
  Editor.prototype.previewTargets = function (nodes, group) {
    var self = this;
    var out = [];
    var ids = [];
    (nodes || []).forEach(function (node) {
      if (!node) return;
      ids.push(node.id);
      self.subtreeTargets(node).forEach(function (elm) {
        if (!elm.classList.contains('kce-group-tools')) out.push(elm);
      });
    });
    var kids = group && Array.isArray(group.children) ? group.children : [];
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-connector[data-conn-group]'), function (conn) {
      var owner = conn.getAttribute('data-conn-group');
      var inside = ids.some(function (id) { return owner === id || owner.indexOf(id + '.') === 0; });
      var between = false;
      if (!inside && group && owner === group.id) {
        var i = parseInt(conn.getAttribute('data-conn-index'), 10) || 0;
        between = nodes.indexOf(kids[i]) !== -1 && nodes.indexOf(kids[i + 1]) !== -1;
      }
      if (!inside && !between) return;
      var btn = conn.querySelector('.kce-connector-btn');
      if (btn && !out.some(function (o) { return o.contains(btn); })) out.push(btn);
    });
    return out;
  };

  /** The preview style in force. */
  Editor.prototype.previewStyle = function () {
    return previewStyleOf(this.options.previewStyle);
  };

  /**
   * Mark a set of elements in the current preview style. `classes` carry the
   * hue (`kce-will-group is-and`, `kce-will-remove`, …), which the stylesheet
   * turns into --kce-mark. `extra` joins the range without being marked — the
   * ghost row, when the new condition lands inside the bracket.
   */
  Editor.prototype.paintPreview = function (targets, classes, extra) {
    targets.forEach(function (elm) {
      classes.forEach(function (c) { elm.classList.add(c); });
    });
    var style = this.previewStyle();
    if (style === 'fade') this.tree.classList.add('kce-previewing');
    if (style === 'bar' || style === 'region') this.drawPreviewMark(targets.concat(extra || []), classes, style);
    return this;
  };

  /**
   * One shape for the whole range, measured rather than styled per element: a
   * range spans lines and siblings, and a mark on each element is exactly the
   * stack of ragged boxes the highlight style draws. Absolutely positioned and
   * pointer-transparent, so nothing moves and the button keeps the pointer.
   */
  Editor.prototype.drawPreviewMark = function (elements, classes, style) {
    var box = this.rangeBox(elements);
    if (!box) return this;
    var x = box.x, y = box.y, w = box.w, h = box.h;
    var mark = el('div', 'kce-preview-mark ' + classes.join(' '), { 'aria-hidden': 'true' });
    if (style === 'bar') {
      // In the margin, clear of the text — but never left of the tree, which
      // clips at depth 0.
      x = Math.max(0, x - 8);
      w = 3;
    } else {
      x = Math.max(0, x - 4);
      y -= 2;
      w += 8;
      h += 4;
    }
    mark.style.left = x + 'px';
    mark.style.top = y + 'px';
    mark.style.width = w + 'px';
    mark.style.height = h + 'px';
    this.tree.appendChild(mark);
    return this;
  };

  /**
   * The box around a range of elements, in the tree's own coordinates — what
   * the bar, the region and the tint after a change are all drawn from.
   */
  Editor.prototype.rangeBox = function (elements) {
    var tree = this.tree;
    var top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    function inRange(elm) {
      return elements.some(function (e) { return e === elm || e.contains(elm); });
    }
    // In the flow layout a group's opening bracket (and its NOT) shares a line
    // with the sibling before it — `State is FL AND (`. Measured, it would pull
    // the shape up over a row the range does not include. Such a bracket is
    // still marked; it just does not set the extent.
    function sharesLine(elm) {
      if (!/(^|\s)(kce-paren-open|kce-negate-marker)(\s|$)/.test(elm.className || '')) return false;
      var line = elm.parentNode;
      if (!line || !/(^|\s)kce-line(\s|$)/.test(line.className || '')) return false;
      return Array.prototype.some.call(line.querySelectorAll('.kce-condition'), function (c) { return !inRange(c); });
    }
    elements.forEach(function (elm) {
      if (sharesLine(elm)) return;
      var r = elm.getBoundingClientRect();
      if (!r.width && !r.height) return;
      if (r.top < top) top = r.top;
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
      if (r.bottom > bottom) bottom = r.bottom;
    });
    if (top === Infinity) return null;
    var base = tree.getBoundingClientRect();
    return {
      x: left - base.left - tree.clientLeft + tree.scrollLeft,
      y: top - base.top - tree.clientTop + tree.scrollTop,
      w: right - left,
      h: bottom - top
    };
  };

  Editor.prototype.showRemoval = function (node, on) {
    // Always clear first. A mouseleave can be missed — the pointer can end up
    // over an element that has just been replaced — and a tint that outlives
    // its cause would be a standing lie about what the next click does.
    this.clearPreview();
    if (!on) return this;
    var parent = this.parentOf(node);
    this.paintPreview(this.previewTargets([node], null), ['kce-will-remove']);
    // Taking a child out can leave its group with one thing in it, whose
    // brackets then go too. That is the half of the click a tint on the
    // removed rows cannot show.
    return this.markTidy(this.planTidy(function (find) { return removeChild(find(parent), find(node)); }));
  };

  /** Drop every preview — the removal tint, the grouping tint and the ghost. */
  Editor.prototype.clearPreview = function () {
    if (!this.tree) return this;
    Array.prototype.forEach.call(
      this.tree.querySelectorAll('.kce-will-remove, .kce-will-group'),
      function (elm) {
        elm.classList.remove('kce-will-remove');
        elm.classList.remove('kce-will-group');
        elm.classList.remove('is-and');
        elm.classList.remove('is-or');
      }
    );
    var hadGhost = false;
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-ghost-line, .kce-ghost, .kce-preview-mark'), function (elm) {
      if (/(^|\s)kce-ghost/.test(elm.className)) hadGhost = true;
      if (elm.parentNode) elm.parentNode.removeChild(elm);
    });
    this.tree.classList.remove('kce-previewing');
    this.ghostOwner = null;
    this.tidyMarks = null;
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-will-unbracket'), function (elm) {
      elm.classList.remove('kce-will-unbracket');
    });
    if (hadGhost) {
      this.positionGuides();
      this.placeTidyNote();
    }
    return this;
  };

  /**
   * Show what an add button would do: tint the rows that end up bracketed
   * together, and put a dashed placeholder where the new condition lands.
   *
   * The ghost is inserted after the line the button itself sits on, never
   * before it. That is where the new row goes in every case but one, and it
   * guarantees the button cannot move out from under the pointer — which would
   * fire mouseleave, remove the ghost, move the button back, and flicker.
   */
  Editor.prototype.previewPlan = function (plan, btn) {
    this.clearPreview();
    if (!plan || !this.open) return this;
    var hue = plan.op === 'or' ? 'is-or' : 'is-and';
    // Gathered before the ghost goes in; painted after, so anything measured
    // (the bar, the region) measures the layout the ghost has already shifted.
    var targets = this.previewTargets(plan.enclosed || [], plan.group);

    var host = btn;
    while (host && host !== this.tree &&
           !/(^|\s)(kce-line|kce-connector|kce-condition)(\s|$)/.test(host.className || '')) {
      host = host.parentNode;
    }
    var ghost = null;
    if (host && host !== this.tree) {
      var ghostOp = (plan.ghostOp || plan.op) === 'or' ? 'or' : 'and';
      ghost = el('div', 'kce-ghost is-' + ghostOp, { 'aria-hidden': 'true' });
      if (this.previewStyle() === 'highlight') {
        ghost.appendChild(el('span', null, { text: this.labels.ghostCondition }));
      } else {
        // Written the way the rule will read: the operator that joins it, then
        // a placeholder for the condition itself.
        ghost.classList.add('kce-ghost-text');
        ghost.appendChild(el('span', 'kce-ghost-op', { text: this.labels[ghostOp] }));
        ghost.appendChild(el('span', 'kce-ghost-label', { text: this.labels.ghostCondition }));
      }
      if (this.layout() === 'flow') {
        var line = el('div', 'kce-line kce-ghost-line');
        line.style.paddingLeft = host.style.paddingLeft;
        line.appendChild(ghost);
        // The button's strip may be hanging just below its line — exactly
        // where the ghost goes. The ghost goes below the strip instead.
        var strip = host.querySelector(':scope > .kce-adds-below');
        if (strip) line.style.marginTop = strip.offsetHeight + 'px';
        host.parentNode.insertBefore(line, host.nextSibling);
      } else {
        host.parentNode.insertBefore(ghost, host.nextSibling);
      }
    }

    // A new condition that lands inside the bracket belongs in the range; one
    // that lands beside it (AND(…) / OR(…)) does not.
    // The ghost line shifts the lines below it; the guides follow — and only
    // the groups the new condition will belong to (its group and those around
    // it) may take the ghost into their guide.
    this.ghostOwner = plan.group ? plan.group.id : null;
    this.positionGuides();
    this.placeTidyNote();

    // The ghost joins the range only when it sits against the rows it joins.
    // Where it cannot — `extend` puts it one line low, after the group's `)`,
    // because above it would move the button from under the pointer — a bar
    // or region stretched to reach it would cross whatever is on the lines in
    // between, the `)` and its add buttons among them.
    var extra = null;
    if (ghost && !plan.outside) {
      var holder = this.layout() === 'flow' ? ghost.parentNode : ghost;
      var before = holder.previousElementSibling;
      var adjacent = !!before && targets.some(function (t) { return t === before || before.contains(t) || t.contains(before); });
      if (adjacent) extra = [ghost];
    }
    return this.paintPreview(targets, ['kce-will-group', hue], extra);
  };

  /** Wire an add button to preview itself, by pointer and by focus. */
  Editor.prototype.bindAddPreview = function (btn, planFn) {
    var self = this;
    function on() { self.previewPlan(planFn(), btn); }
    function off() { self.clearPreview(); }
    btn.addEventListener('mouseenter', on);
    btn.addEventListener('mouseleave', off);
    btn.addEventListener('focus', on);
    btn.addEventListener('blur', off);
    btn.addEventListener('click', off);
  };

  /** Wire a remove button to preview its own damage, by pointer and by focus. */
  Editor.prototype.bindRemovalPreview = function (btn, node) {
    var self = this;
    function on() { self.showRemoval(node, true); }
    function off() { self.showRemoval(node, false); }
    btn.addEventListener('mouseenter', on);
    btn.addEventListener('mouseleave', off);
    btn.addEventListener('focus', on);
    btn.addEventListener('blur', off);
  };

  /* ------------------------------------------------------------------ *
   * Showing brackets a change would leave with nothing to do
   *
   * Switching a group to its parent's AND / OR merges it into the parent, and
   * switching it back then switches the parent: the grouping is gone. A ×
   * can leave its group holding one thing, whose brackets go too. Neither is
   * visible from the button, so pointing at it marks the brackets that will
   * not survive the click.
   * ------------------------------------------------------------------ */

  /**
   * Mark the brackets of the groups `ids` as about to go: in the flow layout
   * the `(` and `)` and the group's guide, in the tree layout the group's box,
   * whose skin draws its brackets.
   *
   * The same in every preview style. A style paints which rows a button
   * touches; this is a different fact, which brackets will not survive, and
   * it shows alongside whatever the style paints.
   */
  Editor.prototype.markTidy = function (ids) {
    var tree = this.tree;
    this.tidyMarks = ids && ids.length ? ids.slice() : null;
    if (!tree || !this.tidyMarks) return this;
    this.tidyMarks.forEach(function (id) {
      var sel = '[data-node="' + id + '"]';
      Array.prototype.forEach.call(
        tree.querySelectorAll('.kce-paren' + sel + ', .kce-group' + sel + ', .kce-guide[data-group="' + id + '"]'),
        function (elm) { elm.classList.add('kce-will-unbracket'); }
      );
    });
    return this;
  };

  /**
   * Wire a control whose change can merge groups to preview that, by pointer
   * and by focus. `change` is the change itself, given `find` (see planTidy).
   * Focus is heard as focusin, so a label wrapping a checkbox can carry it.
   */
  Editor.prototype.bindTidyPreview = function (target, change) {
    var self = this;
    function on() {
      self.clearPreview();
      if (self.open) self.markTidy(self.planTidy(change));
    }
    function off() { self.clearPreview(); }
    target.addEventListener('mouseenter', on);
    target.addEventListener('mouseleave', off);
    target.addEventListener('focusin', on);
    target.addEventListener('focusout', off);
  };

  /* ------------------------------------------------------------------ *
   * After brackets go: a tint where the rows moved, and a note with Undo
   *
   * The preview says it before the click; these say it after, for whoever
   * clicked without looking — and put the way back beside the change rather
   * than only in the footer, which on a long rule is off the screen.
   * ------------------------------------------------------------------ */

  /** How long the tint takes to fade, and how long the note stays unattended. */
  var TIDY_FLASH_MS = 1600;
  var TIDY_NOTE_MS = 8000;

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Called by mutate() after the render, with what dropRedundantGroups()
   * reported. The nodes that came out of the dropped groups are found again
   * in the rule as it now stands, as runs of adjacent siblings, so the tint
   * is one shape per run rather than a box per row.
   */
  Editor.prototype.announceTidy = function (result) {
    if (!this.open || !this.tree) return this;
    var lifted = result.lifted;
    var runs = [];
    (function walk(group) {
      var kids = Array.isArray(group.children) ? group.children : [];
      for (var i = 0; i < kids.length; i++) {
        if (lifted.indexOf(kids[i]) !== -1) {
          var run = runs[runs.length - 1];
          if (run && run.group === group && run.end === i - 1) {
            run.nodes.push(kids[i]);
            run.end = i;
          } else {
            runs.push({ group: group, nodes: [kids[i]], end: i });
          }
          // Its subtree is in the run already.
          continue;
        }
        if (kids[i] && kids[i].type === 'group') walk(kids[i]);
      }
    })(this.doc.root);
    if (!runs.length) return this;
    this.flashRuns(runs);
    this.showTidyNote(runs[0]);
    if (this.liveRegion) this.liveRegion.textContent = this.labels.bracketsRemoved;
    return this;
  };

  /**
   * Tint each run in its new group's AND / OR colour, fading out. Drawn over
   * the rows like the region preview, and as transparent to the pointer.
   */
  Editor.prototype.flashRuns = function (runs) {
    var self = this;
    var tree = this.tree;
    runs.forEach(function (run) {
      var box = self.rangeBox(self.previewTargets(run.nodes, run.group));
      if (!box) return;
      var mark = el('div', 'kce-flash is-' + (run.group.operator === 'or' ? 'or' : 'and'), { 'aria-hidden': 'true' });
      mark.style.left = Math.max(0, box.x - 4) + 'px';
      mark.style.top = (box.y - 2) + 'px';
      mark.style.width = (box.w + 8) + 'px';
      mark.style.height = (box.h + 4) + 'px';
      tree.appendChild(mark);
    });
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(function () {
      self.flashTimer = null;
      Array.prototype.forEach.call(tree.querySelectorAll('.kce-flash'), function (m) {
        if (m.parentNode) m.parentNode.removeChild(m);
      });
    }, TIDY_FLASH_MS);
    return this;
  };

  /**
   * "Removed unneeded brackets · Undo", beside the first run of rows that
   * moved (`run` as announceTidy() finds it). It goes on the next change, or after TIDY_NOTE_MS — a wait
   * that stops while the note is pointed at or focused, so it never leaves
   * from under someone reaching for it.
   */
  Editor.prototype.showTidyNote = function (run) {
    var self = this;
    this.dismissTidyNote();
    var note = el('div', 'kce-tidy-note');
    note.appendChild(el('span', 'kce-tidy-note-text', { text: this.labels.bracketsRemoved }));
    if (this.history) {
      var undo = el('button', 'kce-tidy-note-undo', { type: 'button', text: this.labels.undo });
      undo.addEventListener('click', function () { self.undo(); });
      note.appendChild(undo);
    }
    var hold = function () { if (self.tidyNoteTimer) { clearTimeout(self.tidyNoteTimer); self.tidyNoteTimer = null; } };
    var release = function (e) {
      if (self.tidyNote !== note) return;
      if (e && e.relatedTarget && note.contains(e.relatedTarget)) return;
      if (note.contains(document.activeElement) || note.matches(':hover')) return;
      self.armTidyNote();
    };
    note.addEventListener('mouseenter', hold);
    note.addEventListener('focusin', hold);
    note.addEventListener('mouseleave', release);
    note.addEventListener('focusout', release);
    this.tidyNote = note;
    this.tidyRun = run || null;
    this.placeTidyNote();
    this.armTidyNote();
    return this;
  };

  Editor.prototype.armTidyNote = function () {
    var self = this;
    if (this.tidyNoteTimer) clearTimeout(this.tidyNoteTimer);
    this.tidyNoteTimer = setTimeout(function () {
      self.tidyNoteTimer = null;
      self.dismissTidyNote(true);
    }, TIDY_NOTE_MS);
  };

  /** Take the note away — at once, or faded when it has simply timed out. */
  Editor.prototype.dismissTidyNote = function (fade) {
    if (this.tidyNoteTimer) clearTimeout(this.tidyNoteTimer);
    this.tidyNoteTimer = null;
    var note = this.tidyNote;
    if (!note) return this;
    this.tidyNote = null;
    this.tidyRun = null;
    if (this.liveRegion) this.liveRegion.textContent = '';
    var drop = function () { if (note.parentNode) note.parentNode.removeChild(note); };
    if (fade && !prefersReducedMotion()) {
      note.classList.add('is-leaving');
      setTimeout(drop, 250);
    } else {
      drop();
    }
    return this;
  };

  /**
   * Beside the change where there is room for it, in the footer by Undo
   * where there is not.
   *
   * Beside means level with one of the moved rows or their AND / OR — the
   * first, in reading order, with room — and past everything already there.
   * With the AND / OR below each row, its row is nearly empty, so that is
   * usually where it lands. "Everything already there" is everything the
   * note's own height would cross, including what only appears when a line
   * is hovered: a strip held at zero width is measured at its full width
   * (scrollWidth). The note is no taller than the gap between two rows, so it
   * can sit level with an AND / OR between them; its Undo reaches 24px with a
   * transparent ::before, as the AND / OR do. Nothing may land on a control,
   * so a note that fits
   * nowhere inside the tree goes to the footer. The tree layout's rows are
   * boxes that run the full width, so there it is always the footer.
   * Re-run on every layout pass and whenever a ghost line comes or goes.
   */
  Editor.prototype.placeTidyNote = function () {
    var note = this.tidyNote;
    var tree = this.tree;
    var run = this.tidyRun;
    if (!note || !tree) return this;
    if (this.layout() === 'flow' && run) {
      note.classList.add('kce-tidy-note-float');
      if (note.parentNode !== tree) tree.appendChild(note);
      var base = tree.getBoundingClientRect();
      var w = note.offsetWidth, h = note.offsetHeight;
      // What it must not land on: the controls and text in the lines, not the
      // rows that hold them, with the 1px slack no-overlaps.js allows.
      var inLines = Array.prototype.filter.call(tree.querySelectorAll('.kce-line *'), function (elm) {
        return !elm.firstElementChild || /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(elm.tagName);
      }).map(function (elm) {
        var r = elm.getBoundingClientRect();
        return { top: r.top + 1, bottom: r.bottom - 1, right: r.left + Math.max(r.width, elm.scrollWidth || 0), empty: !r.width && !r.height && !elm.scrollWidth };
      }).filter(function (r) { return !r.empty; });
      var spots = this.previewTargets(run.nodes, run.group).reduce(function (all, t) {
        if (t.matches('.kce-condition, .kce-connector-btn')) all.push(t);
        return all.concat(Array.prototype.slice.call(t.querySelectorAll('.kce-condition, .kce-connector-btn')));
      }, []).map(function (t) { return t.getBoundingClientRect(); })
        .filter(function (r) { return r.height; })
        .sort(function (a, b) { return a.top - b.top || a.left - b.left; });
      for (var i = 0; i < spots.length; i++) {
        var top = spots[i].top + (spots[i].height - h) / 2;
        var bottom = top + h;
        var reach = spots[i].right;
        inLines.forEach(function (r) {
          if (r.bottom > top && r.top < bottom && r.right > reach) reach = r.right;
        });
        var left = reach - base.left - tree.clientLeft + tree.scrollLeft + 16;
        if (left + w <= tree.clientWidth) {
          note.style.left = left + 'px';
          note.style.top = (top - base.top - tree.clientTop + tree.scrollTop) + 'px';
          return this;
        }
      }
    }
    note.classList.remove('kce-tidy-note-float');
    note.style.left = '';
    note.style.top = '';
    if (this.footer && note.parentNode !== this.footer) {
      this.footer.insertBefore(note, this.historyWrap || this.messages.nextSibling);
    }
    return this;
  };

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  /* Skins whose layout is a sequence of indented lines rather than a tree of
     nested boxes. These need a different DOM, not just different CSS: an
     inline formatting context cannot indent wrapped lines, and a nested block
     structure cannot put ") AND (" on one line. */
  var FLOW_SKINS = { prose: true };

  Editor.prototype.layout = function () {
    if (this.options.layout) return this.options.layout;
    return FLOW_SKINS[this.options.skin] ? 'flow' : 'tree';
  };

  /**
   * Node ids are the node's position in the tree, reassigned on every render.
   *
   * They are stripped from the output, so nothing outside depends on them —
   * and making them positional means a control's focus key survives a
   * re-render, including the wholesale rebuild an undo performs.
   */
  Editor.prototype.assignPathIds = function (node, path) {
    node.id = path;
    if (!node.children) return;
    for (var i = 0; i < node.children.length; i++) {
      this.assignPathIds(node.children[i], path + '.' + i);
    }
  };

  /** Remember which control has focus, and where the caret sits inside it. */
  Editor.prototype.captureFocus = function () {
    var active = document.activeElement;
    if (!active || !this.tree.contains(active)) return null;
    var key = active.getAttribute && active.getAttribute('data-fk');
    if (!key) return null;
    var sel = null;
    try {
      if (active.selectionStart !== undefined && active.selectionStart !== null) {
        sel = [active.selectionStart, active.selectionEnd];
      }
    } catch (e) { /* selection is not readable on every input type */ }
    return { key: key, sel: sel };
  };

  Editor.prototype.restoreFocus = function (snap) {
    if (!snap || !snap.key) return;
    var node = this.tree.querySelector('[data-fk="' + snap.key.replace(/"/g, '\\"') + '"]');
    if (!node || node.disabled) return;
    try {
      node.focus({ preventScroll: true });
      if (snap.sel && node.setSelectionRange) node.setSelectionRange(snap.sel[0], snap.sel[1]);
    } catch (e) { /* focus is best effort */ }
  };

  Editor.prototype.render = function () {
    if (!this.open) return;
    var focus = this.focusOverride ? { key: this.focusOverride, sel: null } : this.captureFocus();
    this.assignPathIds(this.doc.root, 'r');
    this.tree.innerHTML = '';
    this.flowLines = null;
    this.flowSpans = null;
    this.flowTools = null;
    if (this.layout() === 'flow') this.renderFlow();
    else this.tree.appendChild(this.renderGroup(this.doc.root, null, 0));
    this.sync();
    this.restoreFocus(focus);
  };

  /**
   * Render the rule the way a formatter prints an expression: one line per
   * condition, indented by nesting depth, with an opening bracket trailing the
   * connector that introduced it and a closing bracket on its own line.
   *
   *     Name matches regex "^ben" AND (
   *         Date of Birth is before 1980 OR (
   *             Date of Birth is before 1982 AND
   *             State is a Gulf state
   *         )
   *     ) AND NOT (
   *         …
   *     )
   */
  Editor.prototype.renderFlow = function () {
    var self = this;
    var lines = [];
    // A condition is one line, but a group spans a range of them — and its
    // opening bracket shares a line with the previous sibling. Recording the
    // range each child occupies is what lets a drop be hit-tested as "between
    // sibling i and i+1 of group X" in a layout that has no element per child.
    var spans = [];
    // A nested group's tools, with the two lines they can ride on.
    var groupTools = [];
    var inline = this.options.connectorPlacement === 'inline';
    this.flowLines = lines;
    this.flowSpans = spans;
    this.flowTools = groupTools;

    function newLine(depth, extraClass) {
      var line = el('div', 'kce-line' + (extraClass ? ' ' + extraClass : ''));
      line.style.paddingLeft = 'calc(' + depth + ' * var(--kce-indent-step, 1.7em))';
      line.setAttribute('data-depth', String(depth));
      lines.push(line);
      self.tree.appendChild(line);
      return line;
    }

    function lastLine() { return lines[lines.length - 1]; }

    // Tagged with the group they belong to: a group has no element of its own
    // in this layout, so its brackets and NOT are how a removal preview shows
    // that the group itself is going, not only the rows inside it.
    function paren(which, owner) {
      return el('span', 'kce-paren kce-paren-' + which, {
        text: which === 'open' ? '(' : ')', 'aria-hidden': 'true', 'data-node': owner.id,
        'data-op': owner.operator === 'or' ? 'or' : 'and'
      });
    }

    function emit(group, depth, parent, openLine) {
      var kids = Array.isArray(group.children) ? group.children : [];

      if (!kids.length) {
        var emptyLine = newLine(depth);
        emptyLine.appendChild(el('span', 'kce-empty-group', { text: self.labels.empty }));
        emptyLine.appendChild(self.renderStarter(group));
      }

      kids.forEach(function (child, i) {
        var firstLine = lines.length;
        if (child.type === 'condition') {
          newLine(depth).appendChild(self.renderCondition(child, group, depth));
        } else {
          // The bracket opens on the line the connector left off on, so the
          // page reads ") AND NOT (" rather than stranding brackets.
          var target = i > 0 ? lastLine() : newLine(depth);
          if (child.negate) {
            target.appendChild(el('span', 'kce-negate-marker', {
              text: self.labels.not, 'data-node': child.id
            }));
          }
          target.appendChild(paren('open', child));
          var tools = emit(child, depth + 1, group, target);
          var closeLine = newLine(depth);
          closeLine.appendChild(paren('close', child));
          if (tools) groupTools.push({ tools: tools, home: target, away: closeLine });
        }

        spans.push({ node: child, group: group, index: i, from: firstLine, to: lines.length - 1 });

        // The add buttons sit immediately after the logic word they extend,
        // so the eye reads "… AND +AND" and the pointer is already there.
        if (i < kids.length - 1) {
          var conn = self.renderConnector(group, i);
          // Every connector in this group's child list sits at this indent,
          // whether it follows a row or a closing bracket.
          conn.setAttribute('data-conn-depth', String(depth));
          lastLine().appendChild(conn);
        }
        var adds = self.renderAdds(group, i, i === kids.length - 1);
        lastLine().appendChild(adds);
        // Inline, the AND / OR sits straight after the value — so the row's
        // arrows and ×, which are invisible at rest but take their room, cannot
        // stay between the two: the AND / OR would sit apart from the value, or
        // move when they appeared. They join the add buttons instead, in the
        // strip that appears after the AND / OR. Still keyed by the row's node,
        // so focus survives a re-render.
        if (inline && child.type === 'condition') {
          var row = lastLine().querySelector(':scope > .kce-condition');
          var moved = row ? row.querySelectorAll(':scope > .kce-move, :scope > .kce-remove') : [];
          Array.prototype.forEach.call(moved, function (ctl) {
            ctl.classList.add('kce-row-ctl');
            adds.appendChild(ctl);
          });
        }
      });

      // A group's own controls (NOT, remove) ride on the line it opened on —
      // the line that acts as its header — so they cost no vertical space.
      var tools = self.groupTools(group, parent, depth);
      if (tools) {
        if (openLine) {
          tools.classList.add('kce-tools-inline');
          openLine.appendChild(tools);
          return tools;
        }
        newLine(depth, 'kce-tools-line').appendChild(tools);
      }
      return null;
    }

    emit(this.doc.root, 0, null, null);
  };

  /* ------------------------------------------------------------------ *
   * Reorder controls and drag
   * ------------------------------------------------------------------ */

  /** Can this node be moved — i.e. does it have anywhere to go? */
  Editor.prototype.movable = function (node, parent) {
    return !!(parent && (parent.children || []).length > 1 &&
      parent.children.indexOf(node) !== -1 && !this.options.readOnly);
  };

  /**
   * Move up / move down. These come first and drag is layered on top of the
   * same primitive, because a drag handle is unreachable by keyboard and
   * unusable with a screen reader — so the buttons are the real interface and
   * dragging is the shortcut.
   */
  Editor.prototype.reorderTools = function (node, parent) {
    if (!this.options.allowReorder || !this.movable(node, parent)) return null;
    var self = this;
    var at = parent.children.indexOf(node);
    var wrap = el('span', 'kce-move');

    [['up', -1, this.labels.moveUp, '↑'], ['down', 1, this.labels.moveDown, '↓']].forEach(function (spec) {
      var to = at + spec[1];
      var btn = el('button', 'kce-icon-btn kce-move-btn kce-move-' + spec[0], {
        type: 'button', text: spec[3], title: spec[2], 'aria-label': spec[2],
        'data-fk': node.id + ':move-' + spec[0]
      });
      // Disabled rather than removed at the ends, so the row does not reflow
      // as something travels up a list.
      if (to < 0 || to >= parent.children.length) btn.disabled = true;
      btn.addEventListener('click', function () { self.moveChild(parent, at, to); });
      wrap.appendChild(btn);
    });

    return wrap;
  };

  /** Alt+Up / Alt+Down anywhere in a row, so reordering needs no pointer. */
  Editor.prototype.bindMoveKeys = function (host, node, parent) {
    var self = this;
    host.addEventListener('keydown', function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!self.options.allowReorder || !self.movable(node, parent)) return;
      var at = parent.children.indexOf(node);
      var to = at + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= parent.children.length) return;
      e.preventDefault();
      e.stopPropagation();
      self.moveChild(parent, at, to);
    });
  };

  /** The grip. Quiet until the row is hovered, like everything else here. */
  Editor.prototype.dragHandle = function (node, parent) {
    if (!this.options.allowDrag || !this.options.allowReorder || !this.movable(node, parent)) return null;
    var grip = el('span', 'kce-grip', {
      text: '⠿', title: this.labels.dragHandle, 'aria-hidden': 'true'
    });
    this.bindDrag(grip, node, parent);
    return grip;
  };

  /** The elements a given child occupies, in whichever layout is running. */
  Editor.prototype.elementsFor = function (node, parent) {
    if (this.layout() === 'flow') {
      var span = null;
      (this.flowSpans || []).forEach(function (s) {
        if (s.node === node && s.group === parent) span = s;
      });
      if (!span) return [];
      return (this.flowLines || []).slice(span.from, span.to + 1);
    }
    var found = [];
    Array.prototype.forEach.call(this.tree.querySelectorAll('[data-kce-child]'), function (elm) {
      if (elm.kceNode === node && elm.kceParent === parent) found.push(elm);
    });
    return found;
  };

  /**
   * The y coordinates of every insertion boundary within a group: n+1 values,
   * from the top of the first sibling to the bottom of the last.
   */
  Editor.prototype.siblingBounds = function (parent) {
    var self = this;
    var tops = [];
    var bottom = null;

    if (this.layout() === 'flow') {
      var spans = (this.flowSpans || []).filter(function (s) { return s.group === parent; });
      spans.sort(function (a, b) { return a.index - b.index; });
      spans.forEach(function (s) {
        var first = (self.flowLines || [])[s.from];
        var last = (self.flowLines || [])[s.to];
        if (!first || !last) return;
        tops.push(first.getBoundingClientRect().top);
        bottom = last.getBoundingClientRect().bottom;
      });
    } else {
      var host = null;
      Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-group-children'), function (elm) {
        if (elm.kceGroup === parent) host = elm;
      });
      if (!host) return [];
      Array.prototype.forEach.call(host.querySelectorAll(':scope > [data-kce-child]'), function (elm) {
        var r = elm.getBoundingClientRect();
        tops.push(r.top);
        bottom = r.bottom;
      });
    }

    if (!tops.length || bottom === null) return [];
    return tops.concat([bottom]);
  };

  /**
   * How far in the drop indicator should start: at the indent of the level
   * being reordered, so it reads as a position within that group rather than a
   * line drawn across the whole rule.
   */
  Editor.prototype.siblingIndent = function (parent) {
    var host = null;
    if (this.layout() === 'flow') {
      var span = null;
      (this.flowSpans || []).forEach(function (s) {
        if (s.group === parent && (span === null || s.index < span.index)) span = s;
      });
      var line = span && (this.flowLines || [])[span.from];
      if (!line) return 0;
      var pad = parseFloat((window.getComputedStyle(line).paddingLeft || '0')) || 0;
      return line.getBoundingClientRect().left + pad - this.tree.getBoundingClientRect().left;
    }
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-group-children'), function (elm) {
      if (elm.kceGroup === parent) host = elm;
    });
    if (!host) return 0;
    return host.getBoundingClientRect().left - this.tree.getBoundingClientRect().left;
  };

  /**
   * Pointer-event drag, not the HTML5 drag-and-drop API — that does not fire
   * on touch at all, and this has to work on a phone.
   */
  Editor.prototype.bindDrag = function (handle, node, parent) {
    var self = this;

    handle.addEventListener('pointerdown', function (down) {
      if (down.button !== undefined && down.button !== 0) return;
      if (!self.movable(node, parent)) return;
      var from = parent.children.indexOf(node);
      down.preventDefault();

      var bounds = null;
      var boundary = from;
      var active = false;
      var indicator = null;
      var startY = down.clientY;

      function begin() {
        active = true;
        bounds = self.siblingBounds(parent);
        if (!bounds.length) { active = false; return false; }
        self.root.classList.add('kce-dragging');
        self.elementsFor(node, parent).forEach(function (elm) { elm.classList.add('kce-drag-source'); });
        indicator = el('div', 'kce-drop-indicator', { 'aria-hidden': 'true' });
        indicator.style.left = Math.max(0, self.siblingIndent(parent)) + 'px';
        self.tree.appendChild(indicator);
        return true;
      }

      function place(y) {
        var best = 0, bestDistance = Infinity;
        for (var i = 0; i < bounds.length; i++) {
          var d = Math.abs(bounds[i] - y);
          if (d < bestDistance) { bestDistance = d; best = i; }
        }
        boundary = best;
        var rect = self.tree.getBoundingClientRect();
        indicator.style.top = (bounds[best] - rect.top + self.tree.scrollTop) + 'px';
        indicator.classList.toggle('is-noop', boundary === from || boundary === from + 1);
      }

      function finish(commit) {
        document.removeEventListener('keydown', onKey, true);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onCancel);
        try { handle.releasePointerCapture(down.pointerId); } catch (e) { /* already gone */ }
        if (!active) return;
        self.root.classList.remove('kce-dragging');
        self.elementsFor(node, parent).forEach(function (elm) { elm.classList.remove('kce-drag-source'); });
        if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
        if (commit) self.moveToBoundary(parent, from, boundary);
      }

      function onMove(e) {
        if (!active) {
          // A few pixels of slop, so a click on the grip is not a zero-distance
          // drag that still shows the whole apparatus.
          if (Math.abs(e.clientY - startY) < 4) return;
          if (!begin()) return;
        }
        place(e.clientY);
      }
      function onUp() { finish(true); }
      function onCancel() { finish(false); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      }

      try { handle.setPointerCapture(down.pointerId); } catch (e) { /* mouse fallback */ }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onKey, true);
    });
  };

  /* ------------------------------------------------------------------ *
   * Lining the operators up
   *
   * In the flow layout a connector sits immediately after the row it follows,
   * so its position depends on how wide that row happens to be — and a group
   * whose values are "Alabama", "California", "Florida" prints its ORs in three
   * different places. For a layout whose whole argument is that a rule should
   * read like an equation, a ragged operator column is the wrong look.
   *
   * One column per indent level, not one for the whole rule: rows at the same
   * indent already read as a column, so their operators should share one, while
   * a deeper group is a different thought and keeps its own. Forcing every
   * operator in the rule to a single far-right column would be the "long way to
   * move the mouse" problem again.
   *
   * `alignConnectors: 'group'` narrows it to one column per group; `false`
   * turns it off, which is what you want if a single very long row would drag
   * its neighbours' operators out to the right.
   * ------------------------------------------------------------------ */

  Editor.prototype.alignConnectors = function () {
    // The tree layout already puts connectors on their own rows, in a column.
    if (!this.open || this.layout() !== 'flow') return this;
    if (this.options.connectorPlacement !== 'inline') return this.alignConnectorsBelow();
    if (this.options.alignConnectors === false) return this;

    var conns = this.tree.querySelectorAll('.kce-connector[data-conn-group]');
    if (!conns.length) return this;

    var byDepth = this.options.alignConnectors !== 'group';
    var buckets = {};

    // Clear every offset before measuring any of them, or each bucket would be
    // measured against the previous pass's padding and creep rightward.
    Array.prototype.forEach.call(conns, function (conn) {
      conn.style.marginLeft = '';
      var key = byDepth
        ? 'd' + (conn.getAttribute('data-conn-depth') || '0')
        : conn.getAttribute('data-conn-group');
      (buckets[key] = buckets[key] || []).push(conn);
    });

    Object.keys(buckets).forEach(function (key) {
      var list = buckets[key];
      if (list.length < 2) return;
      var column = 0;
      list.forEach(function (conn) {
        if (conn.offsetLeft > column) column = conn.offsetLeft;
      });
      list.forEach(function (conn) {
        var gap = column - conn.offsetLeft;
        if (gap <= 0) return;
        // A ragged operator is cosmetic; a squeezed row is not. Lines do not
        // wrap, so a push that does not fit is paid for by the row before it
        // — its value narrows — or by overflow. Either way, leave this one
        // where it was.
        var line = conn.parentNode;
        var row = null;
        for (var c = line.firstElementChild; c && !row; c = c.nextElementSibling) {
          if (/(^|\s)kce-condition(\s|$)/.test(c.className)) row = c;
        }
        var before = row ? row.offsetWidth : 0;
        var height = line.offsetHeight;
        conn.style.marginLeft = gap + 'px';
        if ((row && row.offsetWidth < before - 0.5) || line.offsetHeight > height ||
            line.scrollWidth > line.clientWidth + 1) {
          conn.style.marginLeft = '';
        }
      });
    });

    return this;
  };

  /**
   * `connectorPlacement: 'below'`: each AND / OR has a line of its own under
   * the row it follows (the stylesheet breaks the line), and its text starts
   * where the text above it starts — the field name after a row, the bracket
   * after a group — so the eye runs straight down the rule:
   *
   *     Name is equal to Ann
   *     AND
   *     (
   *         State is equal to Florida …
   *     )
   *     OR
   *
   * Read from what is actually above it, not assumed: a row with no grip (it
   * has nowhere to move) starts its name further left, and a bracket starts
   * further left than any name. The text is lined up, not the boxes: the
   * AND / OR button has padding of its own, which would otherwise push its
   * word in from the edge it is meant to share.
   */
  Editor.prototype.alignConnectorsBelow = function () {
    var conns = this.tree.querySelectorAll('.kce-line > .kce-connector');
    var textLeft = function (elm) {
      return elm.getBoundingClientRect().left + (parseFloat(window.getComputedStyle(elm).paddingLeft) || 0);
    };
    Array.prototype.forEach.call(conns, function (conn) {
      conn.style.marginLeft = '';
      var line = conn.parentNode;
      var above = line.querySelector(':scope > .kce-condition .kce-sel-field .kce-sel-label') ||
        line.querySelector(':scope > .kce-paren-close');
      var btn = conn.querySelector('.kce-connector-btn');
      if (!above || !btn) return;
      var shift = textLeft(above) - textLeft(btn);
      if (Math.abs(shift) > 0.5) conn.style.marginLeft = shift + 'px';
    });
    return this;
  };

  /**
   * The tree skins park each group's tools to the right of the expression.
   * That needs room the expression does not use, and a dialog may not have
   * it — the rail then hangs past the edge, behind a scrollbar. When it does
   * not fit, the rail comes inside, under the group's rows, exactly as it does
   * on a narrow screen. Measured rather than guessed from a breakpoint,
   * because whether it fits depends on the rule as much as on the width.
   */
  Editor.prototype.fitGroupRail = function () {
    var root = this.root;
    if (!root) return this;
    if (!this.open || this.layout() !== 'tree') {
      root.classList.remove('kce-rail-inside');
      return this;
    }
    root.classList.remove('kce-rail-inside');
    var limit = this.tree.getBoundingClientRect().right;
    var heads = this.tree.querySelectorAll('.kce-group-head');
    var rects = [];
    for (var i = 0; i < heads.length; i++) {
      var r = heads[i].getBoundingClientRect();
      if (r.width > 0 && r.right > limit + 1) {
        root.classList.add('kce-rail-inside');
        return this;
      }
      if (r.width > 0) rects.push(r);
    }
    // With controls shown at rest every rail is visible at once, and a group
    // whose first child is a group starts on the same line as it — so their
    // rails can overlap. (On hover only one rail shows at a time.)
    if (root.getAttribute('data-kce-controls') === 'always') {
      for (var a = 0; a < rects.length; a++) {
        for (var b = a + 1; b < rects.length; b++) {
          var p = rects[a], q = rects[b];
          if (p.left < q.right - 1 && p.right > q.left + 1 && p.top < q.bottom - 1 && p.bottom > q.top + 1) {
            root.classList.add('kce-rail-inside');
            return this;
          }
        }
      }
    }
    return this;
  };

  /**
   * In the flow layout a group's tools ride on its opening line, just after
   * the bracket. Lines do not wrap, so tools in the flow there would take
   * their width — about 136px, for controls invisible until hovered — out of
   * the row before the bracket. Instead they float: positioned after the
   * bracket, taking no room at all.
   *
   * When they would not fit before the line's end, they go to the group's
   * closing line, which is otherwise a lone `)`, and sit in the flow there.
   * If that line opens the next group too (where they would be ambiguous),
   * they stay home in the flow and the row gives up the room.
   *
   * A control is moved only when its place changes, and focus is restored if
   * it was inside, because this runs on every `sync()`. Returns true when any
   * group's tools changed line.
   */
  Editor.prototype.fitGroupTools = function () {
    var entries = this.flowTools;
    if (!this.open || !entries || !entries.length) return false;
    var below = this.options.connectorPlacement !== 'inline';
    var changed = false;
    entries.forEach(function (entry) {
      var tools = entry.tools;
      var paren = entry.home.querySelector('.kce-paren-open[data-node="' + tools.getAttribute('data-node') + '"]');
      if (!paren) return;

      // Measured as a float, so the measurement is of the line without them.
      // Offsets are all relative to the tree, which is the floats' containing
      // block.
      tools.classList.add('kce-tools-float');
      var home = entry.home;
      var gap = parseFloat(window.getComputedStyle(home).columnGap) || 0;
      var left = paren.offsetLeft + paren.offsetWidth + gap;
      var margin = parseFloat(window.getComputedStyle(tools).marginLeft) || 0;
      var fits = left + margin + tools.offsetWidth <= home.offsetLeft + home.clientWidth + 0.5;
      var awayFree = !entry.away.querySelector('.kce-paren-open');

      var place = fits || !awayFree ? home : entry.away;
      var float = fits;
      // With the AND / OR below its row, the bracket is on a row of its own
      // ("AND ("), and the tools after it take nothing from anyone: no float.
      if (below) { place = home; float = false; }
      if (tools.parentNode !== place) {
        var focused = tools.contains(document.activeElement) ? document.activeElement : null;
        place.appendChild(tools);
        if (focused) { try { focused.focus({ preventScroll: true }); } catch (e) { /* best effort */ } }
        changed = true;
      }
      if (float) {
        tools.style.left = left + 'px';
        // Centred on the bracket, not the line: with the AND / OR below its
        // row, the bracket is on the second of the line's two rows.
        tools.style.top = (paren.offsetTop + (paren.offsetHeight - tools.offsetHeight) / 2) + 'px';
      } else {
        tools.classList.remove('kce-tools-float');
        tools.style.left = '';
        tools.style.top = '';
      }
    });
    return changed;
  };

  /**
   * Rows never wrap: when a line is short, a row gives up width — its value
   * first (the stylesheet weights that heavily), then the field and operator
   * names, which ellipsis. Two things CSS cannot say are said here.
   *
   * A name keeps a readable floor — about 2.5em, or its whole width if it is
   * shorter — rather than shrinking to a letter. A minimum in the stylesheet
   * would pad a short name like "is" out to that width, so it is measured.
   *
   * And a row that still cannot fit is given the width it needs, so the line
   * overflows and the tree scrolls sideways, instead of the row's own content
   * spilling out of its box and over the AND / OR beside it.
   */
  Editor.prototype.fitRows = function () {
    if (!this.open || !this.tree) return this;
    var rows = this.tree.querySelectorAll('.kce-condition');
    Array.prototype.forEach.call(rows, function (row) {
      row.style.minWidth = '';
      for (var c = row.firstElementChild; c; c = c.nextElementSibling) {
        if (!/(^|\s)kce-sel(\s|$)/.test(c.className)) continue;
        var label = c.querySelector('.kce-sel-label');
        if (!label) continue;
        var floor = 2.5 * (parseFloat(window.getComputedStyle(c).fontSize) || 14);
        var cs = window.getComputedStyle(label);
        var natural = label.scrollWidth + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
        // The floor is the label's; the shell also holds a chevron, which
        // never shrinks, so its width goes on top.
        var extra = Math.max(0, c.getBoundingClientRect().width - label.getBoundingClientRect().width);
        c.style.minWidth = Math.ceil(Math.min(natural, floor) + extra) + 'px';
      }
    });
    Array.prototype.forEach.call(rows, function (row) {
      // scrollWidth excludes the border, minWidth includes it (border-box).
      if (row.scrollWidth > row.clientWidth + 1) row.style.minWidth = (row.scrollWidth + row.offsetWidth - row.clientWidth) + 'px';
    });
    return this;
  };

  /**
   * The add buttons after a row, in the flow layout. With controls showing
   * at rest ('always') they sit in the line and keep their room. Revealed on
   * hover, room kept for invisible buttons is room taken from the row — up to
   * 184px on a group's last row — so they float instead: out of the flow,
   * placed after the AND / OR when the line has space for them, otherwise as a
   * strip just below it, over the next line. Either way nothing moves when
   * they appear.
   *
   * Only a strip that ends its line floats. One followed by a bracket opening
   * the next group stays in the flow, or it would sit on top of the bracket;
   * an empty group's starter is always shown and never floats.
   *
   * Which strips float is structural and settled first, before anything is
   * measured; where they go is measured last (positionAdds).
   */
  Editor.prototype.floatAdds = function () {
    var float = this.layout() === 'flow' && this.root.getAttribute('data-kce-controls') !== 'always';
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-line > .kce-adds'), function (adds) {
      var starter = adds.classList.contains('kce-adds-starter');
      var last = !starter;
      for (var n = adds.nextElementSibling; n && last; n = n.nextElementSibling) {
        if (!n.classList.contains('kce-group-tools')) last = false;
      }
      // A strip before a bracket used to stay in the flow, or it would sit on
      // the bracket — and so held the bracket apart from its AND / OR at rest.
      // Now it floats there too. Below, it goes after the row, on the row's
      // own line, where there is room; inline it also carries the row's arrows
      // and ×, and goes below the line (positionAdds), since after the AND / OR
      // is where the bracket is.
      var on = float && !starter;
      adds.classList.toggle('kce-adds-float', on);
      if (!on) {
        adds.classList.remove('kce-adds-below');
        adds.style.left = '';
        adds.style.top = '';
      }
    });
    return this;
  };

  Editor.prototype.positionAdds = function () {
    var belowRows = this.options.connectorPlacement !== 'inline';
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-line > .kce-adds-float'), function (adds) {
      var line = adds.parentNode;
      var gap = 5;
      var lineLeft = line.offsetLeft + (parseFloat(window.getComputedStyle(line).paddingLeft) || 0);
      var lineRight = line.offsetLeft + line.clientWidth;
      var fits = function (anchor) {
        return anchor.offsetLeft + anchor.offsetWidth + gap + adds.offsetWidth <= lineRight + 0.5;
      };

      // After whatever is last in the line's flow — usually the AND / OR, but
      // a group's tools moved to its closing line sit in the flow after the
      // bracket, and a strip placed straight after the bracket would cover
      // them.
      var anchor = null;
      for (var n = line.firstElementChild; n; n = n.nextElementSibling) {
        if (n === adds || window.getComputedStyle(n).position === 'absolute') continue;
        if (n.offsetWidth > 0) anchor = n;
      }
      // With the AND / OR on a row of its own (below), the strip that adds
      // after this row — or after this group — goes on the row above it if it
      // can: after the row and its ×, or after the closing bracket. That is
      // where it goes after a group's last row, which has no AND / OR, and it
      // leaves "AND (" together. If the row fills its line, after the AND / OR.
      var first = belowRows ? line.querySelector(':scope > :is(.kce-condition, .kce-paren-close)') : null;
      if (first && (fits(first) || !anchor)) anchor = first;
      if (!anchor) return;

      // Inline, a line that also opens a group has its bracket straight after
      // the AND / OR, and the group's own tools floated after that: the strip
      // goes after those, at the end of everything — not under the line, where
      // it would sit on the next row's name.
      var right = anchor.offsetLeft + anchor.offsetWidth;
      if (!first) {
        for (var m = adds.nextElementSibling; m; m = m.nextElementSibling) {
          if (m.offsetWidth > 0) right = Math.max(right, m.offsetLeft + m.offsetWidth);
        }
      }
      var left = right + gap;
      adds.classList.remove('kce-adds-below');
      var under = left + adds.offsetWidth > lineRight + 0.5;
      // The strip's own ground (padding) widens it, so it is measured with it.
      adds.classList.toggle('kce-adds-below', under);
      // Hanging below, it covers part of the next line while it shows. Not
      // under its own AND / OR: the AND / OR are aligned in a column, so that
      // would cover the next line's every time. Under the row's text instead,
      // past the next row's grip — names, which are only being read.
      if (under) {
        left = Math.max(lineLeft, Math.min(lineLeft + 24, lineRight - adds.offsetWidth));
        // Names, yes; an AND / OR, no. With the AND / OR below their rows, the
        // next line can be a short `)` with its AND / OR straight under it —
        // where the strip would land. Past it, then.
        var top = line.offsetTop + line.offsetHeight;
        var next = line.nextElementSibling;
        var words = next ? next.querySelectorAll(':scope > .kce-connector .kce-connector-btn') : [];
        Array.prototype.forEach.call(words, function (w) {
          if (w.offsetWidth && w.offsetTop < top + adds.offsetHeight && w.offsetTop + w.offsetHeight > top &&
              w.offsetLeft < left + adds.offsetWidth && w.offsetLeft + w.offsetWidth > left) {
            left = Math.min(w.offsetLeft + w.offsetWidth + gap, lineRight - adds.offsetWidth);
          }
        });
      }
      adds.style.left = left + 'px';
      // Beside: centred on what it follows, not on the line — with the AND / OR
      // below its row, the line is two high and its middle is between them.
      adds.style.top = (under
        ? line.offsetTop + line.offsetHeight
        : anchor.offsetTop + (anchor.offsetHeight - adds.offsetHeight) / 2) + 'px';
    });
    return this;
  };

  /**
   * Group guides: in the flow layout a group is a range of lines, and only
   * its brackets say where it starts and ends — at a distance, in a deep
   * rule, hard to follow. Each bracketed group gets a thin line down the left
   * of its rows, from the line after its `(` to the line before its `)`, in
   * the colour of its operator (dashed when it is negated), the way an
   * editor draws indent guides. Nested groups nest their lines.
   *
   * Drawn as overlays in the tree, so they take no room and no pointer, and
   * re-placed whenever lines move: every layout pass, and when a preview's
   * ghost line comes and goes.
   */
  Editor.prototype.positionGuides = function () {
    var tree = this.tree;
    if (!tree) return this;
    Array.prototype.forEach.call(tree.querySelectorAll('.kce-guide'), function (g) { g.parentNode.removeChild(g); });
    if (!this.open || this.options.groupGuides === false || this.layout() !== 'flow') return this;
    var lit = this.litGuide;
    var owner = this.ghostOwner;
    // Guides are rebuilt here, so a bracket preview's mark is re-applied here.
    var marks = this.tidyMarks;
    var lineOf = function (elm) {
      for (var n = elm; n && n !== tree; n = n.parentNode) {
        if (/(^|\s)kce-line(\s|$)/.test(n.className || '')) return n;
      }
      return null;
    };
    Array.prototype.forEach.call(tree.querySelectorAll('.kce-paren-open[data-node]'), function (open) {
      var id = open.getAttribute('data-node');
      var close = tree.querySelector('.kce-paren-close[data-node="' + id + '"]');
      var from = lineOf(open), to = close && lineOf(close);
      if (!from || !to) return;
      // The lines strictly between the brackets' lines. A preview's ghost line
      // counts only for a group the new condition will belong to: a ghost
      // shown just inside a group's bracket — after a row whose line also
      // opens the group — lands before that group, not in it, and a guide
      // running past it would say otherwise.
      var owns = !!owner && (owner === id || owner.indexOf(id + '.') === 0);
      var skip = function (n) {
        var cls = n.className || '';
        return !/(^|\s)kce-line(\s|$)/.test(cls) || (!owns && /(^|\s)kce-ghost-line(\s|$)/.test(cls));
      };
      var first = from.nextElementSibling;
      while (first && first !== to && skip(first)) first = first.nextElementSibling;
      if (!first || first === to) return;
      var last = to.previousElementSibling;
      while (last && last !== first && skip(last)) last = last.previousElementSibling;
      var depthLine = first;
      var x = depthLine.offsetLeft + (parseFloat(window.getComputedStyle(depthLine).paddingLeft) || 0) - 10;
      var top = first.offsetTop + 3;
      var bottom = last.offsetTop + last.offsetHeight - 3;
      var negated = !!from.querySelector('.kce-negate-marker[data-node="' + id + '"]');
      var op = open.getAttribute('data-op') === 'or' ? 'or' : 'and';
      var guide = el('div', 'kce-guide is-' + op + (negated ? ' is-negated' : '') + (id === lit ? ' is-lit' : ''), { 'aria-hidden': 'true' });
      guide.setAttribute('data-group', id);
      if (marks && marks.indexOf(id) !== -1) guide.classList.add('kce-will-unbracket');
      guide.style.left = Math.max(0, x) + 'px';
      guide.style.top = top + 'px';
      guide.style.height = Math.max(0, bottom - top) + 'px';
      tree.appendChild(guide);
    });

    // The rule itself has no brackets, but its AND / OR govern it all the
    // same: pointing at one draws its line down the whole rule. Only then —
    // at rest, a line beside everything would say nothing.
    var rootNode = this.doc.root;
    var lines = Array.prototype.filter.call(tree.children, function (n) {
      var cls = n.className || '';
      return /(^|\s)kce-line(\s|$)/.test(cls) && !/(^|\s)kce-tools-line(\s|$)/.test(cls);
    });
    if (rootNode && (rootNode.children || []).length > 1 && lines.length > 1) {
      var head = lines[0], tail = lines[lines.length - 1];
      var rx = head.offsetLeft + (parseFloat(window.getComputedStyle(head).paddingLeft) || 0) - 10;
      var rootGuide = el('div', 'kce-guide kce-guide-root is-' + (rootNode.operator === 'or' ? 'or' : 'and') +
        (rootNode.negate ? ' is-negated' : '') + (rootNode.id === lit ? ' is-lit' : ''), { 'aria-hidden': 'true' });
      rootGuide.setAttribute('data-group', rootNode.id);
      rootGuide.style.left = Math.max(0, rx) + 'px';
      rootGuide.style.top = (head.offsetTop + 3) + 'px';
      rootGuide.style.height = Math.max(0, tail.offsetTop + tail.offsetHeight - 3 - head.offsetTop - 3) + 'px';
      tree.appendChild(rootGuide);
    }
    return this;
  };

  /** The group a hovered or focused element speaks for: its AND / OR, or a bracket. */
  Editor.prototype.guideGroupOf = function (target) {
    for (var n = target; n && n !== this.tree && n.nodeType === 1; n = n.parentNode) {
      if (n.classList.contains('kce-connector')) return n.getAttribute('data-conn-group');
      if (n.classList.contains('kce-paren')) return n.getAttribute('data-node');
      if (n.classList.contains('kce-line')) return null;
    }
    return null;
  };

  Editor.prototype.lightGuide = function (id) {
    if (id === this.litGuide) return this;
    this.litGuide = id;
    Array.prototype.forEach.call(this.tree.querySelectorAll('.kce-guide'), function (g) {
      g.classList.toggle('is-lit', !!id && g.getAttribute('data-group') === id);
    });
    return this;
  };

  /** Everything positional that has to be measured once the rule is drawn. */
  Editor.prototype.fitLayout = function () {
    if (this.destroyed) return this;
    this.fitGroupRail();
    if (this.tree) this.floatAdds();
    this.fitRows();
    // Alignment first: it moves the brackets the floating tools sit after.
    // If any tools changed line, that line's content changed, so align again
    // and re-place.
    this.alignConnectors();
    if (this.fitGroupTools()) {
      this.alignConnectors();
      this.fitGroupTools();
    }
    if (this.tree) this.positionAdds();
    this.positionGuides();
    this.placeTidyNote();
    return this;
  };

  /** The first condition in an empty group has no row to hang a +AND on. */
  Editor.prototype.renderStarter = function (group) {
    var self = this;
    var btn = el('button', 'kce-btn kce-add', {
      type: 'button', text: this.labels.addCondition, 'data-fk': group.id + ':starter'
    });
    btn.addEventListener('click', function () {
      self.mutate(function () { group.children.push(self.newCondition()); });
    });
    var wrap = el('span', 'kce-adds kce-adds-starter');
    wrap.appendChild(btn);
    return wrap;
  };

  /**
   * A group's own controls: negate and remove. Adding is no longer done here —
   * it belongs beside the logic word being extended (see renderAdds).
   */
  Editor.prototype.groupTools = function (node, parent, depth) {
    var self = this;
    var tools = el('div', 'kce-group-tools', parent ? { 'data-node': node.id } : null);

    var grip = this.dragHandle(node, parent);
    if (grip) tools.appendChild(grip);

    var move = this.reorderTools(node, parent);
    if (move) tools.appendChild(move);

    if (this.options.allowGroupNegate && parent) {
      var not = el('button', 'kce-btn kce-btn-ghost kce-toggle-not' + (node.negate ? ' is-active' : ''),
        { type: 'button', text: this.labels.not, 'aria-pressed': String(!!node.negate),
          'data-fk': node.id + ':not' });
      not.addEventListener('click', function () { self.setNegate(node, !node.negate); });
      this.bindTidyPreview(not, function (find) { return negateNode(find(node), !node.negate); });
      tools.appendChild(not);
    }

    if (parent) {
      var rm = el('button', 'kce-icon-btn kce-remove', { type: 'button', title: this.labels.removeGroup, 'aria-label': this.labels.removeGroup, html: '&times;', 'data-fk': node.id + ':rm' });
      rm.addEventListener('click', function () { self.removeNode(node, parent); });
      this.bindRemovalPreview(rm, node);
      tools.appendChild(rm);
      this.bindMoveKeys(tools, node, parent);
    }

    return tools;
  };

  Editor.prototype.renderGroup = function (node, parent, depth) {
    var self = this;
    var box = el('div', 'kce-group');
    box.setAttribute('data-depth', String(depth));
    box.setAttribute('data-op', node.operator || 'and');
    // Only a group with a parent can be removed, and only tagged elements are
    // ever tinted — so the root never previews itself.
    if (parent) box.setAttribute('data-node', node.id);

    var head = el('div', 'kce-group-head');

    // The negation marker is what the equation skins show in place of the
    // header checkbox: the word NOT, sitting just before the bracket.
    var marker = el('span', 'kce-negate-marker', { text: this.labels.not, 'aria-hidden': 'true' });
    box.appendChild(marker);

    var grip = this.dragHandle(node, parent);
    if (grip) head.appendChild(grip);

    var toggle = el('div', 'kce-logic', { role: 'group' });
    ['and', 'or'].forEach(function (opName) {
      var b = el('button', 'kce-logic-btn' + ((node.operator || 'and') === opName ? ' is-active' : ''),
        { type: 'button', text: self.labels[opName], 'data-op': opName,
          'aria-pressed': String((node.operator || 'and') === opName),
          'data-fk': node.id + ':logic-' + opName });
      b.addEventListener('click', function () { self.setGroupOperator(node, opName); });
      self.bindTidyPreview(b, function (find) { return switchOperator(find(node), opName); });
      toggle.appendChild(b);
    });
    head.appendChild(toggle);

    if (this.options.allowGroupNegate) {
      var notWrap = el('label', 'kce-not');
      var notBox = el('input', null, { type: 'checkbox', 'data-fk': node.id + ':not' });
      notBox.checked = !!node.negate;
      notBox.addEventListener('change', function () { self.setNegate(node, notBox.checked); });
      this.bindTidyPreview(notWrap, function (find) { return negateNode(find(node), !node.negate); });
      notWrap.appendChild(notBox);
      notWrap.appendChild(el('span', null, { text: this.labels.not }));
      head.appendChild(notWrap);
    }
    if (node.negate) box.classList.add('is-negated');

    head.appendChild(el('span', 'kce-spacer'));

    var tools = el('div', 'kce-group-tools');

    var move = this.reorderTools(node, parent);
    if (move) tools.appendChild(move);

    if (parent) {
      var rm = el('button', 'kce-icon-btn kce-remove', { type: 'button', title: this.labels.removeGroup, 'aria-label': this.labels.removeGroup, html: '&times;', 'data-fk': node.id + ':rm' });
      rm.addEventListener('click', function () { self.removeNode(node, parent); });
      this.bindRemovalPreview(rm, node);
      tools.appendChild(rm);
      this.bindMoveKeys(head, node, parent);
    }

    head.appendChild(tools);
    box.appendChild(head);

    var kids = el('div', 'kce-group-children');
    kids.kceGroup = node;
    if (!node.children.length) {
      var emptyRow = el('div', 'kce-empty-group');
      emptyRow.appendChild(el('span', null, { text: this.labels.empty }));
      emptyRow.appendChild(this.renderStarter(node));
      kids.appendChild(emptyRow);
    }
    node.children.forEach(function (child, i) {
      // A connector between every adjacent pair, each carrying the add button
      // that extends it. The boxed skin hides these and uses the header toggle;
      // the equation skins let the connector carry the logic, as on paper.
      if (i > 0) {
        var conn = self.renderConnector(node, i - 1);
        conn.appendChild(self.renderAdds(node, i - 1, false));
        kids.appendChild(conn);
      }
      var childEl = child.type === 'group'
        ? self.renderGroup(child, node, depth + 1)
        : self.renderCondition(child, node, depth + 1);
      // Tagged so a drop can be hit-tested against the siblings of one group
      // without walking the tree again.
      childEl.setAttribute('data-kce-child', String(i));
      childEl.kceNode = child;
      childEl.kceParent = node;
      kids.appendChild(childEl);
      if (i === node.children.length - 1) {
        var tail = el('div', 'kce-connector kce-connector-tail');
        tail.setAttribute('data-op', node.operator === 'or' ? 'or' : 'and');
        tail.appendChild(self.renderAdds(node, i, true));
        kids.appendChild(tail);
      }
    });
    box.appendChild(kids);
    return box;
  };

  Editor.prototype.renderConnector = function (node, index) {
    var self = this;
    var opName = node.operator === 'or' ? 'or' : 'and';
    var wrap = el('div', 'kce-connector');
    wrap.setAttribute('data-op', opName);
    var btn = el('button', 'kce-connector-btn', {
      type: 'button',
      text: this.labels[opName],
      title: 'Switch this group to ' + this.labels[opName === 'and' ? 'or' : 'and'],
      // Keyed by the child it follows: one group can print several connectors,
      // and focus has to come back to the one that was actually clicked.
      'data-fk': node.id + ':conn-' + (index || 0)
    });
    // Which group's connector this is, so the flow layout can gather a group's
    // operators into one column — and which child it follows, so a preview can
    // tell the operators *between* two enclosed rows from the ones outside.
    wrap.setAttribute('data-conn-group', node.id);
    wrap.setAttribute('data-conn-index', String(index || 0));
    btn.addEventListener('click', function () {
      self.setGroupOperator(node, opName === 'and' ? 'or' : 'and');
    });
    this.bindTidyPreview(btn, function (find) {
      return switchOperator(find(node), opName === 'and' ? 'or' : 'and');
    });
    wrap.appendChild(btn);
    return wrap;
  };

  /**
   * Add a condition after `index`, choosing between "same group" and "new
   * group" from the logic word the user clicked.
   *
   * Clicking the operator the group already uses simply extends it. Clicking
   * the other one means the user is changing precedence at that point, so the
   * clicked row is wrapped in a sub-group carrying the new operator — which is
   * how "State is CA AND name is Ben, +OR name is Nanci" becomes
   * `State is CA AND (name is Ben OR name is Nanci)` without anyone having to
   * think about brackets.
   */
  /**
   * What `addBeside` would do, without doing it.
   *
   * The decision lives here so the mutation and the hover preview cannot drift
   * apart: whatever the preview draws is read from the same branch the click
   * will take.
   *
   * `enclosed` is the set of nodes that end up bracketed together with the new
   * condition — which is the thing worth showing, because it is the part
   * `+AND` and `+OR` differ on.
   */
  Editor.prototype.planAdd = function (group, index, op) {
    var groupOp = group.operator === 'or' ? 'or' : 'and';
    var child = group.children[index];

    // Same operator: the group simply gains another condition.
    if (op === groupOp) {
      return { kind: 'insert', op: op, ghostOp: op, group: group, at: index + 1, enclosed: group.children };
    }

    // A group of one has no effective operator yet, so retune it rather than
    // burying its only child in a pointless wrapper.
    if (group.children.length === 1) {
      return { kind: 'retune', op: op, ghostOp: op, group: group, at: 1, enclosed: group.children };
    }

    // Extending a neighbouring group that already uses this operator beats
    // nesting another one inside it.
    if (child && child.type === 'group' && !child.negate &&
        (child.operator === 'or' ? 'or' : 'and') === op) {
      return { kind: 'extend', op: op, ghostOp: op, group: child, at: child.children.length, enclosed: child.children };
    }

    // Otherwise the clicked row and the new condition become a group of two.
    return { kind: 'wrap', op: op, ghostOp: op, group: group, at: index, node: child, enclosed: [child] };
  };

  /** The same, for the `AND(…)` / `OR(…)` button. Null when it would do nothing. */
  Editor.prototype.planWrap = function (group, op) {
    var gop = group.operator === 'or' ? 'or' : 'and';
    if (op === gop) return null;
    var kids = Array.isArray(group.children) ? group.children : [];
    if (kids.length < 2) return null;
    // Everything here becomes one bracketed unit; the new condition is its
    // sibling, not its content — which is exactly the difference from `wrap`.
    // Two operators are in play: the bracket keeps the group's current one,
    // while the new condition joins by the other — the one on the button. The
    // tint and the ghost are coloured accordingly, which is the clearest way to
    // show that this button changes the shape rather than extending the list.
    return { kind: 'wrapAll', op: gop, ghostOp: op, group: group, enclosed: kids, outside: true };
  };

  Editor.prototype.addBeside = function (group, index, op) {
    var self = this;
    return this.mutate(function () {
      var plan = self.planAdd(group, index, op);

      if (plan.kind === 'insert') {
        plan.group.children.splice(plan.at, 0, self.newCondition());
        return;
      }

      if (plan.kind === 'retune') {
        plan.group.operator = op;
        plan.group.children.push(self.newCondition());
        return;
      }

      if (plan.kind === 'extend') {
        plan.group.children.push(self.newCondition());
        return;
      }

      plan.group.children.splice(plan.at, 1, {
        id: nextId(),
        type: 'group',
        operator: op,
        negate: false,
        children: [plan.node, self.newCondition()]
      });
    });
  };

  /** Find a node's parent. */
  Editor.prototype.parentOf = function (target, node) {
    node = node || this.doc.root;
    if (!node.children) return null;
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i] === target) return node;
      var found = this.parentOf(target, node.children[i]);
      if (found) return found;
    }
    return null;
  };

  /** How far below the root a node sits, and how far the tree runs below it. */
  Editor.prototype.depthOf = function (node) {
    var d = 0, at = node;
    while (at && at !== this.doc.root) { at = this.parentOf(at); d++; }
    return d;
  };

  function heightOf(node) {
    if (!node || node.type !== 'group' || !node.children || !node.children.length) return 0;
    var max = 0;
    for (var i = 0; i < node.children.length; i++) {
      var h = heightOf(node.children[i]);
      if (h > max) max = h;
    }
    return max + 1;
  }

  /**
   * Close off everything in this group and continue with the other operator.
   *
   * `+AND` follows ordinary precedence — in "B OR N" it binds to N, giving
   * "B OR (N AND …)". Sometimes you mean the looser reading instead:
   * "(B OR N) AND …". That is what this does. Everything already in the group
   * becomes a group of its own, the group switches to the other operator, and a
   * fresh condition is waiting alongside it.
   *
   * The new condition is added as a plain sibling rather than inside a group of
   * its own: a one-child group renders as redundant brackets, and the moment
   * you press +OR on it the existing rules turn it into the group you wanted.
   */
  Editor.prototype.wrapAndContinue = function (group, op) {
    var self = this;
    return this.mutate(function () {
      if (!self.planWrap(group, op)) return false;
      var gop = group.operator === 'or' ? 'or' : 'and';
      var kids = group.children;

      group.children = [
        { id: nextId(), type: 'group', operator: gop, negate: false, children: kids },
        self.newCondition()
      ];
      group.operator = op;
      // If the group now carries the same operator as its parent, its contents
      // belong directly in the parent — "X AND ((B OR N) AND C)" is just
      // "X AND (B OR N) AND C". mutate() sees to that: dropRedundantGroups().
      // That merge is this button's plan, previewed as such, so it is not
      // announced as brackets going.
    }, { announce: false });
  };

  /**
   * The add buttons for one insertion point.
   *
   * Mid-list they offer only the group's own operator — that is the one that
   * reads naturally next to the connector already printed there. The last
   * position also offers the other operator, which is the one that creates a
   * group, so there is exactly one place to reach for when changing precedence.
   */
  Editor.prototype.renderAdds = function (group, index, isLast) {
    var self = this;
    var groupOp = group.operator === 'or' ? 'or' : 'and';
    var wrap = el('span', 'kce-adds');
    var ops = isLast && this.options.maxDepth > 0
      ? [groupOp, groupOp === 'and' ? 'or' : 'and']
      : [groupOp];

    ops.forEach(function (op) {
      var btn = el('button', 'kce-btn kce-add kce-add-' + op, {
        type: 'button',
        text: self.labels[op === 'and' ? 'addAnd' : 'addOr'],
        title: op === groupOp
          ? 'Add another condition to this group'
          : 'Group this condition with a new one, joined by ' + self.labels[op],
        'data-fk': group.id + ':add-' + op + '-' + index
      });
      btn.addEventListener('click', function () { self.addBeside(group, index, op); });
      self.bindAddPreview(btn, function () { return self.planAdd(group, index, op); });
      wrap.appendChild(btn);
    });

    // Only the opposite operator can wrap: re-grouping an AND group under AND
    // would change nothing. There is nothing to wrap until there are at least
    // two things here — with one, +AND / +OR already retunes the group. And
    // wrapping pushes the whole subtree down a level, so it has to fit.
    if (isLast && this.options.allowWrapGroup && (group.children || []).length > 1 &&
        this.depthOf(group) + heightOf(group) < this.options.maxDepth) {
      var other = groupOp === 'and' ? 'or' : 'and';
      var wrapBtn = el('button', 'kce-btn kce-add kce-add-wrap kce-add-' + other, {
        type: 'button',
        text: this.labels[other === 'and' ? 'wrapAnd' : 'wrapOr'],
        title: 'Group everything here, then continue with ' + this.labels[other],
        'aria-label': 'Group everything in this set, then continue with ' + this.labels[other],
        'data-fk': group.id + ':wrap-' + other
      });
      wrapBtn.addEventListener('click', function () { self.wrapAndContinue(group, other); });
      this.bindAddPreview(wrapBtn, function () { return self.planWrap(group, other); });
      wrap.appendChild(wrapBtn);
    }

    return wrap;
  };

  Editor.prototype.newCondition = function () {
    var field = this.fields[0];
    var cond = { id: nextId(), type: 'condition', field: field ? field.name : '', operator: '', values: [] };
    if (field) {
      var ops = this.operatorsForField(field);
      cond.operator = ops[0] || '';
      cond.values = this.defaultValues(cond.operator);
    }
    return cond;
  };

  /**
   * Carry values across an operator (or field) change instead of wiping them.
   *
   * Switching "is equal to" for "matches regex" should not cost you the text
   * you just typed — the slot means the same thing. Switching to a date or a
   * list does not, so those only survive when the value actually fits.
   */
  var KIND_FAMILY = { text: 'scalar', number: 'scalar', choice: 'scalar', date: 'date', list: 'list', boolean: 'scalar' };

  function kindsCompatible(oldKind, newKind, value) {
    if (oldKind === newKind) return true;
    var a = KIND_FAMILY[oldKind] || oldKind;
    var b = KIND_FAMILY[newKind] || newKind;
    if (a === b) return true;
    // A date only survives into a scalar slot, or arrives from one it parses.
    if (b === 'date') return KConditions.helpers.toDate(value) !== null;
    if (a === 'date' && b === 'scalar') return true;
    return false;
  }

  Editor.prototype.remapValues = function (oldValues, oldOpName, newOpName) {
    var fresh = this.defaultValues(newOpName);
    var oldMeta = this.operatorMeta(oldOpName);
    var newMeta = this.operatorMeta(newOpName);
    if (!oldValues || !oldValues.length || !newMeta) return fresh;

    var oldKind = (oldMeta && oldMeta.valueKind) || 'text';
    var newKind = newMeta.valueKind || 'text';
    var allowsField = newMeta.allowFieldValue !== false;

    for (var i = 0; i < fresh.length; i++) {
      var prev = oldValues[i];
      if (!prev || typeof prev !== 'object') continue;

      if (prev.source === 'field') {
        if (allowsField) fresh[i] = { source: 'field', field: prev.field };
        continue;
      }
      if (prev.value === '' || prev.value === undefined || prev.value === null) continue;
      if (kindsCompatible(oldKind, newKind, prev.value)) {
        fresh[i] = { source: 'literal', value: prev.value };
      }
    }

    return fresh;
  };

  Editor.prototype.defaultValues = function (opName) {
    var meta = this.operatorMeta(opName);
    if (!meta) return [];
    var arity = meta.arity === undefined ? 1 : meta.arity;
    if (arity === 0) return [];
    if (arity === 'n') return [{ source: 'literal', value: [] }];
    var out = [];
    for (var i = 0; i < arity; i++) out.push({ source: 'literal', value: '' });
    return out;
  };

  Editor.prototype.renderCondition = function (node, parent, depth) {
    var self = this;
    var row = el('div', 'kce-condition', { 'data-node': node.id });
    if (node.negate) row.classList.add('is-negated');

    var grip = this.dragHandle(node, parent);
    if (grip) row.appendChild(grip);

    /* field select */
    var fieldSel = el('select', 'kce-select kce-field', { 'aria-label': 'Field', 'data-fk': node.id + ':field' });
    if (!node.field) fieldSel.appendChild(el('option', null, { value: '', text: this.labels.chooseField }));
    this.fields.forEach(function (f) {
      var o = el('option', null, { value: f.name, text: f.label });
      if (f.name === node.field) o.selected = true;
      fieldSel.appendChild(o);
    });
    fieldSel.addEventListener('change', function () { self.setField(node, fieldSel.value); });
    row.appendChild(selectShell(fieldSel, 'kce-sel-field'));

    var field = this.fieldIndex[node.field];

    /* operator select */
    var opSel = el('select', 'kce-select kce-operator', { 'aria-label': 'Operator', 'data-fk': node.id + ':op' });
    if (field) {
      var names = this.operatorsForField(field);
      var byGroup = {};
      var order = [];
      names.forEach(function (n) {
        var meta = self.operatorMeta(n);
        var g = meta.group || 'other';
        if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
        byGroup[g].push({ name: n, meta: meta });
      });
      order.forEach(function (g) {
        var groupLabel = (GROUPS[g] && GROUPS[g].label) || (g === 'custom' ? 'Custom' : g);
        var og = el('optgroup', null, { label: groupLabel });
        byGroup[g].forEach(function (entry) {
          var o = el('option', null, { value: entry.name, text: entry.meta.label });
          if (entry.name === node.operator) o.selected = true;
          og.appendChild(o);
        });
        opSel.appendChild(og);
      });
    }
    opSel.addEventListener('change', function () { self.setOperator(node, opSel.value); });
    row.appendChild(selectShell(opSel, 'kce-sel-operator'));

    /* values */
    var valuesBox = el('div', 'kce-values');
    var meta = this.operatorMeta(node.operator);
    var arity = meta ? (meta.arity === undefined ? 1 : meta.arity) : 0;

    if (meta && arity !== 0) {
      var count = arity === 'n' ? 1 : arity;
      for (var i = 0; i < count; i++) {
        if (i > 0) valuesBox.appendChild(el('span', 'kce-join', { text: this.labels.andJoin }));
        valuesBox.appendChild(this.renderValue(node, field, meta, i));
      }
    }
    row.appendChild(valuesBox);

    if (this.options.allowConditionNegate) {
      var notWrap = el('label', 'kce-not kce-not-inline');
      var notBox = el('input', null, { type: 'checkbox', 'data-fk': node.id + ':not' });
      notBox.checked = !!node.negate;
      notBox.addEventListener('change', function () { self.setNegate(node, notBox.checked); });
      notWrap.appendChild(notBox);
      notWrap.appendChild(el('span', null, { text: this.labels.not }));
      row.appendChild(notWrap);
    }

    var move = this.reorderTools(node, parent);
    if (move) row.appendChild(move);

    var rm = el('button', 'kce-icon-btn kce-remove', { type: 'button', title: this.labels.removeCondition, 'aria-label': this.labels.removeCondition, html: '&times;', 'data-fk': node.id + ':rm' });
    rm.addEventListener('click', function () { self.removeNode(node, parent); });
    if (parent) this.bindRemovalPreview(rm, node);
    row.appendChild(rm);

    if (parent) this.bindMoveKeys(row, node, parent);

    return row;
  };

  Editor.prototype.renderValue = function (node, field, meta, index) {
    var self = this;
    var holder = el('div', 'kce-value');
    if (!node.values[index]) node.values[index] = { source: 'literal', value: meta.arity === 'n' ? [] : '' };
    var value = node.values[index];
    var slot = node.id + ':v' + index;

    // Three gates, any of which closes it: the operator (a regex has nothing
    // to compare a field against), the field's own `values` list, and the
    // editor-wide `allowFieldValues`. The last is off by default, so a field
    // that names `comparableWith` is read as opting itself in — otherwise the
    // per-field setting would be unreachable without also setting the global.
    var optedIn = this.options.allowFieldValues || (field && field.comparableWith !== undefined);
    var allowField = optedIn &&
      meta.allowFieldValue !== false &&
      (!field || (field.values || []).indexOf('field') !== -1) &&
      meta.arity !== 'n';
    // A loaded document may already hold a field reference — written before the
    // option was turned off, or by hand. Hiding the source selector then would
    // leave no way back to a literal, so an existing reference reopens it. The
    // rule is only about what can be *created*, never a trap around what exists.
    if (value.source === 'field') allowField = true;
    var candidates = allowField && field ? this.comparableFields(field) : [];
    if (!candidates.length && value.source !== 'field') allowField = false;

    if (allowField) {
      var srcSel = el('select', 'kce-select kce-source', { 'aria-label': 'Value source', 'data-fk': slot + ':src' });
      [['literal', this.labels.valueSourceLiteral], ['field', this.labels.valueSourceField]].forEach(function (pair) {
        var o = el('option', null, { value: pair[0], text: pair[1] });
        if (value.source === pair[0]) o.selected = true;
        srcSel.appendChild(o);
      });
      srcSel.addEventListener('change', function () {
        self.setValueSource(node, index, srcSel.value, candidates[0] ? candidates[0].name : '');
      });
      holder.appendChild(selectShell(srcSel, 'kce-sel-source'));
    }

    if (value.source === 'field') {
      var fSel = el('select', 'kce-select kce-field-value', { 'aria-label': 'Compare with field', 'data-fk': slot + ':fieldval' });
      var listed = candidates.slice();
      // The document may point at a field the current rules would not offer.
      // Show it anyway — an empty selector beside a live reference would read
      // as though the rule compared against nothing.
      if (value.field && !listed.some(function (f) { return f.name === value.field; })) {
        listed.unshift(this.fieldIndex[value.field] || { name: value.field, label: value.field });
      }
      listed.forEach(function (f) {
        var o = el('option', null, { value: f.name, text: f.label || f.name });
        if (f.name === value.field) o.selected = true;
        fSel.appendChild(o);
      });
      fSel.addEventListener('change', function () {
        value.field = fSel.value;
        self.commitValue();
      });
      holder.appendChild(selectShell(fSel, 'kce-sel-fieldvalue'));
      return holder;
    }

    holder.appendChild(this.renderLiteralInput(value, field, meta, slot));
    return holder;
  };

  Editor.prototype.renderLiteralInput = function (value, field, meta, slot) {
    var self = this;
    var kind = meta.valueKind || 'text';

    if (meta.arity === 'n' || kind === 'list') {
      return this.renderListInput(value, field, meta, slot);
    }

    var choices = meta.kind === 'values' && meta.values
      ? KConditions.normaliseChoices(meta.values)
      : (field && field.choices ? field.choices : null);

    // An enum field alone is not enough to justify a dropdown: `contains`,
    // `starts with` and `matches regex` take a *fragment or pattern*, which is
    // not one of the choices. The operator decides — `valueFromChoices` is
    // false on exactly those operators — and a field whose operand is a
    // fragment gets a free text box however the field is typed.
    var fromChoices = meta.valueFromChoices !== false;

    if (fromChoices && choices && choices.length && (kind === 'choice' || (field && field.type === 'enum'))) {
      var sel = el('select', 'kce-select kce-literal', { 'data-fk': slot + ':lit' });
      choices.forEach(function (c) {
        var o = el('option', null, { value: String(c.value), text: c.label });
        if (String(c.value) === String(value.value)) o.selected = true;
        sel.appendChild(o);
      });
      if (value.value === '' || value.value === undefined) {
        value.value = choices[0].value;
      }
      sel.addEventListener('change', function () { self.setValue(value, sel.value); });
      return selectShell(sel, 'kce-sel-literal');
    }

    var type = 'text';
    if (kind === 'number') type = 'number';
    else if (kind === 'date') type = (field && field.input && field.input.type) || 'date';

    var input = el('input', 'kce-input kce-literal', {
      type: type,
      value: value.value === null || value.value === undefined ? '' : String(value.value),
      placeholder: (field && field.placeholder) || (kind === 'date' ? 'YYYY-MM-DD' : ''),
      'data-fk': slot + ':lit'
    });
    if (field && field.input) {
      ['min', 'max', 'step', 'pattern'].forEach(function (a) {
        if (field.input[a] !== undefined) input.setAttribute(a, field.input[a]);
      });
    }
    // Autosize first, so its own input listener runs before the one below:
    // sync() re-aligns the operator columns, and it has to measure the field at
    // the width this keystroke gave it, not the width of the one before.
    // Date inputs carry a native picker of fixed width; sizing them is a fight.
    // Start wide enough to read as "type here" rather than as a stray gap.
    if (type === 'text' || type === 'number') autosize(input, type === 'number' ? 6 : 14);

    // Typing is coalesced: a run of keystrokes in this one field becomes a
    // single history entry, committed when the typing stops or focus leaves.
    input.addEventListener('input', function () {
      self.setValue(value, type === 'number' && input.value !== '' ? Number(input.value) : input.value, slot);
    });
    input.addEventListener('blur', function () { self.flushEdit(); });
    return input;
  };

  Editor.prototype.renderListInput = function (value, field, meta, slot) {
    var self = this;
    var box = el('div', 'kce-taglist');
    if (!Array.isArray(value.value)) {
      value.value = value.value === '' || value.value === undefined || value.value === null
        ? []
        : KConditions.helpers.toList(value.value);
    }

    function redraw() {
      box.innerHTML = '';
      // A long "type a value and press Enter" hint is fine on an empty list but
      // stretches the row — and in the flowing skins, the bracket around the
      // whole group — once there are chips to read instead.
      if (input && input.tagName === 'INPUT') {
        input.placeholder = value.value.length ? self.labels.listHint : self.labels.listHintEmpty;
        if (input.kceFit) input.kceFit();
      }
      value.value.forEach(function (v, i) {
        var tag = el('span', 'kce-tag');
        tag.appendChild(el('span', null, { text: String(v) }));
        var x = el('button', 'kce-tag-x', { type: 'button', html: '&times;', 'aria-label': 'Remove ' + v });
        x.addEventListener('click', function () {
          value.value.splice(i, 1);
          redraw();
          self.commitValue();
        });
        tag.appendChild(x);
        box.appendChild(tag);
      });
      box.appendChild(input);
    }

    var choices = (meta.kind === 'values' && meta.values)
      ? KConditions.normaliseChoices(meta.values)
      : (field && field.choices ? field.choices : null);

    var input;
    if (choices && choices.length) {
      input = el('select', 'kce-input kce-tag-input', { 'data-fk': slot + ':tag' });
      input.appendChild(el('option', null, { value: '', text: '+ add…' }));
      choices.forEach(function (c) {
        input.appendChild(el('option', null, { value: String(c.value), text: c.label }));
      });
      input.addEventListener('change', function () {
        if (input.value !== '' && value.value.indexOf(input.value) === -1) {
          value.value.push(input.value);
          redraw();
          self.commitValue();
        }
        input.value = '';
      });
    } else {
      input = autosize(el('input', 'kce-input kce-tag-input', { type: 'text', placeholder: this.labels.listHintEmpty, 'data-fk': slot + ':tag' }), 12, 28);
      // Each chip is a discrete act, so each is its own history entry — unlike
      // the free-text field, where a run of keystrokes is one.
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          var v = input.value.trim();
          if (v) { value.value.push(v); input.value = ''; redraw(); input.focus(); self.commitValue(); }
        } else if (e.key === 'Backspace' && input.value === '' && value.value.length) {
          value.value.pop(); redraw(); input.focus(); self.commitValue();
        }
      });
      input.addEventListener('blur', function () {
        var v = input.value.trim();
        if (v) { value.value.push(v); input.value = ''; redraw(); self.commitValue(); }
      });
    }

    redraw();
    return box;
  };

  /* ------------------------------------------------------------------ *
   * Output
   * ------------------------------------------------------------------ */

  function stripIds(node) {
    if (!node || typeof node !== 'object') return node;
    var out = {};
    Object.keys(node).forEach(function (k) {
      if (k === 'id') return;
      if (k === 'children') {
        out.children = node.children.map(stripIds);
      } else {
        out[k] = node[k];
      }
    });
    return out;
  }

  Editor.prototype.usedCustomOperators = function () {
    var used = {};
    var self = this;
    (function walk(n) {
      if (!n) return;
      if (n.type === 'group') { (n.children || []).forEach(walk); return; }
      if (self.customOperators[n.operator]) {
        var def = extend({}, self.customOperators[n.operator]);
        delete def.appliesTo;
        used[n.operator] = def;
      }
    }(this.doc.root));
    return used;
  };

  Editor.prototype.getDocument = function () {
    return {
      version: KConditions.SPEC_VERSION,
      generator: 'kConditionsEditor/' + VERSION,
      operators: this.usedCustomOperators(),
      root: stripIds(this.doc.root)
    };
  };

  Editor.prototype.getJson = function () {
    var doc = this.getDocument();
    return this.options.pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
  };

  /**
   * Render the rule as a SQL boolean expression — the part after WHERE.
   *
   * Requires k-conditions-sql.js. Field columns come from each field's
   * `column` (defaulting to its `name`), so the SQL names need not match the
   * names in the document.
   */
  Editor.prototype.getSql = function (overrides) {
    if (typeof KConditions.toSql !== 'function') {
      throw new Error('kConditionsEditor: load k-conditions-sql.js to generate SQL');
    }
    var opts = extend({
      fields: this.fields,
      operators: this.customOperators,
      pretty: this.options.pretty
    }, this.options.sql || {}, overrides || {});
    return KConditions.toSql(this.getDocument(), opts);
  };

  Editor.prototype.setDocument = function (doc) {
    var parsed = KConditions.normaliseDocument(doc);
    this.doc = {
      version: parsed.version,
      generator: parsed.generator,
      operators: parsed.operators,
      root: parsed.root
    };
    this.assignIds(this.doc.root);
    this.dropRedundantGroups();
    this.dismissTidyNote();
    this.flushEdit();
    this.touch();
    this.pushHistory();
    if (this.open) this.render(); else this.sync();
    return this;
  };

  Editor.prototype.validate = function () {
    return KConditions.validateDocument(this.getDocument(), {
      fields: this.fields,
      operators: this.customOperators
    });
  };

  Editor.prototype.describe = function () {
    return KConditions.describe(this.getDocument(), this.describeOptions());
  };

  /**
   * The same sentence marked up — the field in <strong>, the operator and value
   * in spans. Everything from the document is escaped, so the result is safe to
   * insert with innerHTML.
   */
  Editor.prototype.describeHtml = function () {
    return KConditions.describeHtml(this.getDocument(), this.describeOptions());
  };

  Editor.prototype.describeOptions = function () {
    return {
      fields: this.fields,
      operators: this.customOperators,
      emptyText: this.labels.empty
    };
  };

  Editor.prototype.setSkin = function (skin) {
    this.options.skin = skin;
    this.root.setAttribute('data-kce-skin', skin);
    // Flow and tree skins do not share a DOM, so a skin change is a re-render.
    if (this.open) this.render();
    return this;
  };

  /** The controls mode in force: the option, or 'always' on a screen with no hover. */
  Editor.prototype.applyControls = function () {
    var mode = controlsOf(this.options.controls);
    if (this.noHover && this.noHover.matches) mode = 'always';
    if (this.root) this.root.setAttribute('data-kce-controls', mode);
    return this;
  };

  /** Show the row controls on hover ('hover') or at rest ('always'). */
  Editor.prototype.setControls = function (mode) {
    this.options.controls = controlsOf(mode);
    this.applyControls();
    // Floating group tools are placed by measurement, and what fits does not
    // change with visibility — but the layout pass is cheap and keeps it honest.
    return this.fitLayout();
  };

  /**
   * Put the AND / OR below each row ('below') or after its value ('inline').
   * A re-render, because 'inline' moves a row's controls into the strip after
   * its AND / OR. Presentation only: the document is not touched.
   */
  Editor.prototype.setConnectorPlacement = function (mode) {
    this.options.connectorPlacement = placementOf(mode);
    this.root.setAttribute('data-kce-connectors', this.options.connectorPlacement);
    if (this.open) this.render();
    return this;
  };

  /** Change how previews are drawn. Presentation only: nothing is re-rendered. */
  Editor.prototype.setPreviewStyle = function (style) {
    this.clearPreview();
    this.options.previewStyle = previewStyleOf(style);
    this.root.setAttribute('data-kce-preview', this.options.previewStyle);
    return this;
  };

  Editor.prototype.setTheme = function (theme) {
    this.options.theme = theme;
    if (theme) this.root.setAttribute('data-kce-theme', theme);
    else this.root.removeAttribute('data-kce-theme');
    return this;
  };

  Editor.prototype.setEmptyText = function (text) {
    this.labels.empty = text;
    this.sync();
    return this;
  };

  Editor.prototype.sync = function () {
    var doc = this.getDocument();
    var json = this.options.pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
    var isEmpty = KConditions.isEmptyDocument(doc);

    var sql = null;
    var sqlError = null;
    if (this.options.output === 'sql' || this.sourcePanel) {
      try {
        sql = this.getSql();
      } catch (e) {
        sqlError = e;
      }
    }

    // A field the editor could not read keeps its content until the first
    // change — see preserve() and touch(). Everything else here still runs,
    // so the summary and the change payload describe the rule on screen.
    if (!this.pristine) {
      if (this.options.output === 'sql') {
        var text = sql ? sql.sql : '/* ' + (sqlError ? sqlError.message : 'no SQL') + ' */';
        // Always compact inside the comment, whatever `pretty` says: it is
        // machine-readable baggage in a field a person is looking at.
        if (sql && this.options.documentInComment) text = embedDocument(text, JSON.stringify(doc));
        this.textarea.value = text;
      } else {
        this.textarea.value = json;
      }
      if (this.documentInput) this.documentInput.value = json;
    }

    if (this.options.summaryHtml) this.summaryText.innerHTML = this.describeHtml();
    else this.summaryText.textContent = this.describe();
    this.summaryText.classList.toggle('is-empty', isEmpty);

    var problems = this.validate();
    this.messages.innerHTML = '';
    if (problems.length) {
      var list = el('ul', 'kce-problems');
      list.appendChild(el('li', 'kce-problems-title', { text: this.labels.invalid }));
      problems.slice(0, 6).forEach(function (p) {
        list.appendChild(el('li', null, { text: p.message }));
      });
      this.messages.appendChild(list);
    }
    if (this.jsonBox) this.jsonBox.textContent = json;
    if (this.clearWrap) {
      // Nothing to clear on an empty rule, so the control stays out of the way.
      this.clearWrap.hidden = isEmpty;
      if (isEmpty && this.clearPrompt) {
        this.clearPrompt.hidden = true;
        this.clearButton.hidden = false;
        this.clearWrap.classList.remove('is-asking');
      }
    }
    if (this.sourcePanel) this.renderSource(json, sql, sqlError);
    this.updateHistoryButtons();
    // Here rather than only in render(): typing widens an autosizing input
    // without rebuilding anything, which moves the connector after it.
    this.fitLayout();

    if (!this.pristine) {
      try {
        this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
        this.textarea.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* older browsers */ }
    }

    var payload = {
      document: doc, json: json, valid: problems.length === 0,
      problems: problems, empty: isEmpty,
      sql: sql ? sql.sql : null, sqlResult: sql, sqlError: sqlError,
      pristine: this.pristine
    };
    if (typeof this.options.onChange === 'function') this.options.onChange(doc, payload);
    this.emit('change', payload);
    return this;
  };

  /* ------------------------------------------------------------------ *
   * Events / teardown
   * ------------------------------------------------------------------ */

  Editor.prototype.on = function (name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
    return this;
  };
  Editor.prototype.off = function (name, fn) {
    var arr = this.listeners[name] || [];
    var i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
    return this;
  };
  Editor.prototype.emit = function (name, payload) {
    (this.listeners[name] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    });
  };

  Editor.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.history && this.history.burstTimer) clearTimeout(this.history.burstTimer);
    if (this.tidyNoteTimer) clearTimeout(this.tidyNoteTimer);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    if (this.onViewportResize) window.removeEventListener('resize', this.onViewportResize);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.noHover) {
      if (this.noHover.removeEventListener) this.noHover.removeEventListener('change', this.onHoverCapability);
      else if (this.noHover.removeListener) this.noHover.removeListener(this.onHoverCapability);
    }
    if (this.onPointerAnywhere) document.removeEventListener('pointerdown', this.onPointerAnywhere, true);
    if (this.onKeyAnywhere) document.removeEventListener('keydown', this.onKeyAnywhere);
    if (this.clearOutside) document.removeEventListener('click', this.clearOutside, true);
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    (this.hideTargets || [this.textarea]).forEach(function (el) {
      el.classList.remove('kce-concealed');
      el.classList.remove('kce-hidden-textarea');
      el.removeAttribute('aria-hidden');
      if (el.tagName === 'TEXTAREA') el.removeAttribute('tabindex');
    });
    this.listeners = {};
    if (this.textarea[HANDLE] === this) delete this.textarea[HANDLE];
  };

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */

  function attach(target, options) { return new Editor(target, options); }

  function attachAll(selector, options) {
    var nodes = document.querySelectorAll(selector || 'textarea[data-k-conditions]');
    return Array.prototype.map.call(nodes, function (n) { return new Editor(n, options); });
  }

  /**
   * The editor attached to a textarea, or null. For the caller who did not keep
   * what attach() returned — a page that attached in one script and needs to
   * tear down in another.
   */
  function get(target) {
    if (typeof target === 'string') target = document.querySelector(target);
    return (target && target[HANDLE]) || null;
  }

  /** destroy() the editor on a textarea, if there is one. True if there was. */
  function detach(target) {
    var editor = get(target);
    if (!editor) return false;
    editor.destroy();
    return true;
  }

  return {
    VERSION: VERSION,
    Editor: Editor,
    attach: attach,
    attachAll: attachAll,
    get: get,
    detach: detach,
    evaluator: KConditions
  };
}));
