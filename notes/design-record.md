# kConditionsEditor — design record

*The running record of what was decided and why, version by version. The
per-version notes beside this file carry the detail; `CHANGELOG.md` is the
user-facing version of the same story. Kept in the repository from 0.0.22 so it
travels with the code.*

Last updated: 2026-10-19 (version 0.1.1)

## What this is

A front-end JS plugin that takes over a `<textarea>` and provides a condition
builder, writing portable JSON — or SQL — back into the textarea in real time.
Plus evaluator SDKs that turn the JSON into a boolean, SQL builders that turn it
into a WHERE clause, and `describe()` / `describeHtml()` that turn it into a
sentence for a reader.

Shipped to Ben as `kConditionsEditor-<version>.zip` on every change — his
standing convention. The zip carries `.git`, and from 0.0.17 a built `dist/` and
a `CLAUDE.md`.

## Decisions made (2026-08-27, v0.0.1)

| Decision | Choice |
|---|---|
| Packaging | Zero-dependency vanilla JS, no build step required to *use*. UMD files loaded with `<script>` |
| SDKs | JavaScript/Node and PHP |
| JSON shape | Nested groups: `{type:'group', operator:'and', children:[…]}` |
| Licence / namespace | MIT; npm `@kastrack/conditions-editor`, composer `kastrack/conditions-editor`, repo `kConditionsEditor` |
| Custom operators | `values` (fixed set) and `callback` (host function) |
| Context keys | Named profiles with fallbacks: `profiles → environment → runtime → "*"` |
| Default unresolved policy | `error`, chosen at evaluator initialisation |
| Skip semantics | A skipped condition behaves as if it were never in the document; empty groups drop too; a fully skipped document returns `emptyResult` |
| Result hook | Optional trailing callable `(document, data, options, result, details)` replaces the boolean |

## v0.0.2–0.0.3 — design pass

Brief: too many borders, everything full width; should read "like a complex
logic equation written on a blackboard" — less boxed, more free text, not scrawly.

| Decision | Choice |
|---|---|
| Default skin | `prose` |
| Skins | `prose` (default), `equation`, `blackboard`, `ledger`, `boxed` |
| Two layouts | `flow` (prose) and `tree`. Not CSS-only: inline formatting cannot indent wrapped lines, nested blocks cannot put `) AND NOT (` on one line |
| Prose formatting | Opening bracket trails the connector (K&R); closing bracket on its own line; indent by depth |
| Row width | Content-width; selects sized to their chosen option via a transparent select over a label span |

Rejected: serif "bookish" typography; ledger gutter connectors; inline prose
without a line renderer.

## v0.0.4–0.0.5 — SQL, choices, debug

| Decision | Choice |
|---|---|
| Field choices | Scalars, `[{value,label}]`, or an associative map. Label shown, value stored |
| SQL | Builder in both SDKs; `mysql`/`mariadb`, `postgres`, `sqlite`, `sqlserver`, `standard` |
| SQL field names | `column` per field, **defaulting to `name`** |
| Callbacks in SQL | No translation → `unresolved` policy; an `sql` template gives one |
| SQL null semantics | Null-safe negation; `date_eq` a half-open day range; relative dates resolved at build time |
| Editor SQL output | `output: 'sql'`; state in `documentInput` or `documentInComment` (**trailing** comment) |
| Debug | `debug: true` → View source, tabs for document / SQL / summary |

**Security stance, corrected in 0.0.5.** 0.0.4's "never execute SQL a browser
sent you" was too broad; Ben pushed back. Server-side from the document is right
when the endpoint receives a rule; client-side into the textarea is right when
the field *already accepted SQL* (his case: existing SQL textarea, sanitised
server-side, run on a temp database with a limited user). What to avoid is
widening a JSON endpoint into executing client SQL.

## v0.0.6–0.0.9 — the build model

| Decision | Choice |
|---|---|
| Adding conditions | `+ Condition` / `+ Group` replaced by `+AND` / `+OR` beside the connector they extend. Matching operator adds a condition; the other wraps the condition on that line in a new sub-group |
| Worked example | `State is CA` +AND `Name is Ben` +OR `Name is Nanci` → `State is CA AND (Name is Ben OR Name is Nanci)`. Verified in browser (verify7.js) |
| Placement | Right of each logic operator. Mid-list offers the group's own operator; the last row of each group offers both. Negate and remove stay on the group's own line |
| Tree-flattening | A group of one child is retuned, not wrapped; `+OR` beside an existing un-negated OR group extends it |
| Value preservation | `remapValues()` keeps values across operator/field changes when kinds are compatible (families: scalar / date / list) |
| Free-text inputs | Standing dashed underline; autosize min 14 chars (6 number, 12 tag input) |
| Button treatment (0.0.7) | Boxed; hidden until the line is hovered or they take focus; tinted with the operator hue blended toward muted text; full colour on direct hover |
| Why max-width, not display:none | Keeps them in the tab order; `:focus-within` expands them |
| Empty groups | Keep a permanently visible `+ Condition` starter — nothing to hover |
| Boxed skin | Renders the connector row (word hidden) purely to host the add button |
| Clear (0.0.8) | Footer button that swaps itself for an inline question, not `window.confirm`. Escape / Cancel / outside click backs out; hidden when already empty |
| Wrap (0.0.9) | `AND(…)` / `OR(…)` beside the last row of a group with >1 child, showing only the operator the group is *not* using |

### The precedence pair (0.0.9)

- `+AND` / `+OR` bind **tighter** — they act on the row you clicked.
- `AND(…)` / `OR(…)` bind **looser** — they act on the whole group.

Between them, `(B OR N) AND (CA OR LA)` is reachable by typing forwards in
reading order. Inside `wrapAndContinue`: the new condition is a **plain sibling**
(a one-child group renders as an empty bracket pair), and a wrapped group whose
operator matches its parent's **dissolves into the parent**. The button hides
when `depthOf(group) + heightOf(group) >= maxDepth`.

## v0.0.10 — undo/redo and reordering

Ben chose all three recommended options: structural **plus coalesced text**
undo; move buttons **plus drag in every skin including prose**; **within-group**
movement only.

| Decision | Choice |
|---|---|
| Mutation API | Every document change goes through a named method — `removeNode`, `moveChild`, `setGroupOperator`, `setNegate`, `setField`, `setOperator`, `setValueSource`, `setValue`, plus `addBeside` / `wrapAndContinue` / `clear`. `mutate(fn, opts)` wraps them |
| History model | A list of serialised documents and a cursor (`history.stack`, `history.at`). No inverse operations |
| **Entries recorded AFTER the render** | `render()` can settle the document itself — an empty enum takes its first choice as it draws — so a pre-render snapshot described a state that never existed and the first undo appeared to do nothing. The constructor seeds its baseline after the first `sync()` for the same reason |
| Text coalescing | `noteEdit(key)` per keystroke; a different key, an idle timer (`historyIdle`, 500 ms), a blur, or any `mutate()` flushes. Chips push immediately |
| Ctrl+Z inside inputs | Left to the browser (it has its own stack and cannot be asked what is left in it); the field's `input` event feeds the result back into the document. Ours everywhere else |
| **Positional node ids** | `assignPathIds(root, 'r')` at the top of `render()`; a node's id is its path (`r.0.1`). Ids were already stripped from output. Every control carries `data-fk` = `<path>:<slot>`; `captureFocus()` / `restoreFocus()` keep focus and caret across a rebuild, undo included |
| Reorder interface | Move up / move down buttons and `Alt`+`↑`/`↓` first; drag layered on the same `moveChild` primitive. Buttons disabled, not removed, at the ends |
| Drag mechanics | Pointer events, not HTML5 DnD (which never fires on touch). Grip with `touch-action: none`; 4px slop before the drag begins; Escape cancels; verified with real touch pointers on a Pixel 5 profile |
| Drop hit-testing | `siblingBounds(parent)` → n+1 client-Y boundaries, nearest wins, `moveToBoundary` converts to an index. Flow uses `flowSpans` line ranges recorded in `renderFlow`; tree uses `[data-kce-child]` under the matching `.kce-group-children`. `siblingIndent` insets the indicator to that level |
| Options | `history`, `historyLimit` (50), `historyIdle` (500), `allowReorder`, `allowDrag`. Events `undo` / `redo` |

## v0.0.11 — the Ctrl+Z bug

**Reported by Ben immediately after 0.0.10 shipped: pressing Ctrl+Z did
nothing.** Worth remembering as a testing lesson, not just a fix.

The shortcut was bound to the editor's own element, so it only fired while focus
was inside it. But a structural change rebuilds the tree, destroying the button
that was just clicked and dropping focus to `document.body` — so clicking `+AND`
and then pressing Ctrl+Z went nowhere, which is *exactly* the sequence anyone
undoes. My own 0.0.10 test happened to focus a move button first (which does
carry a focus key) and so never saw it.

| Decision | Choice |
|---|---|
| Listener scope | `document`, not the editor element. `hasKeyboard()` decides ownership: focus wins when there is any (only one editor can contain it), otherwise it falls to whichever editor was last clicked in (`engaged`, set by a capture-phase `pointerdown`) |
| Why "last clicked" | Survives a rebuild that dropped focus; keeps five editors on one page from all reacting to one keystroke; clicking outside every editor hands Ctrl+Z back to the page |
| Second fix | The buttons a rebuild destroys — `+AND`/`+OR`, `AND(…)`/`OR(…)`, connectors (`:conn-<index>`, keyed by the child they follow), the empty-group starter — now carry `data-fk` like every other control, so focus lands back on them. Fixes the keyboard tab position too |
| Unchanged | Inside `INPUT`/`TEXTAREA` the shortcut is still the browser's |

**Testing lesson:** a shortcut test must reproduce the *user's* focus state, not
a convenient one. `verify17.js` now does the real sequence — click a button that
triggers a rebuild, then press the key — plus focus blown away entirely, two
editors on a page, clicking outside, and Meta+Z.

## v0.0.12 — the removal preview

Ben: "when hovering over an × it should highlight in a light red colour
everything that will be removed."

| Decision | Choice |
|---|---|
| Subtree test | **A string prefix on the positional node id.** `r.1.0` is under `r.1`; `r.10` is not, because the dot is required. The 0.0.10 id change paid off a second time |
| What carries `data-node` | `.kce-condition` rows, the tree layout's `.kce-group` box, and in flow the group's parens, `NOT` marker and `.kce-group-tools` — a group has no element of its own there, so its punctuation is how it shows itself |
| Nesting | Matches inside another match are dropped, so the tint never stacks its background |
| `showRemoval` clears first | A `mouseleave` can be missed, and a tint outliving its cause would be a standing lie about what the next click does |
| Trigger | `mouseenter`/`mouseleave` **and** `focus`/`blur`, so tabbing to a × previews it too |
| Tokens | `--kce-danger-soft` / `--kce-danger-edge`, with dark-theme values; `blackboard` sets its own because it paints a dark board *without* switching the theme tokens — the light pink otherwise landed under chalk-coloured text |
| `!important` on parens | The skins colour `.kce-paren` at higher specificity and load later; a bracket keeping its normal colour would say the group survives the click |

Also 0.0.12: `Ctrl`/`Cmd`+`Y` for redo already worked — Ben asked for it because
it was undocumented. Now in the README, docs and the Redo tooltip.

**Second testing lesson (same family as 0.0.11):** the first screenshot attempt
missed the × entirely. Hovering a line expands `.kce-adds` from `max-width: 0`,
which shifts the rest of that line rightward — so a bounding box measured
*before* the hover points at the wrong control. Measure after the row is
hovered. This is the known 0.0.7 reflow trade-off biting a test.

## v0.0.13 — the tint that had no fill

**Reported by Ben the same day: hovering the × on a single condition showed the
red border but not the red background.** The third user-caught bug in a row that
my own tests could not see, and the most instructive.

The tint and the row's own `:hover` background are on at the same time — the
pointer is inside the very row it is about to delete. The skins set that hover at
*equal* specificity (`.kce[data-kce-skin="prose"] .kce-condition:hover`) and load
after the base stylesheet, so they took the tie. The `box-shadow` border had no
competition, which is why the outline appeared and the fill did not. A group's ×
never hit this, because the pointer sits on the group's tools line and not on the
child rows — so every screenshot I took of the feature looked correct.

Fix: `background: var(--kce-danger-soft) !important` on
`.kce-condition.kce-will-remove` and `.kce-group.kce-will-remove`.

**Third testing lesson, and the general one:** `verify18.js` asserted that the
class was applied. The class *was* applied — the cascade discarded the
declaration afterwards. A CSS feature has to be tested on the **painted result**,
not on the markup meant to produce it. `verify19.js` reads
`getComputedStyle().backgroundColor` for the tinted row across all five skins in
both light and dark; reverting the fix makes it fail with
`rgba(127, 140, 160, 0.11)` — the hover colour — which is exactly what Ben saw.

## v0.0.14 — connector alignment and the skin picker

*(Full write-up: `0.0.14-alignment-and-skin-picker.md`.)*

Ben's screenshot showed the `or`s on the right not lining up.

| Decision | Choice |
|---|---|
| Alignment unit | **One column per indent level**, not per group. Per-group was tried first: it fixed the reported case but left sibling groups 46px apart, which read worse than the ragged original |
| Mechanism | `data-conn-depth` buckets; measure `offsetLeft` for each connector in a bucket; pad the short ones with `margin-left` |
| Option | `alignConnectors: true` (per level), `'group'` (per group), `false` (off) |
| Skin picker | Added to `demo.html` — the skins were only comparable by opening `skins.html` side by side |

## v0.0.15 — brackets

One line of feedback, one change: the parentheses in the default theme were too
faint to carry the structure they are the only evidence of. Darker colour, weight
600, and a `--kce-paren` token so a skin can override it.

## v0.0.16 — add previews, left-justified footer

*(Full write-up: `0.0.16-add-preview.md`.)*

Ben: left-justify the footer buttons, and can hovering `+AND` / `+OR` / `AND(…)`
preview what is about to happen, the way hovering × previews what is about to go?

| Decision | Choice |
|---|---|
| **Plan functions** | `planAdd()` and `planWrap()` — pure functions returning what *would* happen. Both the preview and the click read the same plan, which is the only reason the preview can be trusted to match the result. Now a stated convention in CLAUDE.md |
| Preview form | A ghost row showing the condition or bracket that would appear, in the accent colour, inserted **after** the button's own line |
| Why after | Inserting the ghost *above* the button moved the button out from under the pointer, producing a mouseleave/mouseenter flicker loop |
| blackboard fix | It had no `--kce-accent-soft` of its own and inherited the light value, painting a pale blue block on the dark board |

## v0.0.17 — `dist/`, and CLAUDE.md

*(Full write-up: `0.0.17-dist-and-claude-md.md`.)*

| Decision | Choice |
|---|---|
| Minified per-file **and** combined | `dist/k-conditions.min.css` and `dist/k-conditions.min.js` are the one-file-each option (21 KB gzipped together); per-source minified files remain for anyone picking |
| Bundling method | **Not concatenation.** Each source is wrapped in its own module scope with an in-bundle `require` registry, because the files are UMD and genuinely `require` each other |
| Per-file minified copies | Have their `require('./k-conditions-*.js')` relinked to `.min.js`, or a minified file loads an unminified sibling |
| `dist/` is committed | So installing the package never requires a build. The sources stay the deliverable; `dist/` is never hand-edited |
| `CLAUDE.md` | In the repo and the zip: what the project is, the two-layout split, the conventions that bite, the testing lessons, the version ritual, the deliberate non-goals |

## v0.0.18 — SQL `column` falls back to `name`

*(Write-up: `0.0.18-to-0.0.20-source-toggle-and-describe-html.md`.)*

Documentation only. It already did, since 0.0.4 — but every example set `column`
explicitly, which taught readers it was mandatory. **An example that always
passes an optional argument documents it as required.**

## v0.0.19 — showing the field again, and hiding something else

| Decision | Choice |
|---|---|
| `hideTextarea: 'toggle'` | A third value: field stays hidden, a **Show source** button in the footer puts it back. `setSourceVisible()` / `isSourceVisible()`, `source` event |
| Kept distinct from debug | *View source* (debug) shows the **document**; *Show source* shows the **field it is written into**. Separate label keys so either can be renamed |
| `hideTarget` | A selector, element, or list of either, hidden instead of the textarea — typically the row carrying the label, which otherwise labels nothing |
| **Editor inserted after the outermost hidden element** | Not after the textarea — that would put the editor *inside* the row about to be hidden. Now a CLAUDE.md convention |
| Textarea hidden regardless | If the target does not contain it, the field joins the list. A raw JSON textarea beside the builder is never the intent |
| Empty selector | Warns and falls back to hiding the textarea, rather than leaving the field on show |
| `.kce-concealed` | A general form of the visually-hidden treatment that was previously bound to the textarea alone |

**Fourth testing lesson:** `debug: true` with `collapsible: false` threw and the
editor never rendered — present since 0.0.4, because every test used one option
or the other. **Cross the option combinations, not just the defaults.**

## v0.0.20 — `describeHtml()`

*(Full write-up in the same notes doc as 0.0.18–0.0.19.)*

Ben: could there be an option to show the fields as HTML — `[fieldname]` becoming
`<strong>fieldname</strong>`, the value maybe underlined? He chose **dashed
underline plus the value colour** (matching the editor's own free-text inputs)
and **both scopes**: a standalone SDK function *and* the editor's summary.

| Decision | Choice |
|---|---|
| **One walker, two formatters** | `describeWith(document, options, format)`; `describe()` and `describeHtml()` are that one walk with different leaf formatting. Two traversals would eventually disagree about bracketing or `NOT` placement and nothing would catch it. Same principle as the 0.0.16 plan functions |
| Separate function, not a flag | A boolean in an options object is easy to read past; `describeHtml()` at the call site says out loud that markup is being produced |
| **Escaping has no opt-out** | The document, the field labels and `emptyText` are all client-supplied |
| **`.kcd-*` is not scoped to the editor** | A rule is usually shown on a page with no editor on it. The block defers to `--kce-*` tokens when present, falls back to its own otherwise. `docs.html` proves it by loading only the base stylesheet and rendering a sample |
| Classes | `.kcd`, `.kcd-field` (a `<strong>`), `.kcd-op`, `.kcd-value`, `.kcd-list` / `.kcd-sep`, `.kcd-logic` (+ `.kcd-and` / `.kcd-or`), `.kcd-not`, `.kcd-paren`, `.kcd-join`. No inline styles |
| `summaryHtml` | Default `false`. Renders the collapsed summary with `describeHtml()`. `editor.describe()` / `editor.describeHtml()` use the editor's own fields |
| PHP wrappers | Namespaced `describe()` / `describeHtml()` beside `evaluate()` and `toSql()`; the static `Evaluator::describe()` still works |

**The bug the fixtures found: PHP `describe()` ignored choice labels**, rendering
`"FL"` where JavaScript rendered `"Florida"`. `Support\Values` had no
`normaliseChoices()` at all. Present since choices were introduced in 0.0.4, and
invisible because `describe()` had **no shared fixtures** — the suite covered
evaluation and SQL, where a display label is irrelevant. `describe()` is the only
output where the label matters, and it was the only one not compared across
languages.

**Fifth testing lesson:** *a conformance suite only pins what it compares.* Any
output an SDK produces that no fixture asserts is free to differ, and will.
18 `describeCases` now assert text *and* HTML byte-for-byte in both languages.

## v0.0.21 — the operator decides the value control

*(Full write-up: `0.0.21-operator-decides-the-value-control.md`.)*

Ben reported that an enum field showed its choice dropdown for `contains`,
`starts with`, `matches regex` and the rest — and asked, separately, whether
there was a blanket way to remove the Value / Field picker. Both came from the
editor answering a question with the wrong piece of information.

| Decision | Choice |
|---|---|
| **`valueFromChoices` operator metadata** | True by default, false on `contains` / `not_contains` / `starts_with` / `ends_with` / `regex` / `not_regex`. Whether the operand comes from the field's value set is a property of the **operator**, not the field: `field.type === 'enum'` was the wrong test |
| Where it lives | On the operator, in both SDKs — not an editor option. `describe()` runs server-side in PHP with no editor anywhere, and the control and the description must not disagree about what kind of thing the operand is |
| Second bug it exposed | `describe()` relabelled fragments: a rule searching for the letters "FL" rendered as `[State] contains "Florida"` — a *different rule* from the one stored. Fixed by the same flag |
| Still labelled | `is one of` / `is equal to` — those operands really are whole values |
| **`allowFieldValues`, default `false`** | Ben chose to flip the default rather than only add an opt-out. The picker used to appear on every row with a value, because a field saying nothing defaulted to "comparable with every other field of the same type" |
| Per-field opt-in | Naming `comparableWith` is read as asking for it, so the per-field setting is reachable without the global. `comparableWith: false` still wins when the global is on |
| **A setting never traps stored data** | An existing `{source:'field'}` value always keeps its selector, and the referenced field is listed even when the current rules would not offer it. The rule governs what can be *created* |

**Sixth testing lesson.** `verify8.js` had been red for several versions and had
quietly dropped out of the release regression, because I was running an explicit
list of scripts rather than everything. The cause was in the test: the add
preview fires on **focus** as well as hover, so a focused add button left a
`.kce-ghost` row in the DOM, and the ghost shifted the line list the next step
indexed into. *Anything that inserts DOM on hover or focus invalidates a
measurement taken after it* — the 0.0.12 lesson with a new cause. And *a
permanently red script is worse than no script*, because the suite stops being
read: the regression is "run everything", not a list. `verify26.js` also
hardcoded the version and went red on the bump; it now reads `package.json`.

## v0.0.22 — made inheritable

Ben asked for "a CLAUDE.md ready for Claude Code to take over this project".
One had shipped since 0.0.17, but it was written as in-repo guidance rather than
a handover, and two things made a real takeover impossible.

| Decision | Choice |
|---|---|
| **The browser checks moved into the repo** | All 27 lived in the authoring sandbox, so a clone had no coverage of hover, drag, keyboard, paint or focus — the behaviours that account for most of the bugs this project has shipped. Now `tests/browser/`, named for what they check rather than `verify<N>.js` |
| A runner, not a list | `npm run test:browser` runs **every** script in the directory and exits non-zero if any is red. The "run everything" rule is enforced rather than remembered |
| How a check fails the run | Non-zero exit, a `FAIL` line, a non-zero failure count, reported console errors, or *no verdict at all* — the last catches a script that dies quietly. Belt and braces because the older scripts predate the shared harness and signal only through stdout |
| `tests/browser/harness.js` | `serve()` on an ephemeral port, `scratch()` for throwaway pages, `shot()` for screenshots, `checker()`, `watchErrors()` |
| Scratch pages get `<base href="/">` | They reference the sources relatively and used to sit in the repository root. Moving them under `tests/browser/.scratch/` broke those paths until the harness started injecting a base |
| **The design record moved in too** | `docs/notes/` — this file plus the per-version notes, so the reasoning travels with the code |
| `dist/` documentation corrected | README, CLAUDE.md and the 0.0.17 note all claimed `dist/` was committed. It is git-ignored; `prepublishOnly` builds it for npm, and a clone must run `npm run build`. `dist-bundles.js` now says so plainly instead of failing on a missing file |

## v0.0.23 — an editor you can find again

Ben asked how to destroy an editor when the `attach()` return value is gone. The
answer was "you cannot", and the manual workaround was worse than it looked:
the root comes out cleanly, but the document-level keydown listener survives,
and the dead editor still believes it owns the keyboard until the next click
anywhere — so one Ctrl+Z writes an undone document into the field.

The fix is a handle on the element, `textarea.kConditionsEditor`, read by
`KConditionsEditor.get()` / `detach()` and cleared by `destroy()`. With the
handle in place the constructor can also see an existing editor and destroy it
before building, so a second `attach()` replaces rather than stacks.

The question worth recording is whether a second attach with identical options
should be a no-op. It should not, and not because it is hard: an options object
carries callbacks, so "identical" cannot be decided; and the textarea's value
may have changed since the first attach, so the caller saying `attach()` is
saying "take the field as it is now". A caller who wants reuse says `get()`.
One rule — attach means replace — instead of a comparison that would be
subtly wrong.

## v0.0.24 — keeping what the editor cannot read

Ben's app has fields holding hand-written SQL and no document. Attaching to one
destroyed it: the constructor's `sync()` wrote `1 = 1` over the field before
anyone had touched anything, and nothing on screen said what had been there.

**Could the SQL be parsed back?** Assessed, and two different problems hid in
the question. SQL *this library emitted* is a closed grammar — a reverse parser
over the operator table is a few hundred lines and the SQL fixtures double as
round-trip cases — but the emitter is lossy: relative dates are baked to
absolute literals, `date_eq` and `date_is_today` share a shape, `1 = 1` has
four preimages, `NOT (x)` is a negated condition or a negated one-child group.
SQL *written by hand* is open-ended, and the document has no leaf for an
expression it does not understand. Ben first asked for a minimum-subset
importer, then decided against any parser. Right call: a parser that is
sometimes wrong about a rule is worse than one that says it cannot read it.

**What was built instead.** `parseInitial()` records unreadable content in
`preserved` and sets `pristine`; `sync()` skips the field, the `documentInput`
and the synthetic `input`/`change` events while `pristine` is set; `touch()`
ends it on the first user-driven change. A notice between the summary and the
body — on screen collapsed or open, outside the tree so a render does not
rebuild it — shows the original text until dismissed.

Two decisions worth recording. *Pristine is a flag consulted in `sync()`*, not a
guard at each write site, because `sync()` is the one place the field is
written and the paths that reach it are many. *The paths that end pristine are
the user's paths* — `mutate()`, `setValue()`, `commitValue()` (the chip inputs
and the field-value select, which used to call `sync(); pushHistory()` by hand
in seven places), `setDocument()` and undo/redo — and nothing else: not the
constructor, opening, re-skinning, rendering or the debug panel, or an untouched
form would submit a destroyed rule again by another route.

## v0.0.26 — narrow hosts

Reported from KAStrack's 545px properties dialog: *"the buttons show up on
hover, but they seem small, highlights occur everywhere, and it just seems
squirrelly."* The report came with measurements, and they split into three
faults. Detail in `0.0.26-narrow-hosts.md`.

| Fault | Cause | Fix |
|---|---|---|
| Controls below the row, a blank band on every row | `.kce-condition` was `flex-wrap: wrap`; a wrapping flex line breaks before anything shrinks | Rows never wrap; the value slot shrinks first (`flex-shrink: 100`), names ellipsis last, controls never |
| The row was too wide at all | The host's form CSS reached the value input (a 24rem box) | Box metrics pinned on `.kce .kce-tree input.kce-input` — above element and class-scoped host rules |
| Small, faint controls | 12×10 grip, 20px buttons, reveal at `opacity: 0.55` (~2:1) | 24×24 targets (pseudo-element for the inline labels); reveal is 0 → 1 with the muted colour |

Decisions Ben made when offered the trade-off: reset host styles at skin
specificity rather than with `!important` (a host that restyles on purpose
keeps that power); hide the end-of-list arrow rather than show it readable
(`visibility: hidden` keeps its space, so no reflow); keep prose's hover-reveal
but show everything at rest under `(hover: none)`, rather than borrow boxed's
always-visible controls.

Three things the report did not name, found by measuring the same width:
`alignConnectors()` re-measured only on window resize, so an editor attached in
a hidden dialog never aligned (now a `ResizeObserver` on the tree); alignment
could push a connector onto a second line (now undone per connector when it
would); and in prose a group's tools, invisible at rest, wrapped under the
group's opening bracket — the same reserved band as the rows. They now move to
the group's closing line when they do not fit after the bracket, measured
without moving anything, so focus survives the keystroke-rate `sync()`. The
tree skins' tool rail gets the same measured treatment (`kce-rail-inside`),
because the 700px viewport query that folds it in cannot see a dialog.

## v0.0.27 — preview styles

The 0.0.16 add preview was called "too messy": a fill and outline on every
element, so a range was a stack of ragged boxes, plus a box around the group's
tools, plus a filled pill for the ghost. And `AND(…)` / `OR(…)` left out the
operators inside the bracket, because connectors are tagged by group
(`data-conn-group`) and `subtreeTargets()` only sees `data-node`. Detail in
`0.0.27-preview-styles.md`.

Ben kept every candidate and made the look an option, `previewStyle`, combined
with the skin like `theme`:

| Decision | Choice |
|---|---|
| Styles | `bar` (default), `highlight` (the old look), `region`, `fade`, `color`, `marker`, `underline` |
| What is marked | One function, `previewTargets()`; styles only paint it, with `--kce-mark` set by the hue class |
| Operators | Connector buttons inside an enclosed group, or between two enclosed siblings (`data-conn-index`) |
| × preview | Follows the option, in red |
| Ghost | Written as rule text (`OR new condition`) in every style but `highlight` |
| Tools | Never part of a preview |
| Name | `previewStyle`, not `hoverStyle`: it fires on focus too |

## v0.0.28 — room in the margin

The 0.0.27 margin styles assumed every row had a drag grip, whose slot leaves
about 20px left of the text. The only condition in a rule has no grip, so its
text sat at the tree's clipped edge. The bar landed on the text and the marker
dot was not painted. Prose, equation and ledger now pad their tree by
`--kce-preview-gutter` (14px) under `bar`, `region` and `marker`. The check
reads the painted geometry; the old marker check had only read the
pseudo-element's `content`, which passes for a dot that is clipped away
(lesson 5 again).

## v0.0.29 — a row is one line

Reported from KAStrack: a row's AND / OR, arrows and × sometimes dropped below
it. Detail in `0.0.29-one-line-rows.md`. The 0.0.26 fix stopped a row's own
controls wrapping, but two cases remained. The prose *line* still wrapped,
taking the AND / OR and the add buttons below. And multi-part values wrapped
inside the row, which centred its controls on the tall block.

| Decision | Choice |
|---|---|
| Lines and rows | Never wrap; the row shrinks — value first (shrink weight 100000), then names to a measured floor |
| Value floors | On the value slot, by content (`:has()`): 60px text, 8em a date or a tag list, 8em / 16em for two values |
| Last resort | `fitRows()` gives a row that still cannot fit its full width, so the line scrolls instead of the row spilling over its AND / OR |
| Alignment | Baselines, so a wrapping tag list grows down and everything else stays on its first line |
| `controls` | `'hover'` (default) or `'always'`; no-hover screens get `'always'` from `applyControls()` |
| Add buttons, hover mode | Float (prose): after the AND / OR, or a strip below it. Reserving room was built, measured (184px on a group's last row) and rejected by Ben on seeing it |
| Group tools | Float after the `(` (`kce-tools-float`), so they take no room from the row |
| Alignment guard | Refuses a push that would narrow the row, not one that grows the line |

## v0.0.30 — group guides

Ben asked for a soft highlight on a group's members when its AND / OR is
hovered, and for "striping" to show which conditions belong to which group.
Four looks were prototyped in the real editor and compared side by side (a
sheet in `notVCS/`):

| | Look | Verdict |
|---|---|---|
| A | A wash over the group's members when its AND / OR is hovered | Clear; easy to add later on the preview code (`previewTargets([group])`) |
| B | A guide per group, in its operator's colour, faint at rest | **Chosen** |
| C | Background bands by group | Reads as a stack of form rows (design idea 3), and loses distinction when groups nest |
| D | A tick before each row in its operator's colour | Shows the operator, not the group: two AND groups look the same |

How B is built: `positionGuides()` draws one absolutely positioned `.kce-guide`
per bracketed group, over the lines strictly between its brackets. Its colour
comes from `data-op` on the opening bracket. It runs in every layout pass, and
from `previewPlan()` / `clearPreview()` when a ghost line moves the lines. The
"soft highlight on hover" request is met by lighting the group's guide
(`lightGuide()`, delegated `mouseover` / `focusin` on the tree, keyed by
`data-conn-group` on the connector or `data-node` on a bracket). The full
wash (A) was offered as a follow-up.

## v0.0.31 — nothing lands on a control

Ben's report: a vertical line under the add buttons. It was the `bar`
preview, stretched to an `extend` ghost shown one line low, through the line
holding the buttons. The real issue was general: lines and floats (preview
marks, guides, hover-mode add strips, rails) were each placed by measurement
of their own target, not of what else was there. Six cases were fixed (see the
CHANGELOG). More useful than the cases is the check: `no-overlaps.js` asserts
that nothing visible overlaps a control, at rest and while every add and ×
button is hovered, across rules, skins, widths, preview styles and control
modes. It goes red on the original report with that one fix reverted.

## v0.0.32 — chevrons, and the rule’s own guide

Two reports. Dropdowns in the written-out skins gave no sign they were
dropdowns: a CSS-drawn chevron now follows each select's label, inside the
select's hit area. Hovering a top-level AND / OR lit nothing, because only
bracketed groups had guides: the rule now has one, hidden until one of its
AND / OR is pointed at or focused. Prose keeps the 14px preview gutter
whenever guides are on, so the rule's line has room at depth 0.
`dropdown-chevrons.js` checks the chevrons in every skin and kind of select.
`group-guides.js` checks the rule's line, and `no-overlaps.js` now also
hovers every AND / OR.

## v0.0.33 — the site moves into docs/ for GitHub Pages

Preparing for GitHub. Pages publishes one folder of the repository as it
stands, with no build, so the site moved into `docs/` (index, playground,
skins, API reference, design lab, `assets/`) and the design notes that were in
`docs/notes/` moved to `notes/`. The pages now load the **minified** files, as
an install would: `build.js` copies the `.min` files into `docs/dist/`, and
that copy is committed (the root `dist/` stays git-ignored; the ignore rule is
now anchored, `/dist/`, or it would have hidden `docs/dist/` too). The pages
were moved, not copied: two sets of pages would drift. The cost is that a
change in `src/` needs a build before the site shows it, so `npm run serve`
and `npm run test:browser` build first. `site-pages.js` now serves `docs/`
alone, as Pages does, so a page reaching outside it (the schema link did) is a
404 in the test rather than on the live site, and it fails a page that loads
anything but the `.min` files.

The API reference also gained a sticky contents column that marks the heading
at the top of the window (`docs/assets/docs-toc.js`), checked by
`docs-toc.js`: the mark is read from computed colours, the column is
hit-tested at the marked entry, and every jump is a real click followed by
waiting for the smooth scroll to settle.

## v0.0.34 — the AND / OR goes below the field name

Reported by Ben: in prose the AND / OR sat far from its value. About 85px of
empty space was held there for the row's ↑ ↓ ×, invisible at rest, so the
operator wouldn't move when they appeared. A following `(` was further still,
past room held for the hidden add buttons. He asked for two layouts, one
moving the operators close to the value and one putting them on the next
line under the field. He expected the second to read best, while some would
prefer the first for its height.

**One option, not two skins.** `connectorPlacement: 'below' | 'inline'`. A skin
here is a look; this is where one thing sits within the same look, and it
composes with whatever skin uses the flow layout. Two near-identical prose
skins would have to be kept in step indefinitely. `alignConnectors` and
`groupGuides` are the precedent: flow-only options.

**Below (the default)** keeps the DOM: the line is still the row's, for hover,
drag, guides and spans. A zero-height full-width `::before`, ordered after the
row, breaks it once, so `AND (` forms a second row. `alignConnectorsBelow()`
lines the operator's text up with the text directly above it: the field name
after a row, the `)` after a group. (The first version lined an operator after
a `)` up with the nearest sibling row's name, which put it out under the next
row — and with no sibling row it was not aligned at all, so the button's
padding pushed its word 5px in from the bracket. Ben's report; the check had
copied the code's reference instead of measuring what is above, so it agreed.)
Measured, not assumed: a row with no grip (a lone condition) starts its name
further left. Under a `)`, an AND / OR followed by `(` sat on a row as tall as
that bracket and had room above it; alone, it sat hard against the `)` (Ben's
second report). An unseen, zero-width `(` (a strut) gives that row the same
height either way. The add strip
floats after the row's ×, where it goes after a last row anyway, which keeps
`AND (` together. The group's tools stay in the flow after the bracket; there
they take nothing from the row.

**Inline** has to move the row's arrows and × out from between the value and
the operator: renderFlow appends them to the add strip, which floats after the
AND / OR. On a line that also opens a group, the strip goes after the group's
own tools: two sets of controls on one line, separated by `+AND`. That is the
one compromise; hanging the strip below the line instead covered the next
row's name at ordinary widths.

**Found on the way.** A strip that hangs below its line (no room beside it)
could land on the next line's AND / OR now that a `)` line puts its operator
under the bracket. It steps past it.
`no-overlaps.js` found it at 545px.

## v0.0.35 — redundant brackets are taken out

Reported by Ben from use: `AND[ OR[ AND[a, b, OR[e, f]] ], d ]`, drawn as two
extra bracket pairs with the last AND hanging out to their left. The likely
route was a × on the OR group's other child: `removeNode` spliced it out and
left the OR group holding one thing. Flipping a nested group's OR to match
its parent's AND left `a AND (b AND c)` the same way. `wrapAndContinue` and
`planAdd`'s `retune` already avoided making these, each in its own way. Other
mutations didn't.

**One pass, not more care in each mutation.** `dropRedundantGroups()` runs in
`mutate()` after every change, and on load and in `setDocument()`. A group of
one stands aside for its child. A group with its parent's AND / OR gives its
children to the parent. An empty group goes: it is `SKIP` in the evaluator and
in SQL already. The root adopts a lone group child rather than being replaced.
`wrapAndContinue`'s own flatten was a second copy of the second rule and is
gone. None of this changes what a rule evaluates to; the check runs all 64
inputs against before and after.

**A NOT is never stranded.** Brackets that carry a NOT aren't redundant: a
negated group sharing its parent's operator stays. A negated group of one
hands its NOT to its child only where that child has a NOT the person can
switch off: a group, or a condition with `allowConditionNegate`. Otherwise
`NOT (b)` stays as it is. The root has no NOT control in prose, so it never
adopts a negated child.

**What it costs.** Flipping a nested group's operator to match its parent is
now not reversible by flipping it back, because the group has gone. Undo
restores it in one step. Keeping such a group would contradict the report.

**On load as well.** A rule saved before this release can carry the
brackets. Load already rewrites a readable field with the editor's own
output, so the tidy pass costs nothing new there. Unreadable content is
untouched as before (`pristine`).

`tests/browser/redundant-brackets.js` drives the × and the AND / OR with real
clicks in both connector placements. It counts brackets by hit-testing and
checks a single undo. It fails 14 of its 34 checks on 0.0.34.

## v0.0.36 — saying so when brackets go

Ben kept the merge-on-switch behaviour from 0.0.35, then asked how obvious
Undo was when it happened. Not very: a small muted footer button, unchanged by
the merge and off the screen on a long rule. Of three offered remedies (a
preview, a note with Undo, a tint) he asked for all three.

**One source for all three.** `tidyTree()` now reports what it did: `dropped`,
the groups whose brackets went, and `lifted`, the nodes that came out of them.
The note and the tint are drawn from that after the render. The preview is
`planTidy(change)`. It copies the document with its ids, applies the change,
tidies the copy with the same `tidyTree()`, and returns the dropped ids. The
three changes that can merge (`removeChild`, `switchOperator`, `negateNode`)
became plain functions, which the click runs on the document and the preview
on the copy. That is the "previews read a plan" rule again, so nothing in the
preview can disagree with the click. `tests/browser/bracket-merge-feedback.js`
clicks each control and checks that exactly the marked brackets went.

**The preview is not a preview style.** The styles paint *which rows a button
touches*. This is a different fact, *which brackets will not survive*, and it
appears alongside whatever the style paints, the same in all of them. So the
`fade` style must not fade it. In prose it strikes the `(` and `)` through in
`--kce-danger` and colours the guide; `positionGuides()` re-applies that,
because it rebuilds the guides. In the tree skins it colours the group's own
bracket: equation's and blackboard's pseudo-elements, ledger's rule, boxed's
border. Each skin is tested through the control it actually shows. Boxed hides
the AND / OR words and switches from its header. The other three hide the
header's switch and its NOT.

**Where the note goes was the hard part.** Beside the change, but nothing may
land on a control, including what only appears on hover. The first try,
level with the first moved row, never had room. That row's band is where its
add strip appears. With the AND / OR below each row, though, the AND / OR row
under it is nearly empty. So `placeTidyNote()` tries each moved row and AND /
OR in reading order. It measures the controls and text (not the rows that hold
them) across the note's own height, with `no-overlaps.js`'s 1px slack, and
counts a zero-width strip at its `scrollWidth`. The note is 20px tall to fit
between two rows. Its Undo reaches 24px through a transparent `::before`, as
the AND / OR words do. Where nothing fits (inline placement, narrow hosts,
the tree skins, whose rows are full-width boxes) it goes in the footer, just
before Undo. It is re-placed in every layout pass and whenever a ghost line
comes or goes.

**It goes, but not from under someone.** It goes on the next change, or after
8s. The timer stops while the note is hovered or focused. A screen reader
hears it through a polite live region that exists from the start, since a
region that arrives with its text is often not read.

**Kept quiet** for `wrapAndContinue` (`mutate(…, { announce: false })`). Its
flatten is the button's plan, and on screen no bracket goes: the brackets
around `(B OR N)` stay; they just belong to the new inner group. Loading a
rule and `setDocument()` are quiet too, because the person took nothing out.

`no-overlaps.js` gained merge configurations. They click a merging AND / OR
and scan with the note up, re-arming its timer before each scan.

## v0.0.37 — the dark theme reaches prose and ledger

Found while checking 0.0.36 in the dark: with `theme: 'dark'` on a reader in
light mode, prose drew field names in near-black on the dark ground (1.1:1),
and ledger its field names, values and AND / OR too. Both skins redefine the
text tokens and gave the dark values only under `prefers-color-scheme: dark`.
The base `[data-kce-theme="dark"]` block sets them too, but at equal
specificity in an earlier stylesheet, so the skins' light values won. It is
the "a colour needs a value in every place the theme comes from" rule,
missed in two skins. Each now has a `[data-kce-theme="dark"]` block beside its
media query.

`tests/browser/theme-contrast.js` checks the result rather than the places:
every skin, `theme` unset / light / dark, with the reader in light and dark
mode, the text contrast measured from computed colours against the ground the
rule is drawn on. It failed exactly the five prose / ledger cases before the
fix.

## Repository layout

```
src/k-conditions-evaluator.js   shared evaluator (UMD, browser + Node)
src/k-conditions-sql.js         SQL builder; attaches toSql() to KConditions
src/k-conditions-editor.js      the editor; two renderers (tree + flow)
src/k-conditions-editor.css     base + boxed skin + debug panel + add buttons
                                + the unscoped .kcd-* describe styles
src/k-conditions-skins.css      prose, equation, blackboard, ledger
dist/                           generated, git-ignored: per-file minified + bundles
build.js                        writes dist/ (terser + clean-css)
CLAUDE.md                       conventions and testing lessons, in the zip
sdk/php/                        PSR-4 Kastrack\ConditionsEditor, PHP 8.1+
schema/                         JSON Schema for the document format
tests/fixtures/cases.json       34 evaluation + 34 SQL + 25 describe cases
tests/js/                       node --test suite (109 assertions)
tests/php/conformance.php       dependency-free PHP runner (103 assertions)
sdk/php/tests/                  PHPUnit suites
docs/                           the GitHub Pages site (from 0.0.33; was the root)
docs/index.html                 landing: JSON demo + client-side SQL demo
docs/demo.html docs/docs.html   playground (with skin picker) and API reference
docs/skins.html design-lab.html skin comparison, scratch page
docs/dist/                      the .min files the site loads, generated & committed
notes/                          this record (from 0.0.33; was docs/notes/)
SPEC.md                         the document specification
```

The browser checks now live in `tests/browser/` and run with
`npm run test:browser`, which runs **every** script in that directory and exits
non-zero if any is red. Before 0.0.22 they lived outside the repository and were
run from a remembered list, which is how `hover-focus-reveal.js` stayed failing
for several versions without anyone noticing.

## Verified at 0.0.21

- JS: 109 pass. PHP: 103 pass. Same fixture file; SQL and both describe renderings
  compared character for character.
- ESLint (ES5, no-undef off) clean apart from unused catch bindings.
- Headless Chromium, all 26 verify scripts green with no console errors:
  describeHtml's markup and *computed* styles, hostile values neutralised in a
  live DOM, the `summaryHtml` summary; the docs page's live sample with zero
  style drift onto the page chrome; the `dist/` bundles behaving like the
  sources; `hideTextarea: 'toggle'` and `hideTarget`; add previews matching their
  plan functions; connector alignment; the removal preview's computed background
  in all five skins in light and dark; Ctrl+Z after a rebuild-triggering click,
  with focus lost, with two editors on a page, after clicking outside; undo/redo
  stepping and coalescing; focus and caret surviving an operator change; move
  buttons, disabled ends, Alt+Arrow; drag with a live drop indicator in both
  layouts; nested-group drag; Escape cancelling; touch drag on a Pixel 5 profile;
  every option toggle and several crossings of them; all five skins; all five
  site pages.
- Composer install still unverifiable in the sandbox (Packagist blocked);
  `php tests/php/conformance.php` is the runner that always works.

## Conventions for future versions

- Bump the version in `package.json`, `CHANGELOG.md`, all three JS file headers,
  `Evaluator::VERSION`, `SqlBuilder::VERSION`, both CSS headers, `SPEC.md`,
  `assets/demo-config.js`, and every HTML page (`brand-version` + footer).
  `grep -rl "0\.0\.<n>" … | grep -v CHANGELOG | xargs sed -i` does it in one go.
  Then `node build.js` — `dist/` carries the version in its banners.
- Bump the patch version on every change. (The per-version zip was dropped on
  2026-09-11 at Ben's request.)
- The CHANGELOG is written for a reader deciding whether to upgrade: say what
  changed, and say *why it was wrong before*. It is the project's design record.
- **New mutations go through `mutate()`**, or undo will not see them.
- **Any new focusable control in the tree needs a `data-fk`** of
  `<node.id>:<slot>`, or focus will not survive a re-render — and a lost focus
  is how the Ctrl+Z bug happened.
- **Anything that represents a node visually needs a `data-node`**, or the
  previews will not know it is part of what a button affects.
- **A preview must read a plan function** (`planAdd`, `planWrap`) rather than
  re-decide. That is the only reason a preview can be trusted to match the click.
- **`describe()` and `describeHtml()` are one walk, two formatters.** Never add a
  second traversal. New leaf syntax means a new key on both `TEXT_FORMAT` and
  `HTML_FORMAT`, in both languages, plus a fixture asserting both strings.
- **Everything `describeHtml()` interpolates is escaped, with no opt-out.** A
  formatter that emits a caller's string unescaped loses the guarantee.
- **The `.kcd-*` block is deliberately unscoped.** Do not nest it under `.kce-*`.
- **A state style that competes with `:hover` needs `!important`.** The skins
  load after the base stylesheet and set hover backgrounds at equal specificity,
  so they win every tie. This is what broke the removal tint's fill in 0.0.12.
- **A new palette colour needs a value in four places**: the light block, the
  `prefers-color-scheme: dark` block, the `[data-kce-theme="dark"]` block, and
  `blackboard` in skins.css, which is dark without switching the theme.
- **The editor is inserted after the outermost element it hides**, not after the
  textarea (`hideTarget`). Anything that moves the root has to keep that true.
- Any new operator needs: JS impl + meta, PHP impl + meta, an evaluation fixture,
  a SQL fixture, **a describe fixture**, and a row in SPEC.md and docs.html.
- Class names: `kce-` prefix (`kcd-` for the describe output). Check for
  collisions — `.kce-source` bit once.
- Careful writing `*/` inside a JS block comment.
- **Controls are hidden until hover.** Anything automating the editor must hover
  the row first (or click with `force`) — and must **re-measure after hovering**,
  because revealing `.kce-adds` widens the row and shifts everything after it.
- **The wrap button carries two classes**: `kce-add-wrap` *and* `kce-add-and` /
  `kce-add-or` (for the hue). A selector for a plain add must be
  `.kce-add-or:not(.kce-add-wrap)` — `.last()` on the bare class picks the wrap
  button. This bit `verify7.js` and `verify10.js`; both are fixed.
- **Keyboard tests must reproduce the user's focus state**, not a convenient one.
- **Test a CSS feature on the painted result**, never on the class being applied.
- **Judge visibility by what is painted**: a hidden element's children still
  report a full bounding rect and a non-null `offsetParent` when the concealment
  clips an ancestor. Hit-test the centre with `document.elementFromPoint`.
- **Cross the option combinations, not just the defaults.**
- **A conformance suite only pins what it compares.** Any SDK output no fixture
  asserts is free to differ between languages, and eventually will. And check a
  new fixture *fails* without the fix — one that passes either way pins nothing.
- **The operator decides how a value is entered and shown, not the field**
  (`valueFromChoices`). It gates the editor's control and describe()'s label
  lookup together, so they cannot disagree.
- **A setting governs what can be created, never what already exists.**
  `allowFieldValues` being off must not strip the selector from a stored field
  reference, or the rule is stuck with no way back to a literal.
- **Anything that inserts DOM on hover or focus invalidates a measurement taken
  after it** — the add preview's ghost row shifts the flow layout's line list.
  Park the pointer, blur, and wait for `.kce-ghost` to go before measuring.
- **Run every verify script before a release.** A permanently red one is worse
  than none, because the suite stops being read.
- **A narrow host is not a narrow screen.** A viewport media query cannot see a
  545px dialog on a wide monitor. Anything that depends on the editor's own
  width is measured (`fitLayout()`, re-run by a `ResizeObserver`), and the
  browser checks run the editor at dialog widths with a hostile host
  stylesheet (`tests/browser/narrow-host.js`).
- **Anything placed by measurement must not land on a control.** Marks,
  guides, floats and rails are positioned for their own target. Check them
  against everything else visible: `no-overlaps.js`, which a new float or
  mark should be added to.
- **A line and a row never wrap.** Something that has to fit on a line
  either shrinks (the value, then the names) or floats out of the flow (the
  hover-mode add buttons, a group's tools after its bracket). Wrapping is how
  controls ended up below the thing they control, in three versions.
- **A preview style paints `previewTargets()` with `--kce-mark`; it never
  decides its own set.** Seven styles that each chose what to mark would
  disagree within a release. And none may move anything, or the hovered
  button loses the pointer and the preview flickers.
- **A control is revealed by opacity 0 → 1; its colour carries the contrast.**
  A half opacity is a contrast failure, not a quiet control.
- **A field the editor could not read is not rewritten until the user changes
  something.** A new path that changes the document must call `touch()` or go
  through `mutate()` / `commitValue()`; a path the user does not drive must not.

## v0.1.0 — list operators, readied for the first tag

Readied as the first tagged release, so that Packagist and npm can install by
version and a consumer (the bspkfw framework's form builder) can pin it.
Nothing about the document changes. The tag itself went to 0.1.1 (below).

The one feature is a seventh operator group, `list`, for a field whose value
is itself a list. The existing `in_list` is "one value, many operands"; a
multi-select field is "many values", and asking "does the selection include
any of these" had no operator. Decisions:

- **Two operators, not four.** `includes_any` / `includes_all`; "includes none
  of" is `NOT includes_any`, and the condition already has `negate`.
- **An empty operand never matches.** Mathematically "includes all of
  nothing" is true, but an operator with nothing selected that matches every
  row is a trap; `in_list` already treats an empty list as `1 = 0`.
- **A string value is a list.** `toList` splits on commas on both sides, so a
  CSV-stored field works without the host decoding it first.
- **No SQL.** A multi-valued column has no portable shape (CSV, JSON array,
  junction table). Rather than guess, the builders refuse the two operators
  under the unresolved-operator policy; a custom operator with an `sql`
  template is the escape hatch, as for callbacks.
- **A `list` field type** picks the group defaults; the editor's existing
  chip control (`renderListInput`) already takes the field's choices, so no
  new control was needed.

## v0.1.1 — the SDKs agree, and the first tag

Four inputs where the JavaScript and PHP SDKs gave different answers — a
date-time with no zone, a year below 100, Unicode spaces around a value, a
number compared as text — now agree, and the shared fixtures pin each one.
`CHANGELOG.md` has the detail. They landed before 0.1.0 was published, so the
first tag is 0.1.1 and 0.1.0 was never tagged.

## Open items / not yet done

- Python, Ruby, Go SDKs (deferred; the fixtures are the contract for a port).
- No async operator support — synchronous by design.
- SQL is a best-effort translation, not row-identical to the evaluator.
- **Sibling order is presentational**: `evalGroup` has no short-circuiting, so
  neither the result nor which callbacks run depends on it. If short-circuiting
  is ever added, reordering becomes semantic and needs documenting as such.
- The removal preview does not tint the connector that would disappear with a
  removed child. Deliberate: with three siblings it is ambiguous which `AND`
  goes, and tinting the wrong one would be worse than tinting none.
- Cross-group dragging deliberately left out — overlaps `+AND`/`+OR` and makes a
  drop ambiguous in a nested tree.
- No auto-scroll during a drag on a long rule.
- In prose, on a line where the next child is a group, the `(` renders after the
  add button (`… AND +AND (`). Semantically right; spacing mitigates it.
- `addBeside` does not enforce `maxDepth` (only the wrap button does).
- `documentInComment`: comment-stripping loses the rule; hand-edits to the SQL
  are overwritten on the next builder change.
- `regex` patterns come from the document, so a hostile pattern is a cheap DoS.
- Bracket-pair highlighting on hover would help deep nesting; needs JS — though
  the `data-node` tagging makes it nearly free.
- The root group always prints its own outer brackets when it has more than one
  child. Harmless, but they could be dropped at depth 0.
- `describeHtml()` has no per-node hook — you cannot make a field name a link or
  attach a tooltip without post-processing the string. A `format` argument
  accepting a partial override would be the natural extension, since the
  formatter table already exists.
- The tree skins draw a tail-connector row inside every group (the `+AND`
  slot after the last child). It is empty at rest and reads as a blank band
  under the group's last row — the same shape of problem 0.0.26 fixed for rows.
- When a prose group's tools move to its closing line in a narrow host, they
  sit after that line's add buttons, which widen on hover. Harmless — both
  appear together — but it is the one place a reveal moves another control.
- No plain-text-with-labels middle ground: `describe()` still writes `[Field]`
  and `"value"`, which is right for a log line but noisy in an email body.
