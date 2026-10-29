# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-10-29

For a host that translates every string, styles every select with its own widget,
and must pass axe in light and dark — what the Herräng Dance Camp system's
Applications Review page needs, and what any translated host would have hit
the same way. The document format is unchanged (spec `1.0`). Upgrading changes
three things you might notice: the N-day date operators read differently (below),
the light theme's muted grey is a shade darker, and `dist/` is in the repository.

### Added

- **Every string through `labels`, and the operators and their groups too.**
  The operator names ("is equal to", "includes any of") and the headings of the
  operator list ("Equality", "Date", "Custom") were fixed in the evaluator's
  table, and the accessible names and tooltips — "Field", "Operator", "Value
  source", "Compare with field", "Remove …", "Group everything in this set, then
  continue with …", the add buttons' and AND / OR's tooltips — were English
  written into the code, as were the list dropdown's "+ add…", the date
  placeholder, the undo/redo tooltips and the messages under an incomplete rule.
  A translated host could not reach any of them. Now:
  - `labels.operators` (`{ eq: 'är lika med', … }`), `labels.groups`
    (`{ equality: 'Likhet', custom: 'Egna', … }`) and `labels.problems` (by
    problem code) merge key by key; a key left out stays English.
  - New keys: `fieldSelect`, `operatorSelect`, `valueSourceSelect`,
    `compareFieldSelect`, `valueInput`, `valueFrom`, `valueTo`, `listInput`,
    `listAdd`, `removeValue`, `addToGroup`, `addNewGroup`, `wrapGroup`,
    `switchGroup`, `undoTitle`, `redoTitle`, `datePlaceholder`, `sqlMissing`.
  - **Placeholders**: a label holding `{value}` or `{operator}` is a template,
    so a translation puts the value where its word order wants it —
    `removeValue: 'Ta bort {value}'`, `wrapGroup: '… {operator}'`. Before, the
    English was concatenated around the value, which fixed the order for every
    language.
  - The value controls had **no accessible name at all**: a screen reader met
    "edit text" and "combo box" with nothing to say what for. Each now has one
    (`valueInput`, and `valueFrom` / `valueTo` for `between`).
  - `KConditionsEditor.defaultLabels()` returns every key with its English,
    the builtin operators' labels included — the list a translation has to
    cover. The README lists every key, its English and where it appears.
  - A browser check replaces every label with a marker, drives the editor
    through every state, and fails on any visible, spoken or tooltip text that
    did not come from `labels`.
- **`describe()` and `describeHtml()` take `labels`** — the editor's own
  object, passed as it is — and read `and`, `or`, `not`, `andJoin`, `empty` and
  `labels.operators` from it, in both SDKs. The collapsed summary does the same,
  so the summary and a host's own `describe()` call read in the same language.
  They said "AND", "OR", "NOT" and "and" in English whatever the editor showed.
  `describeHtml()` still escapes everything, translated words included, and
  picks `kcd-or` from the operator rather than from the word, so a translated
  "ELLER" keeps the OR colour.
- **An operator label can place its operand: `{value}`.** "is within the last
  N days" was the label, and the number went after it, so the row read "is
  within the last N days [7]" and `describe()` "is within the last N days 7".
  A label may now hold a `{value}` slot. On the row the words before it stand
  in the operator's place, then the value box, then the words after it — "is
  within the last [7] days"; `describe()` puts the value in the same place,
  keeping the spacing written round the slot (`'在过去{value}天内'` reads
  `在过去7天内`); the operator list shows the label whole with `…` in the slot.
- **Field groups.** A field's optional `group` (a display string) lists it
  under an `<optgroup>` of that name, in the field list and the compare-with
  list, groups in the order they first appear, ungrouped fields first. With 40
  fields from three sources, a flat list was a haystack. A new condition takes
  the first field the list shows. `comparableWith: 'group:…'` already matched
  `group`, and still does.
- **`decorateSelect`, `releaseSelect` and `focusSelect`: a host's own select
  widget.** A host that turns every `<select>` into a widget had no way to
  reach the editor's, which are rebuilt on every render. `decorateSelect(select,
  { role, node, field, editor })` is called for each select once it is built,
  filled and on the page, on every render; `role` is `field`, `operator`,
  `value`, `values`, `source` or `fieldValue`. Return `false` to decline one, or
  the widget's promise if it arrives later. `releaseSelect` is called before a
  render discards a decorated select, and on `destroy()` — without it, a widget
  that portals its dropdown to `<body>` (kselect does) leaves one behind per
  select per render. Focus survives a re-render through the widget: the editor
  resolves the focused element to its select through the select's shell (or a
  `data-kce-for`), falls back to the select being changed when focus is in a
  widget's portalled list, and then calls `focusSelect`, or focuses the first
  focusable element in the shell — waiting for a widget that has not arrived,
  and retrying for a few frames when the host did not return its promise. A
  decorated select's shell draws no label and no chevron beside the widget, and
  does not shrink; it is watched, so a widget that lands late or changes width
  re-runs the layout (the AND / OR column, the floats, the guides). With `decorateSelect`, a list of choices is one `<select
  multiple>` (role `values`), so the widget's tags and checkboxes replace the
  editor's chips; values keep the order they were added in.
- **`validateDocument()` problems carry `code` and `params`** alongside the
  English `message`, in both SDKs — what `labels.problems` is keyed by. The
  shared fixtures now pin every problem in both SDKs (`validateCases`), and the
  codes are tabled in SPEC.md.
- **An accessibility check**: axe-core over every skin, in light, dark and a
  dark reader with no theme, with controls on hover and at rest, in nine states
  each (a row hovered, each add button's preview, the clear question, the tidy
  note, the debug panel, the summary, the unreadable-field notice). Zero
  violations required. The README says which colour pairs a host that sets its
  own tokens must keep.
- **`dist/` is committed**, with the `LICENSE` in it, so every tag carries its
  build and can be vendored (or loaded from a CDN serving the tag) without a
  build step. `npm test` fails when `dist/` or `docs/dist/` is not what
  `build.js` makes from `src/` now.

### Changed

- **The four N-day date operators read with the number in place**: "is within
  the last {value} days", "is within the next {value} days", "is more than
  {value} days ago", "is more than {value} days from now". `describe()` output
  for them changes from `[Arrival] is within the last N days 7` to
  `[Arrival] is within the last 7 days`, in both SDKs. Anything that matched
  on the old sentence will need the new one.
- **The light theme's muted grey** (`--kce-text-muted`, `--kce-op`, and prose's
  and ledger's operator colour) is `#5f6875`, from `#6a7482` and ledger's
  `#78838f`. The old values were 4.2:1 on a hovered row, under the 4.5:1 AA
  needs; ledger's was 3.9:1 at rest.
- **Chips in a list of choices show the choice's label** ("Week 2"), as the
  dropdown and `describe()` do. They showed the stored value ("w2").

### Fixed

- **Contrast**, found by the new check: the Clear confirmation was white on
  the dark theme's red (3:1) — it now uses a new `--kce-danger-text` token;
  the +AND button's hover was the AND blue on its own tint (4.25:1) — the hover
  colour is now drawn a fifth of the way towards the text colour, which keeps
  the hue and clears AA for a host's colours too; boxed's active OR in dark was
  white on light orange (2.2:1); the debug panel's active tab was 4.25:1; and
  blackboard had no `--kce-accent-strong` of its own, so it inherited the
  light theme's navy (1.3:1).
- **The JSON box, the debug panel and the unreadable-field notice** scroll, and
  could not be reached by keyboard to be scrolled. They take focus now.
- **The AND / OR under a row** lines up with a decorated field's widget, as it
  does with the field name.
- **`AND(…)` / `OR(…)` are named by what they show.** Their aria-label
  replaced the visible text with a sentence, so a host translating one but not
  the other broke WCAG 2.5.3 (label in name), and axe said so. The visible text
  is the name now, and the sentence (`wrapGroup`) the description.

### Verified with

kselect 1.9.0 (HDC's vendored copy), inside HDC's `app.css`,
`kselect_theme.css` and `kconditions_theme.css`, with a Swedish label set and 40
grouped fields: picking a field through the widget, an arrow-key step on the
closed widget and Ctrl+Z all leave focus on the widget for the same row, with a
returned promise and without one; every re-render releases its widgets, leaving
no dropdowns in `<body>`. `tests/browser/decorate-select.js` drives a stand-in
widget built the same way.

## [0.1.1] — 2026-10-19

The first tagged release. 0.1.0 was prepared as the first tag, but these fixes
came before anything was published, so the tag went to 0.1.1 instead and 0.1.0
was never tagged.

### Fixed

Four places where the PHP and JavaScript SDKs gave different answers for the
same document and data — a rule that passed in the browser and failed on the
server. The shared fixtures now pin each one, and the JavaScript suite passes
under any `TZ`.

- **A date and time with no zone** (`2026-10-19 22:00`, `2026-10-19T22:00:00`)
  was read in the browser's own zone by the JavaScript SDK (`Date.parse()`)
  and in the host's default zone by PHP (`strtotime()`). Both now read it as
  that wall time in UTC, as a bare date already was.
- **A year below 100** (`0026-10-19`) became 1926 in JavaScript (`Date.UTC()`)
  and 2026 in PHP (`gmmktime()`). Both now take it as written.
- **A no-break space** (or U+FEFF, or any Unicode space) around a value was
  trimmed by JavaScript and kept by PHP, so `"5\u00A0" is equal to 5` held in one
  SDK only. PHP now trims exactly what `String.prototype.trim()` trims.
- **A number compared as text** was written `1e-7` by JavaScript and
  `0.0000001` by PHP, which also cut `0.30000000000000004` to `0.3`. Both now
  write the shortest round-trip digits in plain decimal notation, so
  `contains "e"` never matches a number.

## [0.1.0] — 2026-10-15

The minor bump that readied the package to be installed from Packagist and npm
by version (the first tag is 0.1.1, above). The document format is unchanged (spec `1.0`), and both SDKs
behave as in 0.0.37 apart from the addition below.

### Added

- **List operators `includes_any` and `includes_all`, and a `list` field
  type.** A multi-select, a set of tags or a comma-separated field holds a
  LIST of values, and nothing could ask about it: `in_list` asks whether one
  value is among several operands, which is the other way round.
  `[Tags] includes any of ["Red", "Blue"]` is true when at least one of the
  field's values is listed, `includes all of` when every operand is. A string
  value is split on commas like an operand. An empty operand list never
  matches, and neither does an empty or missing value, so a condition with
  nothing chosen reads as false rather than as "always". Declaring a field
  `type: 'list'` offers the two operators plus the existence group, and the
  editor's chip control takes the field's `choices`. `describe()` labels the
  values from the choices as `in_list` does; the shared fixtures pin both
  SDKs. The SQL builders refuse these two operators by default — a
  multi-valued column has no portable storage shape — and a custom operator
  with an `sql` template is the way to say how your schema stores it.

## [0.0.37] — 2026-10-10

### Fixed

- **`theme: 'dark'` now darkens the prose and ledger skins on a machine in
  light mode.** Before, prose drew its field names in near-black on the dark
  background (1.1:1 contrast) and ledger did the same to field names, values
  and AND / OR. Both skins set their own text colours and gave the dark ones
  only for a reader whose system is in dark mode, so the `theme` option never
  reached them. A dark-mode reader, and `theme: 'light'`, were unaffected.

## [0.0.36] — 2026-10-10

### Added

- **Brackets going away is now visible: before the click, after it, and
  with the way back.** Since 0.0.35, switching a group to its parent's
  AND / OR merges it into the parent. Switching back then switches the
  parent, because the group has gone. The only way back was Undo, a small
  muted button in the footer, which is off the screen on a long rule. Nothing
  pointed at it, and nothing said the brackets had gone rather than just the
  operator changing. Now:
  - **Pointing at a control whose click would remove brackets** (or tabbing
    to it) marks those brackets as going: struck through in the removal
    colour, with the group's guide in prose. This covers an AND / OR, a
    group's NOT, and a × that would leave its group holding one thing. In
    the tree skins it is the group's own bracket or border. It looks the
    same in every `previewStyle`. The mark comes from making the change to a
    copy of the rule and tidying the copy with the same code the click runs,
    so the preview cannot disagree with the click.
  - **After the click**, the rows that came out of the brackets are tinted
    briefly in their new group's colour. The tint doesn't animate under
    `prefers-reduced-motion`.
  - **A note, "Removed unneeded brackets · Undo"**, appears beside the
    change where there is room for it. In prose that is usually level with
    the AND / OR under the first moved row. Where there is no room, it goes
    in the footer next to Undo. It goes on the next change, or after eight
    seconds, but not while it is pointed at or focused. A screen reader
    hears it. The text is the new `bracketsRemoved` label, and with
    `history: false` the note has no Undo.

  `AND(…)` / `OR(…)` merges as part of what it is for, and its preview
  already shows that, so it raises no note. Loading a rule and
  `setDocument()` don't raise one either.

## [0.0.35] — 2026-10-10

### Fixed

- **Brackets that do nothing are taken out as soon as they appear.** Removing
  a group's only sibling left that group alone in its own brackets. So
  `(a AND b) OR c`, less `c`, inside an AND drew `((a AND b))`, with the AND
  after it hanging out to the left. Switching a nested group's OR to match
  its parent's AND left `a AND (b AND c)`. Neither bracket changed the result,
  and both made the rule look more nested than it was. Now, after every
  change:
  - a group with one thing in it is replaced by that thing;
  - a group with the same AND / OR as its parent merges into the parent;
  - an empty group is dropped (it was already ignored by evaluation and SQL).

  A rule saved with such brackets loses them when it is loaded, and so does
  one passed to `setDocument()`. The rule evaluates exactly as before.

  Brackets that carry a NOT are kept. A NOT on a group of one moves to the
  thing inside only if that thing has its own NOT control: a group, or a
  condition with `allowConditionNegate`.

  One consequence: switching a nested group's operator to match its parent
  merges it. Switching it back no longer restores the group, but Undo does,
  in one step.

## [0.0.34] — 2026-10-10

### Changed

- **In prose, each AND / OR now has a line of its own, under the text above
  it**: the field name after a row, the `)` after a group.
  Before, it sat well to the right of the value, with about 85px of empty
  space between them. That space was held for the row's ↑ ↓ ×, which are
  invisible at rest, so the operator wouldn't move when they appeared. A
  bracket opening the next group was pushed further still, past room held
  for the hidden add buttons. The rule read like a form with a column of
  operators at the side. Now it reads down the page like a formatted query:

  ```
  Name is equal to Ann
  AND
  State is equal to Florida
  AND (
      …
  )
  OR
  ```

  `AND (` stays together. Under a `)`, the AND / OR keeps the same space
  above it whether or not a `(` follows. A row's add buttons appear after
  its ×, on the row's own line. Nothing moves when a row is hovered. This is the new
  default.

### Added

- **`connectorPlacement: 'inline'`**, for those who would rather spend fewer
  lines. The AND / OR sits on the row's line, just after the value (still
  lined up in a column per indent, as `alignConnectors` says). The row's
  arrows and × can't stay between the value and an operator that doesn't
  move, so they appear after the AND / OR, with the add buttons. On a line
  that also opens a group, they come after the group's own tools.
  `editor.setConnectorPlacement()` switches live, and the playground has a
  picker. It is an option rather than a second prose skin because it changes
  where one thing sits, not how the rule looks. Two near-identical skins
  would have to be kept in step forever.

### Tests

- `connector-placement.js`: both placements, with controls on hover and
  always shown, at 880px and in a 545px dialog. Every line is hovered with
  the real pointer, and no AND / OR may move. Below, each one's text must
  start where the text above it starts, measured on the glyphs: the field
  name, or the `)`, including a group followed by a row and two groups in a
  row. Inline, nothing may sit between the value and
  the operator. The moved × must be painted after it on hover and take no
  pointer at rest.
- `narrow-host.js`, `one-line-rows.js` and `no-overlaps.js` run prose in both
  placements, each held to its own invariant. `connector-alignment.js` is
  pinned to `inline`, the placement it is about.
- The browser runner's per-script timeout is now five minutes, up from
  three. It guards against a hung browser; `no-overlaps.js` now takes about
  three and a half minutes to cover everything.

## [0.0.33] — 2026-10-10

No change to the editor, the evaluators or the document format. This release
reorganises the repository for GitHub and GitHub Pages; if you install from npm,
nothing you use has moved.

### Added

- **The API reference keeps its contents in view.** On a wide screen the
  "On this page" list is a column on the left that stays put while you read,
  marks the section (or subsection) at the top of the window, and lists the
  current section's subsections under it. Before, it was a box at the top of
  a 1,300-line page, gone after the first screen. Near the end of the page,
  where the last sections can never reach the top, the one you clicked is
  marked rather than the last one. Below 960px it stays the box above the
  text. Subsections get ids, so they can be linked to.

### Changed

- **The site lives in `docs/`.** `index.html`, `demo.html`, `skins.html`,
  `docs.html`, `design-lab.html` and `assets/` moved from the repository root
  into `docs/`, the folder GitHub Pages publishes. They were moved rather than
  copied, so there is still one copy of each page.
- **The site loads the minified build.** The pages loaded `src/` directly,
  which is not what anyone installing the package does. `npm run build` now
  also copies the `.min` files into `docs/dist/`, and the pages load those.
  Pages serves the repository with no build step, so `docs/dist/` is
  **committed** — rebuild and commit it with any change to `src/`. The root
  `dist/` is still generated and git-ignored; the ignore rule is now `/dist/`,
  since the old `dist/` also matched `docs/dist/`.
- **The design notes moved from `docs/notes/` to `notes/`**, so `docs/` holds
  only the site.
- `npm run serve` serves `docs/` at the root, as Pages does, and builds
  first. `npm run test:browser` builds first too, so the site pages are never
  tested against a stale build.
- The API reference's JSON Schema link pointed at `schema/` beside the page,
  which does not exist on Pages. It now links to the file on GitHub.
- **The schema's `$id` still resolves.** It is
  `https://kastrack.github.io/kConditionsEditor/schema/…`, which only worked
  while Pages could serve the repository root. The build now copies the schema
  to `docs/schema/`, committed like `docs/dist/`.
- The API reference's JavaScript and PHP SDK sections link to their source on
  GitHub (`src/k-conditions-evaluator.js`, `sdk/php`), and the porting section
  links to the shared fixtures.
- Repository URLs use the account's own casing, `github.com/KAStrack`.
- The API reference said `dist/` was committed. It never was.

### Tests

- `site-pages.js` serves `docs/` on its own, as Pages does, so a page reaching
  outside it is a 404 here rather than on the live site. It also fails a page
  that loads anything but the `.min` files from `dist/`, or shows a version
  other than the package's.

## [0.0.32] — 2026-10-09

### Added

- **Dropdowns show a chevron.** Reported from KAStrack. In prose, equation,
  ledger and blackboard, a field, an operator or a choice value reads as a
  word in the sentence (deliberately), and nothing said it could be opened.
  Each now carries a small down chevron after its label. It is drawn in CSS,
  so it doesn't depend on the font having the glyph. It's muted at rest,
  takes the accent colour on hover or focus, and sits inside the dropdown's
  own click area, so clicking it opens the list. The value/field switch is
  already a chevron, and boxed draws its own, so neither gets a second.

### Fixed

- **Hovering a top-level AND / OR drew no guide.** Reported from KAStrack:
  `a AND b AND c` showed no line at all, and in `a AND b AND (c OR d)` the
  top-level ANDs showed nothing. The rule itself has no brackets, so it had
  no guide. It now has one, down the whole rule, shown only while one of its
  AND / OR is pointed at or focused (at rest it would say nothing). Prose
  keeps a 14px left margin whenever guides are on, so that line clears a
  top-level `)`.

## [0.0.31] — 2026-10-09

### Fixed

- **A preview's line ran under the add buttons.** Reported from KAStrack, with
  `+AND` hovered on a group whose last child is a group. That button extends
  the inner group, and its "new condition" placeholder can only be shown one
  line low, after the inner group's `)`. Shown above, it would move the button
  out from under the pointer. The `bar` (and `region`) preview stretched to
  reach the placeholder, through the `)` line, and that line holds the add
  buttons. The placeholder now joins the shape only when it sits directly
  against the marked rows.

  Checking for the general case turned up five more overlaps of the same kind.
  Each was a line or a floating strip placed by measurement, without regard
  to what was already there:
  - **A group guide ran past a placeholder that didn't belong to its group.**
    `+AND` on the row just before a group shows the placeholder just inside
    the group's `(`, though the new condition lands before the group. Guides
    now take a placeholder only into the groups the new condition will belong
    to.
  - **A hover-mode add strip hanging below its line covered the placeholder**
    placed under that line. The placeholder now goes below the strip.
  - **That strip covered the next line's AND / OR**, which is aligned in a
    column directly beneath its own. It now hangs under the row's text
    instead.
  - **With `controls: 'always'`, the tree skins' group rails could overlap**
    when a group starts with a group. The rails now fold inside, under the
    rows, as they already do when they don't fit.
  - **In the tree skins, a group header's grip overlapped the ↑ beside it** by
    4px (since 0.0.26's larger grip).

  A new check, `no-overlaps.js`, holds the property itself. Across rules,
  skins, widths, preview styles and both control modes, at rest and while each
  add and × button is hovered, nothing visible may overlap a control.

## [0.0.30] — 2026-10-09

### Added

- **Group guides in prose (`groupGuides`, on by default).** In prose a group
  is a range of lines, and only its brackets said where it started and ended.
  In a nested rule, which rows belong to which group was hard to follow. Each
  bracketed group now has a thin line down the left of its rows, like a code
  editor's indent guides:
  - drawn in the group's AND / OR colour, and dashed when the group is
    negated;
  - nested inside the guides of the groups around it;
  - faint at rest;
  - at full strength while you point at, or tab to, that group's AND / OR word
    or one of its brackets.

  The guides take no room and never take the pointer. They follow the lines
  when a preview's ghost row comes and goes. `groupGuides: false` turns them
  off. The other skins already draw a group's edges, so they are prose only.
  Chosen from four prototypes; the others were a wash over the group on
  hover, background bands, and an operator tick before each row.

## [0.0.29] — 2026-10-08

### Added

- **`controls: 'hover' | 'always'`: when the row controls are shown.** The
  grip, arrows, ×, add buttons and a group's tools are revealed on the row
  being pointed at (`'hover'`, the default), or shown at rest (`'always'`).
  Change it live with `setControls()`. The demo and skins pages have a picker.
  A screen with no hover gets `'always'` regardless. The editor now decides
  that itself, from `matchMedia('(hover: none)')`, kept live. Before, a media
  query repeated every reveal rule in both stylesheets.

### Fixed

- **A row's AND / OR, arrows and × could end up below it.** Reported from
  KAStrack: it depended on the length of the field name, the operator and the
  value. Two causes.
  - In prose, the line holding a row, its AND / OR and its add buttons was
    allowed to wrap. Whenever the row filled the line, the AND / OR and the
    buttons went to a line of their own beneath it. In a 545px dialog that was
    nearly every row; at 760px, any row with a long field name.
  - A value of several parts (`between`, a date range, an "is one of" list)
    wrapped inside the row. The row then centred its controls on the taller
    block, below the field name.

  Lines and rows now never wrap. When a line is short the row gives up width:
  its value first, down to a floor (enough to type in, or to read a date in),
  then the field and operator names, which ellipsis but keep a readable few
  letters. `between` and date ranges shrink to stay on their line. Only a tag
  list wraps, inside its own box, and the row aligns on baselines, so the field
  name, controls and AND / OR stay on its first line. A row that still cannot
  fit (below about 480px) makes the line scroll sideways instead of
  overlapping.
- **Hover-revealed add buttons now take no room until needed, and moving onto
  a line moves nothing.** In prose they float. They appear after the AND / OR
  when the line has space, or as a small strip just below it when it does not.
  Invisible, they don't take the pointer from the line beneath. Reserving
  their room instead was tried and rejected: it cost up to 184px on a group's
  last row, and truncated names next to blank space. With `controls:
  'always'` they sit in the line and keep their room.
- **A prose group's tools no longer take room from the row before them.** They
  float after the group's `(`, and still move to its `)` line when they don't
  fit.

## [0.0.28] — 2026-10-08

### Fixed

- **With a single condition, the preview bar sat on the field name.** Reported
  from KAStrack. The `bar`, `region` and `marker` styles draw left of the rows.
  A row with a drag grip brings room for that (the grip's slot), but the only
  condition in a rule cannot be moved, so it has no grip. Its field name
  started flush at the editor's left edge, where the tree also clips. The bar
  landed on the text, the wash started flush with it, and the `marker` dot was
  not painted at all. In prose, equation and ledger, which have no left
  padding of their own, those three styles now reserve a 14px margin
  (`--kce-preview-gutter`). Blackboard and boxed already had the room. Every
  test rule had at least two rows, which is why nothing caught it; the
  preview check now includes a one-condition rule in every skin.

## [0.0.27] — 2026-10-08

### Added

- **`previewStyle`: how a preview is drawn, chosen independently of the skin.**
  Pointing at `+AND`, `+OR`, `AND(…)`, `OR(…)` or a `×` previews what the
  click will do. That preview was one look, and it was described as too
  messy. It tinted and outlined every row separately, so a range came out as
  a stack of ragged boxes, plus another box around the group's tools. There
  are now seven looks over the same marked set:
  - `bar`: one line in the margin;
  - `highlight`: the old look;
  - `region`: one soft wash;
  - `fade`: everything else recedes;
  - `color`: the range in the hue;
  - `marker`: each row's grip becomes a dot;
  - `underline`: names and operators.

  Set it with `previewStyle` or `setPreviewStyle()`. The demo and skins pages
  have a picker.

### Changed

- **The default preview is now `bar`.** Pass `previewStyle: 'highlight'` for
  the previous look.
- **The new condition is written as text.** Every style but `highlight` shows
  `OR new condition`, in the hue of the operator that joins it, where the dashed
  pill used to be.
- **The `×` preview follows the same option**, in red.
- **A group's tool strip is no longer part of any preview.** It is a set of
  controls, not part of the rule.

### Fixed

- **`AND(…)` / `OR(…)` left out the operators that end up inside the
  bracket.** Connectors are tagged by the group they belong to, not by a node,
  so the preview could not see them. The `AND` / `OR` words between the
  enclosed rows, and inside an enclosed or removed group, were never marked.
  They are now, in every style.
- **In prose, a removed group's preview covered the row before it.** A group's
  `(` shares a line with the previous sibling. The shape styles now start at
  the group's first row.

## [0.0.26] — 2026-10-08

Upgrade if the editor lives in a dialog, a sidebar, or any host narrower than
about 600px, or in a form with its own input styles. Nothing about the document
format changed.

### Fixed

- **In a narrow host, every row's controls dropped to a second line.** Rows were
  a wrapping flex line, and a wrapping flex line breaks before anything is
  allowed to shrink. So a row a few pixels too wide sent its move arrows and ×
  below it. Every row reserved a blank band for them, rows were 56px tall
  instead of 31px, and on hover the controls appeared below the thing being
  pointed at. Reported from a 545px dialog; at 612px it was fine, which is why
  nothing caught it. Rows now never wrap. The value slot gives up the width,
  and the field and operator names ellipsis only once it is down to its
  minimum. Boxed had the same fault at 545px with no host CSS at all.
- **The host page's form CSS reached the editor's inputs.** A dialog's
  `.form input[type=text] { width: 24rem; height: 42px; … }` made the prose
  value slot a 384px bordered box. That box is what pushed rows past the edge
  in the first place, and it put each `AND` / `OR` on a line of its own. The
  editor now pins the input and select box metrics at a specificity above
  element and class-scoped host rules. An ID-scoped host rule still wins; the
  README shows how to exclude the editor from one.
- **Controls were too small to hit and too faint to read.** The drag grip was a
  12×10 target, the arrows and × 20×20, and `+AND` / `+OR` and the `AND` / `OR`
  word about 16px tall. All are now at least 24×24, the WCAG 2.2 minimum,
  without making the line taller or the labels heavier. Revealed controls were
  shown at 55% opacity, about 2:1 contrast against white, which is below the
  3:1 a control needs. They now reveal at full opacity in the muted text colour
  (4.7:1). Labels have a 10px floor, so a 12px host no longer renders 8.5px
  `+AND`s.
- **The end-of-list arrow was noise.** The up arrow on a first row (and down on
  a last) sat at a quarter opacity: too faint to read as a control, but visible
  enough to clutter. It is now hidden, and keeps its space so rows do not
  reflow.
- **An editor attached inside a hidden dialog never aligned its operators.**
  The column was measured once, while everything measured zero, and was
  re-measured only on window resize. A `ResizeObserver` now re-measures
  whenever the editor's width changes.
- **Operator alignment could wrap a line.** Pushing an `AND` out to its column
  could send it, or the bracket and group tools after it, onto a second line.
  A push that would do that is now skipped for that connector.
- **In prose, a group's tools reserved a blank line under its bracket.** They
  ride after the `(`, invisible until hovered, and in a narrow host they
  wrapped. When they do not fit there, they now sit on the group's closing `)`
  line instead.
- **The tree skins' group rail hung off the edge in a narrow host.** It folded
  inside only on a narrow *screen*. Whether it fits is now measured, so a
  dialog gets the same treatment.

### Changed

- **Touch screens show row controls at rest.** Under `(hover: none)` there is
  no hover to wait for. The grip, arrows, × and add buttons are shown without
  one; with a mouse, prose still reveals them on hover.
- **One hover trigger per row.** The prose × used to reveal on the condition
  while its grip and arrows revealed on the line, so pointing at the `AND`
  after a row showed two of its three controls.
- **Theming docs lead with `--kce-accent`.** The default blue is a placeholder
  for the host's own colour; the README and docs now say so first.

## [0.0.25] — 2026-09-11

### Fixed

- **The footer had no bottom margin in the prose, equation and ledger skins.**
  Undo, Redo, Show source and the rest sat flush against whatever followed the
  editor on the page. Boxed and blackboard pad their own footers; these three
  draw no box, so the padding was the only gap and it was missing. Now 10px,
  matching boxed.

## [0.0.24] — 2026-09-10

### Changed

- **A field the editor cannot read is kept, not replaced.** Attach to a textarea
  holding hand-written SQL — or anything else that is not a document — and the
  editor used to find nothing it recognised and write an empty rule over it
  (`1 = 1` with `output: 'sql'`, an empty JSON document otherwise) in its
  constructor, before anyone had touched anything. An untouched form submitted a
  destroyed rule, and nothing on screen said what had been there.

  Now the field keeps its content byte for byte until the first change to the
  rule, and a notice above the rule shows the original text until dismissed, so
  the rule can be rebuilt while reading it. Opening the editor, changing skin or
  theme, and re-attaching do not count as changes; adding, editing, undoing and
  `setDocument()` do. The switch is one-way: undoing back to an empty rule after
  a change writes the editor's empty output, not the old text — by then the
  person has seen the notice and chosen to replace it.

  Ben asked whether the SQL could be parsed back instead. It was assessed and
  not built: SQL this library emitted is a closed grammar but loses information
  on the way out (relative dates become absolute, several idioms share one
  shape), and hand-written SQL is open-ended. Keeping and showing the original
  is the honest version of that feature. The assessment is in
  `docs/notes/design-record.md`.

### Added

- `editor.preserved` (`{ text }` or `null`), `editor.pristine`, and `pristine` on
  the `change` payload. Labels `preservedText` and `preservedDismiss`.
- `tests/browser/preserve-field.js` — 31 checks: the notice painted collapsed
  and open, the field and its `input` events untouched through attach, dismiss,
  open and re-attach, the first change rewriting it in both output modes,
  `documentInput` left empty while pristine, and no notice for an empty, JSON or
  comment-carrying field. Six fail against 0.0.23 before the script aborts on
  the missing Dismiss button.

### Fixed

- The code sample comments in the README and docs said the document rides in a
  *leading* SQL comment. It trails the SQL, and has since 0.0.5.

## [0.0.23] — 2026-09-10

### Added

- **`KConditionsEditor.get(target)` and `KConditionsEditor.detach(target)`.**
  Until now the only handle on an editor was the value `attach()` returned. Lose
  it — attach in one script, tear down in another — and the instance was
  unreachable. Removing the root by hand looked like it worked, but the
  document-level keydown listener stayed behind, and with the dead editor still
  believing it had the keyboard, one Ctrl+Z wrote an *undone* document back into
  the field. The new browser check reproduces exactly that against the old
  code.

  A textarea now points back at its editor as `textarea.kConditionsEditor`
  (visible in devtools as `$0.kConditionsEditor`). `get()` takes an element or a
  selector and returns the instance or `null`; `detach()` destroys it and returns
  whether there was one.

### Changed

- **`attach()` on a textarea that already has an editor replaces it.** The old
  instance is destroyed first — its root, its listeners, its hidden targets all
  restored — and the new one takes the field as it stands. Before, a second
  attach stacked a second editor under the first, both writing to the same
  field. There is deliberately no "same options, keep the old one" shortcut:
  options carry callbacks, which cannot be compared, and the field's value may
  have changed since the first attach. Callers who want to reuse rather than
  replace ask `get()` first.
- **`destroy()` is idempotent.** A second call is a no-op instead of removing
  classes that are already gone and detaching listeners twice.

### Tests

- `tests/browser/attach-lookup-and-replace.js` — 27 checks: lookup by element
  and selector, one painted root after a re-attach, the replaced editor neither
  emitting nor answering Ctrl+Z, a re-attach under a wrapping `hideTarget` still
  visible, and the field painted again after `detach()`. Nine of them fail
  against 0.0.22.

## [0.0.22] — 2026-09-10

Nothing in `src/` changed. This release makes the project inheritable: everything
needed to work on it is now *in* it.

### Added

- **`tests/browser/` — the browser checks, in the repository at last.** All 27
  drive real Chromium with real pointer, focus and keyboard events and judge
  results by what is painted. They lived outside the repository until now, which
  meant a clone had no coverage of hover, drag, undo, focus restoration, the
  previews, the skins or the built bundles — the behaviours that account for most
  of the bugs this project has actually shipped. Renamed for what they check
  (`undo-keyboard-ownership.js`, `removal-preview-colours.js`) rather than the
  order they were written in.

- **`npm run test:browser`** runs *every* script in that directory and exits
  non-zero if any is red; `npm run test:all` now runs all three suites. Pass a
  substring to narrow it: `node tests/browser/run.js undo`.

  The runner runs the whole directory on purpose. The previous arrangement was a
  remembered list of scripts, and one of them stayed red for several versions
  because it had quietly fallen off that list. A check that is not run is not a
  check, and a permanently red one is worse than none, because the suite stops
  being read.

- `tests/browser/harness.js`: `serve()` on an ephemeral port, `scratch()` for
  throwaway pages, `shot()`, `checker()`, `watchErrors()`. A script now fails the
  run on a non-zero exit, a `FAIL` line, a non-zero failure count, reported
  console errors, or **no verdict at all** — the last catches a script that dies
  quietly.

- **`docs/notes/`** — the design record moves into the repository: the running
  summary in `design-record.md`, plus one note per interesting version. The
  CHANGELOG says what changed; these say why the alternative was worse.

- `playwright` as a devDependency, and a `.gitignore` for the checks' scratch
  pages and screenshots.

### Changed

- **CLAUDE.md rewritten as a handover.** It now covers prerequisites and setup,
  how to run each suite and how to add to it, the conventions in groups rather
  than one long list, all eight testing lessons with their causes, the release
  ritual, how Ben works, and the known rough edges. It was written as in-repo
  guidance and read as notes-to-self.

### Fixed

- **`dist/` was documented as committed. It is not** — it is git-ignored, and
  `prepublishOnly` builds it so the published npm package carries it. README,
  CLAUDE.md and the 0.0.17 note all said otherwise, which would have sent anyone
  cloning the repository looking for files that were never there. Corrected, and
  `dist-bundles.js` now reports "run `npm run build` first" rather than failing
  on a missing file.

## [0.0.21] — 2026-09-08

### Changed

- **The Value / Field selector is off by default.** Set `allowFieldValues: true`
  to get it back everywhere.

  It used to be on, and it appeared on every row with a value, because the
  default for a field that said nothing about `comparableWith` was "comparable
  with every other field of the same type". So a form with four text fields
  silently offered field-to-field comparison on all four, and paid a control per
  row for it. Comparing one field against another is a real feature, but a niche
  one, and it should be asked for.

  A field that names `comparableWith` is read as asking for it, so per-field
  opt-in works with the global left alone — and `comparableWith: false` still
  opts a field out when the global is on:

  ```js
  { name: 'email', label: 'Email', comparableWith: ['billing_email'] }
  ```

  A document that already holds a field reference always keeps its selector,
  whatever the settings say, and the referenced field is listed even when the
  current rules would not offer it. The setting governs what can be *created*; it
  never becomes a trap around what already exists.

### Fixed

- **An enum field showed a dropdown for `contains`, `does not contain`, `starts
  with`, `ends with`, `matches regex` and `does not match regex`.** Those take a
  fragment or a pattern, not one of the choices, so the choice list was the wrong
  control — there was no way to type `contains "lor"` at all. They now get a free
  text box, whatever the field's type.

  The editor was deciding from the *field* (`field.type === 'enum'`) when the
  question belongs to the *operator*. Operators now carry `valueFromChoices`,
  true by default and false on exactly those six, and the editor and both SDKs
  read it.

- **`describe()` swapped a fragment for a choice label**, so a rule searching for
  the letters "FL" was rendered `[State] contains "Florida"` — a different rule
  from the one stored. The same metadata fixes it, in both languages. Rules with
  `is one of` and `is equal to` still show labels, because those operands really
  are whole values.

  Seven shared fixtures pin it; removing the flag fails exactly those seven.

- `verify8.js` (the hover/focus reveal check) had been failing for several
  versions and was not in the release regression. The cause was in the test: the
  add preview fires on focus as well as hover, so a focused add button left its
  ghost row in the DOM, and the ghost shifted the line list that the next step
  indexed into. Not a product bug — but a suite with a permanently red script in
  it is a suite nobody reads.

## [0.0.20] — 2026-09-05

### Added

- **`describeHtml()`**, in both SDKs, beside the existing `describe()`. The same
  sentence, marked up: the brackets and quotes that stand for a field and a value
  in plain text become a bold field and an underlined value.

  ```js
  KConditions.describe(document, { fields });
  // [State] is equal to "Florida"

  KConditions.describeHtml(document, { fields });
  // <span class="kcd"><strong class="kcd-field">State</strong> …
  ```

  ```php
  use function Kastrack\ConditionsEditor\{describe, describeHtml};
  ```

  Three decisions worth stating, because each one is a place this could have gone
  wrong:

  - **One walker, two formatters.** `describe()` was refactored into
    `describeWith(document, options, format)`, and the text and HTML versions are
    that function with different leaf formatting. Two separate renderings would
    have drifted — one of them would have started bracketing a nested group
    differently, or putting `NOT` in a different place, and nothing would have
    caught it. Now they cannot disagree about anything structural.
  - **Escaping is not optional.** There is no flag to turn it off. A document
    arrives from a browser, and so do the field labels and `emptyText` that get
    rendered alongside it, so `<img src=x onerror=…>` in a value comes back as
    text. That is also why this is a separate function rather than an option on
    `describe()`: the call site says out loud that it is producing markup.
  - **The `.kcd-*` styles are not scoped to the editor.** A rule is most often
    shown on a page that has no editor on it — a confirmation screen, an audit
    log. The block defers to the editor's `--kce-*` tokens when they exist and
    falls back to its own otherwise, so it matches the theme when the editor is
    present and still looks right when it is not.

- **`summaryHtml`** (default `false`) — render the editor's collapsed summary with
  `describeHtml()` instead of plain text. `editor.describe()` and
  `editor.describeHtml()` are both available directly, using the editor's own
  fields and operators.

- Namespaced `describe()` / `describeHtml()` wrappers in the PHP SDK, matching
  `evaluate()` and `toSql()`. The static `Evaluator::describe()` still works.

- 18 shared `describeCases` fixtures — text *and* HTML asserted byte-for-byte in
  both languages, including four escaping cases and a check that no unescaped tag
  survives. JS 83 → 102 assertions, PHP 78 → 96.

### Fixed

- **PHP `describe()` ignored choice labels**, rendering the stored value where
  JavaScript rendered the label: `[State] is equal to "FL"` against
  `[State] is equal to "Florida"`. `Support\Values` had no `normaliseChoices()`
  at all, so the three accepted `choices` shapes were never resolved on that
  side. Present since choices were introduced, and invisible because `describe()`
  had no shared fixtures — the conformance suite covered evaluation and SQL,
  where labels do not matter. It does now.

## [0.0.19] — 2026-09-03

### Added

- **`hideTextarea: 'toggle'`** — a third value alongside `true` and `false`. The
  field stays hidden, but a **Show source** button in the footer puts it back on
  screen. `setSourceVisible(true|false)` and `isSourceVisible()` do the same from
  code, and a `source` event fires either way.

  Distinct from the *View source* button that `debug: true` adds: that one shows
  the document being generated, this one shows the field it is written into.
  Their labels are separate keys (`revealField` / `concealField` versus
  `viewSource` / `hideSource`), so either can be renamed if you run both.

- **`hideTarget`** — a CSS selector, an element, or a list of either, hidden
  instead of the textarea. The usual case is the row carrying the field's label,
  which would otherwise be left behind labelling nothing:

  ```js
  hideTarget: document.querySelector('#conditions').closest('.row')
  ```

  Three things it has to get right, and does:

  - **The editor is inserted after the outermost hidden element**, not after the
    textarea. Inserting after the textarea would place the editor *inside* the
    row about to be hidden, and it would never be seen.
  - **The textarea is hidden regardless.** If the target does not contain it —
    naming only the label, say — the field joins the list, because a raw JSON
    textarea beside the builder is never the intent.
  - **A selector matching nothing** warns and falls back to hiding the textarea,
    rather than leaving the field on show.

  `destroy()` restores everything it hid, target elements included.

- `.kce-concealed`, a general form of the visually-hidden treatment that was
  previously `textarea.kce-hidden-textarea` and so could only apply to the
  field. The old class is still set on the textarea for anyone styling it.

## [0.0.18] — 2026-09-03

### Changed

- **Documentation only: `column` was already optional, and the docs implied it
  was required.** "Load the SQL builder and give each field a `column`" read as
  a prerequisite. It never was — a field's name is used as its column name
  unless you say otherwise, so a schema whose columns already match your field
  names needs no `fields` mapping at all, and a field the builder was never told
  about still resolves to its own name. Both SDKs have behaved this way since
  0.0.4 and a conformance fixture pins it.

  The README and the docs now lead with the no-mapping case, state the
  resolution order (`column` → `sql` → `name`, with the builder's `columns`
  option overriding all three), and mention that `fields` entries may be bare
  strings. `column` also appears in the field-definition reference, which had
  omitted it entirely.

## [0.0.17] — 2026-09-03

### Added

- **A `dist/` directory**, generated by `npm run build` and committed so that
  nothing you install needs a build step.

  - `k-conditions.min.css` — base plus every skin, ~6 KB gzipped.
  - `k-conditions.min.js` — evaluator, SQL builder and editor, ~21 KB gzipped.
  - The same two bundles unminified, for debugging.
  - One minified file per source, if you would rather pick.

  The sources remain the deliverable: they are hand-written ES5 UMD files that
  still work in a plain `<script>` tag, and `dist/` is generated from them.

  The JS bundle is **not** a concatenation. Each source is its own UMD module,
  so three of them run together would all take the CommonJS branch under a
  bundler and fight over `module.exports`, while
  `require('./k-conditions-evaluator.js')` would name a file that is not next to
  the bundle. Instead each file is given its own module scope and a `require`
  resolving from an in-bundle registry, and the bundle's own UMD wrapper decides
  what to export. The sources go in verbatim; nothing is rewritten.

- **`CLAUDE.md`** — the conventions this project has accumulated, written for
  whoever (or whatever) works on it next: the two-layout split, why history
  entries are recorded after the render, why node ids are positional, the four
  places a new colour needs a value, and the four user-reported bugs that passing
  tests could not see.

### Fixed

- **`debug: true` together with `collapsible: false` threw and the editor never
  rendered.** The *View source* button was inserted before the Done button,
  which exists but is only appended to the footer when the editor is
  collapsible — so `insertBefore` was handed a node that was not a child. Present
  since 0.0.4 and invisible until now because every test used one option or the
  other, never both. Found by the new `dist/` check, which happened to set both.

- The per-file minified copies kept `require('./k-conditions-evaluator.js')`, so
  `require('dist/k-conditions-sql.min.js')` could not resolve its dependency.
  The build now relinks those to the minified sibling.

## [0.0.16] — 2026-09-03

### Added

- **The add buttons preview themselves.** Pointing at `+AND`, `+OR` or
  `AND(…)` — or reaching one by tab — tints the rows that will end up bracketed
  together and drops a dashed *new condition* placeholder where the new row
  will land. The counterpart to the `×` preview, for the buttons whose effect
  is hardest to predict.

  The tint carries the hue of the bracket being formed and the ghost carries
  the operator on the button, which is what makes `AND(…)` legible: everything
  currently there goes blue (it stays an AND group), while the ghost below it
  is orange (the new condition joins by OR). `+OR` on a row tints only that
  row, because only that row joins the new one.

  The ghost is always inserted after the line the button sits on, never before
  it, so the button cannot move out from under the pointer — which would fire
  `mouseleave`, remove the ghost, move the button back, and flicker.

### Changed

- **The footer controls are left-aligned.** The problems list was taking the
  free space and pushing Undo / Redo / Clear / Done to the right edge; it now
  takes a row of its own above them and collapses when there is nothing to say.
- **`addBeside`'s decision is now `planAdd()`, and `wrapAndContinue`'s is
  `planWrap()`** — pure functions returning what would happen. The preview reads
  the same branch the click will take, so the two cannot drift apart. This is
  the only reason the preview is trustworthy.

### Fixed

- The `blackboard` skin never defined `--kce-accent-soft`, so it inherited the
  light value: hovering `+AND` painted a pale blue block on the dark board. It
  now has its own.

## [0.0.15] — 2026-09-03

### Changed

- **The brackets in the `prose` skin are darker and heavier.** They were drawn
  in `--kce-rule`, the hairline colour used for the ledger skin's guides, at
  0.8 opacity — but in this skin the brackets are the *only* thing carrying the
  grouping. There are no boxes and no rules, so they are structure, not
  decoration, and were too faint to read as either.

  New `--kce-paren` token (light `#59636f`, dark `#9aa5b4`, and a chalk value on
  `blackboard`), at full opacity, weight 600 and a touch larger. Retheming the
  brackets no longer means overriding the guide colour along with them.

## [0.0.14] — 2026-09-03

### Added

- **The operators line up.** In the flow layout a connector sits immediately
  after the row it follows, so its position depended on how wide that row
  happened to be — a group whose values read "Alabama", "California", "Florida"
  printed its `OR`s in three different places. For a layout whose whole argument
  is that a rule should read like an equation, a ragged operator column was the
  wrong look.

  Connectors now share a column per indent level: rows at the same indent
  already read as a column, so their operators join it, while a deeper group is
  a different thought and keeps its own. The column re-measures as an autosizing
  field grows and when the viewport changes, so it stays true while you type.

  `alignConnectors: 'group'` narrows it to one column per group; `false` turns
  it off, which is what you want if one very long row would drag its neighbours'
  operators out to the right.

- **A skin picker in both demos.** The landing page and the Playground can now
  swap between all five skins live, keeping whatever rule you have built — the
  Skins page shows them side by side, but it could not show you *your* rule in
  each. The Playground also gets a theme control (system / light / dark).

### Fixed

- A value field's autosize listener ran *after* the one that syncs, so anything
  measuring the row saw the width from the previous keystroke. Harmless until
  now; it made the new operator column lag a character behind while typing.

## [0.0.13] — 2026-09-03

### Fixed

- **A condition row's × showed the red border but not the red fill.** The tint
  and the row's own `:hover` background are on at the same time — the pointer
  is inside the very row it is about to delete — and the skins set that hover
  at equal specificity while loading after the base stylesheet, so they took
  the tie. The fill is now `!important`, which is what actually settles it.

  A group's × never hit this, because the pointer is not on the child rows;
  that is why the case shipped looking correct in the screenshots.

### Changed

- The removal-preview test now asserts the **painted colour**, in all five
  skins in both light and dark, rather than that the class was applied. The
  original check could not see this bug: the class was set correctly the whole
  time and the cascade discarded it. Reverting the fix makes the new test fail
  with `rgba(127, 140, 160, 0.11)` — the hover colour — which is the bug.

## [0.0.12] — 2026-09-03

### Added

- **A × shows what it would take before you press it.** Pointing at a remove
  button — or reaching it by tab — tints everything that would go in a light
  red: the row, or for a group every condition inside it plus the group's own
  brackets and `NOT`.

  This matters most in the `prose` skin, where a group is a range of lines
  rather than a box you can see, so a × at the end of one line gives no clue
  how much sits under it. New `--kce-danger-soft` and `--kce-danger-edge`
  tokens carry the tint, with dark-theme and `blackboard` values of their own.

  Because node ids are the node's path in the tree, "is this element inside
  that subtree" is a string prefix test — `r.1.0` is under `r.1`, and `r.10` is
  not. Nested matches are collapsed to the outermost, so the tint never stacks.

### Changed

- `Ctrl`/`Cmd`+`Y` as an alternative to `Ctrl`/`Cmd`+`Shift`+`Z` for redo was
  already implemented but only mentioned in passing. It is now in the README,
  the docs and the Redo button's own tooltip.

## [0.0.11] — 2026-09-03

### Fixed

- **`Ctrl`/`Cmd`+`Z` did nothing after the change you most wanted to undo.**
  The shortcut was bound to the editor's own element, so it only fired while
  focus was inside it — but a structural change rebuilds the tree, which
  destroys the button that was just clicked and drops focus back to the page
  body. Clicking `+AND` and then pressing `Ctrl`+`Z` therefore went nowhere,
  which is precisely the sequence someone undoes.

  Two fixes, either of which would have done it:

  - The shortcut now listens on the document and asks whether this editor holds
    the keyboard. Focus decides when there is any — only one editor can contain
    it — and otherwise it falls to whichever editor was last clicked in. So the
    shortcut survives a rebuild, several editors on one page do not all react to
    one keystroke, and clicking away from every editor hands `Ctrl`+`Z` back to
    the page.
  - The buttons that a rebuild destroys — `+AND` / `+OR`, `AND(…)` / `OR(…)`,
    the connectors, the empty-group starter — now carry focus keys like every
    other control, so focus lands back on them instead of being lost. Keyboard
    users get the tab position back as well.

  Still deliberately not ours: the shortcut inside a text input, where the
  browser's own undo stack applies.

## [0.0.10] — 2026-09-03

### Added

- **Undo and redo.** `Undo` / `Redo` in the footer, `Ctrl`/`Cmd`+`Z` and
  `Ctrl`/`Cmd`+`Shift`+`Z` (or `Ctrl`+`Y`), and `undo()` / `redo()` /
  `canUndo()` / `canRedo()` from code, with matching `undo` and `redo` events.

  A history entry is a serialised document and a cursor into a list of them, so
  there are no inverse operations to get wrong. Typing is the exception: a run
  of keystrokes in one field coalesces into a single entry, committed when the
  typing pauses (`historyIdle`, 500 ms), when focus leaves the field, or when
  anything else happens — otherwise undo would step one character at a time.
  Adding a chip to a list is discrete and gets its own entry.

  Inside a text input the shortcut is left to the browser, which has its own
  undo stack there and no way to be asked whether it still has anything left in
  it; the field's `input` event feeds the result back into the document either
  way. Everywhere else in the editor the shortcut is the editor's.

  `history: false` removes the feature; `historyLimit` (50) caps the stack.

- **Reordering, by keyboard and by drag.** Every row and group carries
  <em>move up</em> / <em>move down</em> buttons, and `Alt`+`↑` / `Alt`+`↓`
  anywhere in a row does the same thing — the accessible, touch-safe base that
  the drag is layered onto rather than an afterthought behind it.

  Dragging uses a grip that appears with the row's other controls, and pointer
  events rather than HTML5 drag-and-drop, which does not fire on touch at all. A
  drop indicator shows the boundary, indented to the level being reordered;
  `Escape` cancels mid-drag. Movement is within a node's own group, which is
  what makes a drop unambiguous in a nested tree.

  `allowReorder: false` removes both; `allowDrag: false` keeps the buttons and
  drops the grip. `moveChild(group, from, to)` is the primitive.

  Note that sibling order is presentational: `evalGroup` evaluates every child
  and accumulates, with no short-circuiting, so neither the result nor which
  callbacks run depends on it.

### Changed

- **Every mutation now goes through a named method** — `removeNode`,
  `moveChild`, `setGroupOperator`, `setNegate`, `setField`, `setOperator`,
  `setValueSource`, `setValue` — instead of being an inline closure in a
  renderer. That is what gives the history layer one place to hook, and it is
  worth having on its own.
- **Node ids are now the node's position in the tree**, reassigned on each
  render. They were already stripped from the output, so nothing outside
  depends on them — and making them positional means the control you are on
  keeps its focus and caret across a re-render, including the wholesale rebuild
  an undo performs.

### Fixed

- Rendering can settle the document itself — an empty enum value takes the
  first choice as it draws — so history entries are recorded after the render,
  not before. Taken beforehand, the top of the undo stack described a state
  that had never been on screen, and the first undo appeared to do nothing.

## [0.0.9] — 2026-09-03

### Added

- **`AND(…)` / `OR(…)` — close the current strand and start another.** Beside the
  last row of a group with more than one child, a third button offers whichever
  operator the group is *not* using. Clicking it puts everything built so far
  into a bracket, switches the group to the other operator, and leaves a fresh
  condition ready underneath. So `Name is B` → `+OR` → `Name is N` → `AND(…)` →
  `State is CA` → `+OR` → `State is LA` types out as
  `(Name is B OR Name is N) AND (State is CA OR State is LA)` in reading order,
  without anyone having to go back and insert a group.

  This is the counterpart to `+AND` / `+OR`, which bind *tighter* — they act on
  the row you clicked. `AND(…)` and `OR(…)` bind *looser*: they act on the whole
  group. Between the two, both halves of an expression can be reached by typing
  forwards.

  The new condition arrives as a plain sibling rather than inside a group of its
  own — a one-child group renders as an empty pair of brackets — and the very
  next `+OR` turns it into the group it was going to be anyway. If the wrapped
  group's new operator matches its parent's and neither is negated, it dissolves
  into the parent rather than nesting a redundant level.

  `allowWrapGroup: false` removes the button; `editor.wrapAndContinue(group, op)`
  does the same thing from code.

## [0.0.8] — 2026-09-03

### Added

- **"Clear and start over"** in the footer, behind a confirmation. The button
  swaps itself for an inline question rather than opening a `window.confirm`:
  a modal blocks the page, cannot be styled to match, and is awkward to drive
  from a test. Escape, the Cancel button, or a click anywhere else backs out.
  The control hides itself when the rule is already empty. `allowClear: false`
  removes it; `editor.clear()` does the same thing from code and fires a
  `clear` event.

### Fixed

- Elements toggled with `.hidden` were not hiding: several are flex containers,
  and an author `display` beats the UA stylesheet's `[hidden]` rule. Added a
  scoped `.kce [hidden] { display: none !important }`. This also affected the
  debug panel's collapse.

## [0.0.7] — 2026-09-03

### Changed

- The `+AND` / `+OR` buttons are now boxed, muted and hidden until wanted. They
  appear when the pointer is on the line they belong to — or when they take
  keyboard focus, so they stay reachable by tab — and carry the operator's hue
  blended back toward the muted text colour, a weight lighter than the real
  connectors. Pointing at one restores the full colour. The intent is that a
  rule at rest shows only the logic, and the controls surface where you are
  looking.
- New `--kce-and-muted` / `--kce-or-muted` tokens, derived from `--kce-and` and
  `--kce-or` with `color-mix` where supported and falling back to fixed values
  otherwise, so retheming still only means setting the two operator colours.
- The `+ Condition` starter on an empty group stays visible — there is no row to
  hover, and it is the only way to begin.

## [0.0.6] — 2026-09-03

### Changed

- **Rules are built from the logic word.** `+ Condition` and `+ Group` are
  replaced by `+AND` and `+OR` sitting beside the connector they extend.
  Clicking the operator the group already uses adds a condition there; clicking
  the other one wraps the condition on that line in a new sub-group carrying it.
  `State is CA` → `+AND` → `Name is Ben` → `+OR` → `Name is Nanci` therefore
  yields `State is CA AND (Name is Ben OR Name is Nanci)` with nobody having to
  think about brackets. A group of one child is retuned rather than wrapped, and
  `+OR` beside an existing OR group extends it instead of nesting another.
- Add buttons now sit to the right of each logic operator instead of on a rail
  below. Mid-list positions offer only the group's own operator; the last row of
  each group offers both. Group negate and remove stay on the group's own line.
- Add buttons read at full accent strength rather than as muted chrome, and
  darken further on hover — what used to be the hover colour is now the resting
  one. New `--kce-accent-strong` and `--kce-or-strong` tokens.
- **Values survive an operator change** wherever the slot still means the same
  thing: switching *is equal to* for *matches regex* keeps what you typed. A
  value is dropped only when it cannot fit the new slot — free text moving into
  a date operator that cannot parse it, or a scalar moving into a list.
- Free-text inputs carry a standing underline and start noticeably wider, so an
  empty value reads as somewhere to type rather than as a gap.

## [0.0.5] — 2026-09-02

### Added

- **`documentInComment`** (default `false`). With `output: 'sql'` the document
  rides along in a trailing SQL comment, so a single existing SQL field
  round-trips — no hidden input needed. The comment is a no-op to the database
  and the editor reads its own state back out of it on reload. It trails the
  expression rather than leading it, because in a visible field the SQL is what
  someone wants to read.
- A second worked example on the landing page: the editor pointed at a visible
  textarea that already accepts SQL, with a dialect switcher, showing the
  client-side generation path end to end.

### Changed

- **The SQL security guidance was too broad and is now situational.** Writing
  SQL client-side into a field that *already accepted SQL* adds no attack
  surface — the trust boundary has not moved, and the sanitising and sandboxing
  on the way in still apply. That is a supported, first-class use: giving people
  who do not write SQL a friendlier way to fill in a field they could otherwise
  only type into. Generating server-side from the document remains the right
  answer when the endpoint receives JSON today; the case to avoid is widening
  such an endpoint into accepting client-supplied SQL for convenience. Both
  modes are documented as equals.

## [0.0.4] — 2026-09-02

### Added

- **SQL output.** `src/k-conditions-sql.js` and `Kastrack\ConditionsEditor\SqlBuilder`
  render a document as a self-contained SQL boolean expression — the part after
  `WHERE`. Dialects: `mysql`/`mariadb`, `postgres`, `sqlite`, `sqlserver`,
  `standard`, differing in identifier quoting, string escaping, boolean literals
  and regular expressions. Optional parameterised output returns placeholders
  plus the bound values. 34 new shared fixtures compare the JavaScript and PHP
  builders character for character.
- Editor `output: 'sql'` writes the expression into the textarea instead of the
  JSON, with `documentInput` naming a second field that carries the document so
  the rule can still be reloaded. `sql: {…}` passes options to the builder, and
  `getSql()` returns `{sql, params, dialect, skipped, warnings}`.
- Fields take a `column`, the SQL name, defaulting to `name` — so the document
  and your schema need not agree on spelling.
- Custom operators take an `sql` template (`{field}`, `{0}`, `{values}`), which
  is how a callback operator gets a SQL translation. Without one it falls to the
  `unresolved` policy, so `{"unresolved": {"sql": "skip"}}` drops it from the
  WHERE clause and leaves it to be evaluated in code. A new `unsupportedPolicy`
  covers operators a dialect cannot express at all.
- **Keyed field choices.** `choices` — and a `values` operator's `values` — may
  now be an array of scalars, an array of `{value, label}`, or an associative
  map `{ FL: 'Florida' }`. The label is used in the dropdowns, the collapsed
  summary and `describe()`, while the document stores the value.
- **`debug: true`** adds a *View source* button opening a tabbed panel: the
  document, the generated SQL with its parameters and warnings, and the
  plain-English summary with validation problems. Off by default.

### Fixed

- The debug panel's class names collided with the value-source select's
  `.kce-source`; the panel is now `.kce-devtools`.
- `documentInput` no longer discards a rule already sitting in the textarea when
  the document field is empty — it falls back to the textarea.

## [0.0.3] — 2026-09-02

### Changed

- In the `prose` skin, a group's `+ Condition / + Group / NOT / ×` controls now
  follow its opening line directly, separated by a single wide space, instead of
  being pushed to the right-hand edge of the container. The pointer is already
  near the bracket that opened the group, so the controls are where the hand is.
  They still fade in on hover and reserve their space, so nothing shifts.

## [0.0.2] — 2026-09-02

A design pass on the editor. No changes to the document format, the SDKs or the
conformance fixtures — a 0.0.1 document evaluates identically.

### Added

- **Five skins**, selected with the new `skin` option: `prose` (the new
  default), `equation`, `blackboard`, `ledger` and `boxed` (the 0.0.1 look).
  Alternative skins live in `src/k-conditions-skins.css`, which is now required
  unless you use `boxed`.
- **A flow layout.** `prose` renders the rule the way a formatter prints an
  expression: one line per condition, indentation by nesting depth, an opening
  bracket trailing the connector that introduced it, and a closing bracket on
  its own line — so a line can read `) AND NOT (`. This needs a different DOM
  from the nested-box layout, not just different CSS, so the editor now has two
  renderers and the `skin` option picks between them. `layout: 'tree' | 'flow'`
  overrides the choice.
- `theme` option and `setSkin()` / `setTheme()` methods.
- Connector controls between sibling rows: the AND/OR is now a button sitting
  between the conditions it joins, instead of a toggle in a group header.
- `skins.html`, rendering all five treatments side by side, live and editable.
- New theming tokens: `--kce-field`, `--kce-op`, `--kce-value`, `--kce-rule`,
  `--kce-indent-step`.

### Changed

- **The default skin is now `prose`, not `boxed`.** Pass `skin: 'boxed'` to keep
  the 0.0.1 appearance exactly.
- Rows size to their content instead of filling the container. Selects render at
  the width of their *chosen* option rather than their widest one, by laying the
  real control transparently over a span carrying the label; text and number
  inputs size to their value.
- In the flowing skins the literal/field switch is a small chevron rather than
  the word "Value"/"Field" — a field used as a value already reads as
  `[Billing Email]`.
- A negated group shows `NOT` beside its bracket rather than a checkbox in a
  header.
- Group controls are quiet until hovered, and in the flow layout ride on the
  line where the group opens rather than taking a line of their own.
- The tag input's placeholder shortens once the list has entries, so a long hint
  no longer stretches the row.

### Fixed

- The `boxed` skin's tag input inherited the wrong font size.

## [0.0.1] — 2026-08-27

First cut. Everything below is new.

### Editor

- `kConditionsEditor` takes over a `<textarea>`, showing a collapsed summary
  ("Always" by default) and an **Edit Conditions** button until opened.
- Nested indented group builder with per-group AND/OR toggles, optional `NOT`,
  and add/remove for conditions and sub-groups up to `maxDepth`.
- Field, operator and value-source dropdowns driven by the field definitions
  passed at initialisation.
- Values may be literals or other fields, with `comparableWith` restrictions
  (by name, `type:`, `group:` or `*`).
- Chip input for list operators, choice dropdowns for `enum` fields, native
  date and number inputs where the operator asks for them.
- Live validation, live plain-English summary, and real-time JSON written back
  to the textarea on every change.
- Themeable entirely through `--kce-*` custom properties; light and dark.

### Document format

- Spec version `1.0`, documented in `SPEC.md` with a JSON Schema in
  `schema/condition-document.schema.json`.
- Nested group/condition nodes, literal and field value sources.
- Custom operators declared in the document: `values` (fixed value sets) and
  `callback` (host function dispatch) kinds.
- Per-context failure policies (`skip` / `true` / `false` / `error`) for
  unresolved and erroring operators, keyed by profile, environment or runtime.
- `availableIn` for declaring an operator server-only.

### SDKs

- **JavaScript / Node** (`src/k-conditions-evaluator.js`): UMD, zero
  dependencies, works in the browser and under Node.
- **PHP** (`sdk/php/`): PSR-4 `Kastrack\ConditionsEditor`, PHP 8.1+, Composer
  package or standalone autoloader.
- Both expose `evaluate()`, `evaluateDetailed()`, `describe()`,
  `validateDocument()`, an operator registry, and an optional result hook that
  replaces the boolean return value.
- 34 shared conformance fixtures run against both SDKs so they cannot drift.

### Docs

- Landing page with a live demo, a playground, and a full API reference, all
  ready for GitHub Pages.

[0.0.19]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.19
[0.0.18]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.18
[0.0.17]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.17
[0.0.16]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.16
[0.0.15]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.15
[0.0.14]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.14
[0.0.13]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.13
[0.0.12]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.12
[0.0.11]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.11
[0.0.10]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.10
[0.0.9]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.9
[0.0.8]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.8
[0.0.7]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.7
[0.0.6]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.6
[0.0.5]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.5
[0.0.4]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.4
[0.0.3]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.3
[0.0.2]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.2
[0.0.1]: https://github.com/KAStrack/kConditionsEditor/releases/tag/v0.0.1
