# AGENTS.md — CozyMaker

Read this before changing anything. It is the standing law of the house and the
record of what has already been got wrong once.

---

## What this is

A comfortable place to build the guide to a world: the plot essential, the
continuation files, the worldbook — the documents a storyteller later reads as
the whole truth of that world.

It is not Cozy Tavern and it is not Cozy Chat. Those two are **read-only** from
here; copy an idea across if it helps, never an edit.

---

## The three laws

### 1. The whole craft lives in one file

`engine/generalist.md` — the Generalist engine, verbatim, 1,526 lines. **No law
from it is ever restated in code.** A law written twice is a law that will
disagree with itself.

`js/engine/slices.js` cuts it at its own headings (75 sections, no duplicate
numbers, 122,336 of 122,410 characters captured) and hands each worker only the
sections its job needs. Measured, in `tests/units.mjs`:

```
scribe           60,631      showrunner     47,652      chronicler  42,757
compressor       59,768      eye            45,610      editor      40,155
builder          49,500      novelist       43,895      diagnostician 34,140
the whole craft 122,410 — nobody carries half of it
```

The biggest slice is 49.5% of the monolith. That is the argument for several
workers instead of one: a worker reading only its own laws applies them; a
worker reading all of them skims. **But its own laws include every check its
workflow orders it to run** (v1.2.4): the spine carries the Core Mandates
(1.1), which the craft says override all other rules and every workflow cites
by name, and a worker is given every section its reading names — or the reason
it need not is written in `tests/units.mjs` ("is given every check its reading
orders it to run"). A worker told to use something it never receives invents
it.

To change the craft, edit `engine/generalist.md`. To change who reads what,
edit `SLICES` in `js/engine/slices.js`. Nothing else.

### 2. The persona firewall is structural, not hopeful

The writer talks to **one** intelligence. Its reading is:

1. the writer's own instructions, first and untouched
2. a greeting in his own names ("Hey Eni, this is Bruce.")
3. about 1,400 characters of plain English

It has **no craft, no bracketed markers, no section numbers, and no way to edit
a document**. Every change comes from a worker backstage, and markers are
stripped from anything a worker says before the front ever sees it
(`naturalize()` in `js/agents/run.js`).

The front cannot break character over machinery it was never given. Six tests
in `units.mjs` and five in `browser.py` assert this against the prompt that
actually went over the wire. **Do not put the craft, an edit block, or a
command word into `FRONT_BODY`.** If the front needs to do something, give the
job to a worker.

### 3. If the app can see a problem, the app fixes it

`js/doc/lint.js` runs on every write. It either repairs the text itself — when
the repair is certain — or names the worker whose job it is, and `run.js` sends
that worker without anyone being asked. A finding that only *tells* the writer
something is wrong has handed him a chore.

Repairs outright: working markers left inside a document, notes to somebody
inside a document, bonds on the main character, scores outside 0–100, headings
with nothing under them, worldbook settings out of range.

Handed to a worker: duplicate event numbers, events out of order, events with
no date, a name inside a character trait, a document grown too heavy.

---

## The shape

```
engine/generalist.md   the craft, verbatim, the only copy
serve.py               the device: files, the store, the way out to a provider
js/engine/slices.js    cuts the craft; SLICES decides who reads what
js/agents/persona.js   the writer's names, first or second person, natural words
js/agents/roster.js    who does what; which connection each of them rides
js/agents/call.js      the one way anything speaks to a model + the work channel
js/agents/listener.js  what he said -> the right workers, read for intent as the craft's 7.6 says
js/agents/router.js    written commands, exactly; the old keyword reading, now only the fallback
js/agents/run.js       the turn: workers backstage, one voice at the front
js/doc/index.js        the whole shape always, full text only where it matters
js/doc/edits.js        find, apply, undo, with a drift guard
js/doc/lint.js         the checks that need no model
js/doc/worldbook.js    the extension's worldbook reading and SillyTavern export, verbatim
js/doc/transplant.js   the extension's Summaryception transplant check, verbatim
js/engine/crafts.js    the three keepers with a craft of their own; his version, else the original
engine/*.md            generalist (his engine), worldbook-maker, sc-auditor (the extension's)
engine/crafts.json     where each carried craft came from, its hash, and the only words changed
js/store.js            the open world, its conversations, backups, and the one save line
js/ui/                 kit, app (the room), drawer, docs, settings
docs/lineage.md        every version of Cozy Tavern, Cozy Chat and the Plot Essential Maker
```

### Why the index is built the way it is

Every call carries a one-line entry for **every** section that exists, plus the
full body of only the handful in play. A dossier costs about fifteen words to
name, so two hundred of them still fit.

Retrieving by similarity over the document as a blob — which is the usual way,
and what Cozy Chat's smart mode does at a 7,000-character budget — is how a
maker writes a second dossier for a character who already has one, and how it
contradicts a rule it was never shown. A world is not a blob; it is a named,
indexed thing.

A worker that needs a body it was not given asks for it by name
(`<need>Emilia</need>`) and gets it, up to two rounds. It never guesses and it
never invents.

### Settings

A value the writer set is sent exactly as set. A value he did **not** set is
not sent at all, so the provider's own default applies. The only override is a
floor that prevents corruption: a model that always thinks, pointed at a small
reply budget, spends the budget reasoning and answers with nothing — so the
floor raises the ceiling. It never lowers one the writer set.

### Thinking, per house

A thinking level is spoken in each provider's own words, copied from Cozy
Tavern's proven table (M37, M303, M349) rather than re-guessed. The levels are
Off, Low, Medium, High, XHigh, Max; unset sends nothing.

    DeepSeek      thinking:{type:disabled} for Off; enabled + reasoning_effort low|high|max
    Kimi K3       reasoning_effort low|high|max only; it always thinks, so Off is low
    Kimi K2.x     thinking:{type} — a switch, no levels
    GLM (Z.ai)    by generation: 5.3+ always thinks; <5.2 a switch; 5.2 switch + effort
    Qwen          enable_thinking
    OpenRouter    reasoning:{effort} or reasoning:{enabled:false}
    Anthropic     a thinking budget, only when a level is set
    anything else reasoning_effort

A level a model refuses (a 4xx that names a thinking field) steps down and the
same request goes again once, without it. Nothing else in the four-hundreds is
retried — a bad key fails in one call, not after thirty seconds of backoff.
When thinking is on, a worker's reply budget is raised to 16,000 so the
thinking cannot eat the answer. A level saved by an older version that no
provider takes ("minimal") is repaired to Low when the house loads.

### Storage

The device holds everything, under `~/.cozymaker`. The browser holds only the
world that is open, and only so the page can draw. **There is no syncing
between browsers**, deliberately, and there never will be. Saves are atomic,
the previous version is kept, and every document is also written as plain
markdown under `~/.cozymaker/exports/` so it is reachable from the shell.

**A world holds its documents and its conversations.** Every conversation in a
world reads and changes the same documents. A world saved before conversations
existed is moved, whole and in order, into a first conversation when it is
opened, and written back at once (left in memory, every open would move it
again under a new id).

**The save line.** Every write to the device goes through one promise chain,
and every step is caught where it joins (`inLine`) — one step that throws must
never skip every save after it. A save that does not land is not dropped: the
newest copy of each world waits in `pending` and is retried at 2s, 4s, 8s …
up to 30s until it lands, and a note says plainly that it is not saved yet. A
world opens from its waiting copy if it has one. Deleting a world drops its
waiting copy, so a retry can never resurrect it. Nothing inside the line may
await the line — that is a deadlock, and one was written and caught here.

**Landing a turn.** The crew works from the documents as they were when he
pressed send. `landTurn` lands the result on the world as it stands *now*: a
document he changed by hand meanwhile keeps his words and the crew's change to
it is refused with the reason; one he deleted stays deleted; the reply goes
into the conversation that asked, even if he has walked into another world.
Landing twice is landing once. For a world not on screen, only "not found"
means deleted; any other failure is waited out and tried again.

---

## What was carried over from the Plot Essential and Instructions Maker

His SillyTavern extension (read-only from here: the whole source, all 165 functions, and its AGENTS.md).
Its laws hold here too:

- **A quote lands exactly, or where only spacing, quote marks and dashes differ — nothing else.** One
  word different is a misquote, and applying it writes over real words (its v0.11.10 → v0.11.13).
  `locate` is exact, then one linear folded pass; there is no similarity score anywhere. A miss goes
  back to the worker that wrote it, once, with exactly what it quoted and why it missed.
- **JSON repairs never touch the inside of a string.** `stripTrailingCommasOutsideStrings` and
  `escapeRawControlsInStrings` are state machines; a blind `,\s*]` regex is banned.
- **The last block is the answer.** Models draft on the page; applying every block applies a change
  twice or nests a replacement inside itself. Earlier blocks are set aside and that is said. `<docedits>`
  (the extension's name) is read as `<edits>`.
- **A whole document is written plainly, never inside a string** (v1.2.0). `<file name="…">` … `</file>`:
  a new document is started, one with words in it is rebuilt whole under the loss guard, the same words
  make no card, the last one per name wins, one left open is carried on and never written half-way.
  `create_file` / `replace_all` in the block are still read, but no worker is taught them any more.
- **Documents go whole, last.** A worker reads every document in full when the world fits in
  `WHOLE_LIMIT` characters, placed after the talk and just before the job.
- **Native widgets failed on his phone.** No `<details>` anywhere: every fold is `kit.fold`, a button.
- **What code can check, code checks.** Transplant markers (its `lintTransplant`, held to 16 recorded
  answers), worldbook JSON (repaired on leaving), spacing in an instructions document (reported with
  Check it). A change that breaks a transplant marker is refused.
- **The worldbook is read and exported by its own code** (`js/doc/worldbook.js`), held to 10 recorded
  answers in `tests/fixtures/worldbook-export.json`.
- **Restoring only adds.** Every world comes back as a new one beside what is here.

Not carried over, on purpose: its approve-first staging area. He is a passive user — changes land,
each card shows before and after, and one tap puts it back — and every staging fault it fixed
(v0.11.5, v0.12.2, v0.12.3, July 29) belongs to that area. Its per-entry worldbook form: the craft's own
rule is that the keeper owns every field.

## What was carried over from Cozy Tavern and Cozy Chat

Both were read for their documented faults before this shipped — Cozy Tavern's
`AGENTS.md` (8,495 lines of milestone history) and Cozy Chat's `AGENTS.md` —
and then every version record of both was read: 395 Cozy Tavern commits
(M1 → M363) and 70 Cozy Chat commits (v1.0.0 → v5.26.1). **`docs/lineage.md`
lists all 465, each with what it means here:** ported (and where), held by
design (and where), not ported (and why), or a part CozyMaker does not have.
Every class below is a fault one of them already paid for. Some were designed
out; the rest were found here and fixed. Each has a test.

**Designed out, structurally:**

- *All the projects vanished because the list of them was one settings row.*
  Here a world is one file and the list is the directory. There is no index
  row to lose.
- *Browser-cleared site data erased everything.* The browser holds nothing but
  the open world; the device holds the work.
- *Exporting the whole store on the main thread froze the app.* Backups are
  the server's job, rolling and gzipped, on every write.
- *A sync between browsers corrupted a library.* There is no sync.
- *An update was invisible because the old server still held the port.* The
  launcher compares versions and puts the old one out; `serve.py` re-execs when
  its own file changes.

**Found here and fixed:**

- *A question read as an instruction.* "Does that make her too similar to
  Aldric?" sent the editor; "do you think the world is too big" sent the
  compressor. Each worker's shapes are now split into those that survive a
  question and those that do not, and a politeness opener is stripped first so
  "can you change her age to fifteen" is still an instruction.
- *A relative fetch resolving against the wrong base.* The craft file is asked
  for from the root, like everything else. A craft file that quietly 404s
  leaves every worker reading nothing while the app looks perfectly well.
- *Folding the whole store into a string and reading it back.* One
  serialisation per save, not two.
- *A worker rewriting a document it had only seen part of.* When anything was
  shown in shape-only form the brief says so in as many words, and
  `lostSomething` refuses the rewrite as a backstop.
- *A cut-off block passing as "no changes".* An unclosed opener whose tail
  begins like a list is reported as truncated; the same word in ordinary prose
  is left alone, because treating that as truncation eats a reply that was
  never cut off.
- *A machinery tag reaching the voice the writer hears.* `naturalize()` strips
  them. In Cozy Chat an echoed tag inside a turn was parsed as a cut-off block
  and ate the rest of the reply.
- *An undo record holding a whole document, for ever.* Twenty stay undoable;
  older ones keep their card and lose the payload.
- *Two doors for one act.* The documents panel had a "Tidy it" button doing by
  hand what the sweep does by itself. The sweep now runs when the writer
  finishes with a document — on leaving, never mid-keystroke, so it cannot
  take away the empty heading he is about to fill. **Taking the button away
  entirely was itself the mistake:** he then could not find any way to tidy,
  and a control he cannot find does not exist. "Tidy it up" is back as a
  different act from the sweep — it sends the showrunner's declutter-and-
  reshape (`*cleanup`) through the conversation. One button per act; the
  automatic checks on leaving stay automatic.
- *A hand edit lost on backgrounding.* One debounce in the house, not two
  stacked up.

---

## Bugs already found. Do not reintroduce them.

- **`## WORLD` deleted from every plot essential on every save.**
  `removeEmptySections` read a section's body as "everything up to the next
  heading of any level", so a heading whose content is subsections looked
  empty. A heading now owns everything down to the next heading at its own
  level or higher, descendants included, and is empty only when that whole
  stretch holds nothing but blanks, dividers and other empty headings.
  *183 tests were green while this was shipping.*
- **`countOf` counted `### Rules` and `### Calendar` as people**, so a rewrite
  that legitimately dropped one empty world topic was refused as though it had
  deleted a character. A dossier is a heading with `ID:` or `CORE:` under it.
- **A refused rewrite left an undo record that could never be honoured** — it
  named a document that had not changed, with a fingerprint of text that was
  never saved, so "put it back" refused forever after. The record is now built
  from what actually landed, in `commit()`, after the reverting is done.
- **A hand edit made in the last half second was lost on backgrounding.** The
  documents panel held the text in its own timer for 500ms before the store was
  told about it, and the save-on-the-way-out cannot flush what it has never
  been told. The panel now hands every keystroke straight to the store; there
  is one debounce in the house, not two stacked up.
- **`tests/server.py` ended with `pkill -f serve.py`**, which matched the
  calling shell and killed it. Never pkill by a pattern that matches your own
  process tree.
- **The launcher killed by name, `pkill -f "python.*serve\.py"`** — which is
  also Cozy Tavern's server. An update to CozyMaker would have taken the story
  server down with it. An old server is now stopped by `POST /api/quit` to
  CozyMaker's own port; the only pkill left matches this clone's absolute path.
- **The launcher's update check was dead.** It compared `VERSION` strings, and
  nobody had bumped `VERSION`, so every update reported "already lit". The
  server now reports the git commit it started from and the launcher compares
  that with the folder. A number somebody has to remember is a check that stops
  working the first time they forget.
- **The launcher pulls a new copy of itself.** Bash reads a script as it runs,
  so the body is wrapped in `main()` and parsed whole before the pull.
- **DeepSeek "off" was sent as `reasoning_effort: "minimal"`**, a word it does
  not have, and 400s were retried four times over thirty seconds. See
  *Thinking, per house*.
- **Workers never saw the conversation.** "Fold all that in" folded nothing.
  Every worker now gets the talk, newest last, with any cut said out loud.
- **His message reached the front twice**, as two user turns in a row, and the
  front's reading carried the workers' `<need>` tool. One voice on the wire;
  the front gets the book without the tools (`forFront`).
- **A refused call came back as an empty reply.** The stream reader only read
  lines ending in a newline, and a refusal is one JSON line with none. What is
  left when a stream ends is read too.
- **A broken edit block voided every change**, a block in the thinking channel
  was ignored, an empty answer read as "nothing to do", and "I changed it" with
  no block was believed. Complete changes are salvaged in written order; each
  of the others earns exactly one honest re-ask. A worker whose last round only
  asked to read more is told to do the job with what it has.
- **A hand edit made during a turn was overwritten** when the turn landed.
  See *Landing a turn*.
- **Stop did not stop** (the front was still called), and Send doubled as Stop
  with the same icon, so a double tap cancelled his own turn. Stop looks like
  Stop; a second tap within 700ms is the same tap.
- **A finished reply threw him to the bottom** while he read. A redraw of the
  same conversation keeps his place.
- **`{{user}}`/`{{char}}` went to the model raw**, and the front called him
  "the writer". Macros read as his names (angle forms in capitals only — a
  preset's own `<user>` tag is markup); the front uses his name.
- **Failed saves were only logged**, switching worlds after one dropped the
  unsaved world, and a server hiccup was taken for a deleted world. See *The
  save line*. The note that says so sits above the documents sheet — it was
  first drawn underneath, where he types.
- **The house's own jobs reached workers as "what the author asked for".**
  A read-back or a repair is labelled as the house's.
- **Try again removed his words before checking a turn was running**, so a
  refusal lost them. It checks first.
- **The close search froze the page on a long near-miss** (116ms on a desktop,
  about 700ms on a phone, per edit). Two exact upper bounds skip what cannot
  reach the floor: 10.5ms, identical answers over 60 random documents.

---

### Found in the extension port (v1.1.0)

- **Word-level near misses were applied at 78% similarity.** Now exact or spacing only.
- **A blind trailing-comma regex** changed commas inside values. String-aware repairs only.
- **Every edits block was applied**, drafts included. The last block wins.
- **A global regex's `.test()` carried `lastIndex`** into the next character, so a quote mark after a
  quote mark failed to fold. One `foldChar`, no global regex tested per character.
- **A variable removed while its use stayed** (`slice` in `runWorker`) made every finished worker throw.
  Before pushing, run a no-undef check over `js/` (ESLint 8, `no-undef`): tests never reach every line.
- **A change that changed nothing was reported as done**, and an append or insert of nothing too.
- **The thinking layer differed from Cozy Tavern's in seven ways** (unknown relays, XHigh/Max, GLM on any
  host, K3 through OpenRouter, Claude's temperature, Hermes, K2.7-code). `tests/thinking.mjs` holds it to
  198 answers produced by Tavern's own `requestBody`. A refusal is learned from, repeatedly: one naming
  one field can hide another.
- **Anthropic-shaped addresses on other houses** (`/anthropic`) were sent OpenAI bodies, and a Claude
  address typed with `/v1` went to `/v1/v1/messages`.
- **The worldbook export used the copy on screen** when the sheet opened; it reads the document at the tap.
- **A Go on that failed vanished**; it says why. **A remade version kept its old cards** when some of its
  changes no longer fit; its cards now say what is in the documents.
- **Leaving a document waited 0.9s to save**; leaving is a save point.
- **A document with no `##` sections reached every worker as its name and "It is empty so far".**
  `parseDoc` kept only `#` titles and text under sections, so a Summaryception transplant reached the
  auditor empty, an instruction set with no headings reached its writer empty, and the paragraph under
  a plot essential's title reached nobody. A whole reading is now the file itself, word for word; an
  outline keeps everything before the first section (`lead`), trimmed only for the front or a model too
  small for it, and says how much it left out. Whatever a worker's craft says it works on, check that
  `docBriefs` really hands it over — a worker given nothing will invent.
- **The relay held every stream until 2,048 bytes had piled up.** `resp.read(2048)` waits for the whole
  2,048; a streamed event is about a hundred bytes. A reply shorter than that reached the phone all at
  once at the end, and a thinking model's thoughts arrived in lurches. The relay reads with `read1`,
  which hands over whatever has arrived — as Cozy Tavern's `serve.py` already did. `tests/server.py`
  times five events 300ms apart through the relay: 1.5s all together before, 0.03 → 1.23s after.
- **The thinking was a fold labelled "what they were turning over", under the reply, filled only at the
  end.** It is a Thinking box above the reply: "Thinking… 7s" while the model thinks, filling live,
  "Thought for 12s" after, shut until tapped, with Copy the thinking (Cozy Tavern M40, M105). The time
  it thought is kept on the turn, on every version, and added to by Go on.
- **A model too small for the whole world failed the turn.** When a provider says a request is too long
  (`TOO_LONG`), the worker is asked once more with the outline and the newest talk.

### Found auditing what the persona hears (v1.1.3)

`tests/units.mjs` runs whole turns and checks everything the persona receives against a machinery
pattern (edit tags, role names, worker, crew, craft, draft, JSON, api, status codes, a raw key, §, rule
codes) and that its system prompt opens with his persona word for word. Keep every new message the
front can receive inside that harness.

- **A report he asked for was cut to "one or two things".** The persona was told never to read findings
  out, and worker notes are shown nowhere else: a check, audit or diagnosis he asked for was lost past
  a sentence. What he asked for now reaches the persona as the answer to give, all of it that matters;
  what the house read back on its own is set aside, mentioned only if it matters. Both voices.
- **A failure put machinery in its mouth** ("The editor could not finish: 401 …"). It is said as the
  persona can say it (`plainFailure`); the exact reason is on a card for him.
- **The frame was written by swapping pronouns**, which gave a first-person persona "talks to I". It is
  written in both voices, and says nothing about anyone working behind it.
- **Worker notes carried the engine's command words** (`*cleanup`, `#q`) and the persona's outline carried
  character counts; both are gone from what it reads. Workers keep the counts.
- **A draft set aside was reported as a change that did not come through**; it is counted, not reported.
- **A re-quote that repeated a change which had landed** came back as a false "not done", and its note was
  heard twice. A change that landed this turn is never made again; a re-quote adds no words.
- **A what-if lost its first word to "manners"** ("would that move Claire…") and sent the editor to change
  the document. Only "can you / could we" is politeness. "Claire is 17 now, not 16" is a correction;
  "can the story reach the siege?" goes to the novelist; a bare yes runs what the persona just offered.
- **Scrolling up during a fast reply was undone.** The scroll event lands a frame late, and a piece of the
  reply arriving in that frame found him still "pinned". Each piece measures where he is before it is
  added (`keepPlace`). Proven both ways with 200 pieces 5ms apart: 3201px before, left where he was after.
- **A second `function grow` stopped the whole app loading.** `node --check` parses a file as a script,
  where that is allowed; a module refuses it. Before every push, run ESLint 8 over `js/` as modules with
  `no-undef`, `no-shadow` and `no-redeclare` — no suite reaches every line, and a module that does not
  parse fails everything at once.

### Found in the persona audit, second pass (v1.1.4)

- **A persona written as "I" was addressed as "you".** The person setting defaulted to "second" whatever the
  frame said; Cozy Tavern's "Follow the frame" (M334) was never carried over. Left alone it now follows the
  frame's own opening words (`framePerson`); "you" and "I" overrule it. A house saved with the old default
  "second" follows too — for a frame written as "you" that is exactly what it was.
- **With no names set, the house wrote "You and they are building…" / "They and I are building…".** All four
  voices (you/I × named/unnamed) are written by hand; `tests/units.mjs` checks each for broken grammar.
- **With no name set, his words reached the persona as "you said:"** — telling it that it had said them.
  They arrive as "What was just said to you:"; with a name, under his name.
- **Go on put the house's order in his mouth** ("Bruce said: Carry on… No repetition and no preamble").
  It is a house note with no speaker (`GO_ON`).
- `inPerson`, the pronoun swapper, was dead code after v1.1.3 and is gone: no second way to voice the house.

### Found auditing the pipeline end to end (v1.1.5)

- **The router broke the craft's own law.** 7.6: a request is parsed for INTENT, "not matched to the nearest
  command keyword". The router was a keyword copy of 7.6 — the second copy of a law, disagreeing with the
  first. "Give the kingdom a second moon" reached nobody, and the persona then said truthfully that nothing
  changed; the craft's 7.6, 7.4 and 11 were read by no one. Plain words now go to **the listener**
  (`listener.js`): a model that reads 7.6 and 11, the crew, the documents' shape (names and sections, never
  their text), the conversation and whatever is waiting on him, and answers with jobs or none. It rides its
  own connection if given one (Settings → Who does what), else the backstage one, else the front's. Written
  commands keep their instant path; a greeting or thank-you with nothing waiting skips it; "ok / sure / yeah"
  never skip it, because after an offer they are the answer. If it cannot be reached or answers with
  nothing readable, the old reading runs (router.js `route` and the bare yes to an offer): a turn never
  fails because of it.
- **Every approval gate in the craft was a dead end.** The cleanup manifest (10.2, "never execute without
  approval"), a scene proposed before its bridge (9.1/9.2), the new-world interview and seed (7.1), a
  protected field, a change that outgrew its scope, `#prune`: the worker proposed, its proposal was never
  kept, and his answer reached nobody — "Tidy it up" could only ever propose. Now a worker puts what waits
  on him in `<ask>` (the craft's own `[PERMISSION_REQUEST]`, `[SCOPE_CREEP_WARNING]`, "CLEANUP MANIFEST"
  and "Pending approval" are read the same way); it is kept on the turn and on every version of it
  (`asks`); the persona is told to put every point of it to him; and the listener sends his answer back to
  the same worker with what it asked, word for word, and his own words (`jobFor`). An ask is open only for
  the message right after it. The walk proves the whole round trip in a real browser.
- **`#prune` reached no one.** It is the showrunner's, like `*cleanup`.

### Found auditing long work (v1.1.6)

- **Every backstage job was killed at 180 seconds** and reported as "stopped". A worker writing a whole plot
  essential on a real provider works for minutes; the device's relay already allows ten minutes of silence
  per call. The channel's ceiling is now a hang guard — thirty minutes — and a job that reaches it says so
  (`TIMED_OUT`, "it took far too long"), never "stopped", which is only ever his Stop. The status line shows
  how long a job has run once it passes fifteen seconds. Never seen before because every suite answers from a
  stand-in in milliseconds.
- **An answer cut at its length limit was asked for again from the start**, meeting the same limit: the
  worker's own floor is 8,000 tokens, the craft calls a mature plot essential 8,000 (7.4), and `*import` writes
  several files in one answer. A cut answer (`length` / `max_tokens`) is now carried on — the worker is shown
  what it wrote and asked for the rest, up to four times — and joined where the pieces meet (`joinSeam`).

### Found auditing plug and play (v1.1.7)

- **A persona pasted into the house was only saved when the box lost focus.** "Their instructions", "What
  they are called" and "What you are called" saved on `change`, which a browser fires on leaving the box: a
  persona pasted in and the app then left — the phone's Back, another app — was never saved, and nothing said
  so. Every suite set the persona through the API, never through the box. Now a pause of 0.7s saves what was
  typed, leaving the box saves it, and the page being hidden saves whatever is still waiting
  (`keepAsTyped`). `browser.py` types into the boxes without leaving them and reads the house back from the
  device; the old code fails those three checks.

### Found reading the device and the save line (v1.1.8)

- **A save cut short erased the world.** `read_body` read a body that ended early (a phone putting the app
  away mid-save) or was not JSON as `{}`, and `{}` was written over the world — proven on the old server: the
  world came back with no documents; `PUT {}` to the house came back 200 and the house became `{}`,
  connections and persona gone. A body is now read whole or not at all, and a world must hold its `docs`, a
  house its `settings` or `connections`, or nothing is written (400; the save line keeps its copy and
  retries).
- **A file that could not be read was taken for deleted, or replaced.** An unreadable world answered 404 (the
  app then says it was deleted) and fell out of the listing; an unreadable house was overwritten with an empty
  default. Both are now put back from their newest readable backup (`read_healing`), with the unreadable copy
  kept beside them; defaults are only ever written where no house exists.
- **Backups covered only the last few seconds.** Eight were kept, and saves land about once a second while he
  types. Now: the newest eight, the newest of each hour for two days, the newest of each day for a month
  (`keep_which`).
- **A world deleted while another was saving could come back.** The delete went out beside the save line, and
  a run already under way saved every world in its snapshot — proven: DELETE, then PUT brought it back. The
  delete now goes in the line, and a run skips a world no longer waiting.
- **Two house saves a moment apart could land stale-last.** They went out side by side; the device's threads
  landed the older one last and the newer change was lost (proven: his name vanished). House saves now go in
  order, each written from the house as it is when it goes.

### Found reading where a change lands (v1.1.9)

- **A new line quoted under a part-line went inside that line.** `insert_after` put the text right after the
  quoted words, so a quote stopping partway ("- The city lives inside") split the line in two — proven on the
  old code: "- The city lives inside\n- The Ribway floods… a dormant leviathan." It now goes under the end of
  the line the quote is on.
- **A document named loosely was "no document by that name".** "plot essential" for "Plot Essential.md" lost
  the change. `nameIn`: exact, then ignoring case, then without its ending — only when exactly one document
  answers; two that fit are refused, never guessed.

### Found finishing the persona audit (v1.1.10)

- **A pasted persona's `{{user}}` / `{{char}}` reached the model as braces when the names were not set.**
  With the two name boxes filled, macros already read as the names — but the plug-and-play case is a preset
  pasted in before the boxes are filled, and there the raw `{{char}}`, `{{user}}`, `<USER>`, `<BOT>` went
  straight to the front, exactly the persona-break he means. `voiceMacros` now falls back to a plain word
  ("the author", "the one telling this") that is grammatical wherever the macro sat — subject, object,
  possessive — so not one brace ever reaches the model; setting the names is still better and the house still
  nudges for it. `<ask>` is also stripped from anything the front reads, defensively.

### The version, findable (v1.1.11)

- **There was no place to just look up the version.** It appeared only in a toast behind a button named
  "Where the work lives", which vanished in a couple of seconds — a thing he could not find. A plain line now
  sits at the foot of the house, always shown: "CozyMaker · version X · your work is kept in <folder>". The
  toast button is gone (it was a second way to read what the line now shows). `browser.py` asserts the version
  is in the house body.

### Found when he said it was slow, built unasked, and would not clear (v1.1.12)

- **A question was slow because the document checks ran on every turn.** The sweep's hand-over sent up to two
  heavy workers whenever the plot essential had any leftover finding (an undated event, a heavy document), on
  every message — "what do you think of Mira?" waited on the chronicler. The checks now run only when the turn
  changed a document. A one-field edit is no longer read back in full: the craft's own `*edit` is "one field,
  one character, one fact. Required scan only" (11, 7.7). Proven on the old code: a question ran
  `listener, worker, front`; a one-field edit ran `listener, worker, worker, eye, front`.
- **Brainstorming built a plot essential.** The craft's 7.6 reads "here's my world" as a build, the old
  fallback built from any long message with nothing built yet, and a question was sent to the eye. The
  listener is now told, above the craft: he decides when writing starts — brainstorming, ideas, questions,
  opinions are conversation; nothing is written until he asks. The long-message rule and the loose builder
  keywords are gone; only an explicit ask builds, and the builder then reads the whole brainstorm
  (`BUILD_TALK`, 120,000 characters), not its last 24,000.
- **"Clear the plot essential" did nothing.** There was no clear or delete at all, and a worker's rewrite to
  nothing was refused by the guard against accidental loss. The listener now names documents to `clear` or
  `delete`; the house does it itself, first, with a card and "put it back" (a deleted document comes back
  with its kind). A delete lands on the live world too, unless he changed that document by hand meanwhile.
  A worker's own edit can never claim to be the house.
- **The connections did not say whether the model thinks.** Ported from Cozy Tavern: "Try it" is M351's
  probe — the request a turn would send, thinking read on every channel and from the reported reasoning
  tokens; a refused level is learned from and asked again (M350's fallback); nothing at his level is asked
  again at "max" to say whether the LEVEL or the ADDRESS gives none. The verdict stays on the connection. The
  card shows the level and how it is spoken, and what the model taught the house. "Show the models on offer"
  lists the provider's models (M348); a picked one keeps what it is — the weights behind an alias, the
  levels it takes — and those fit his chosen level automatically. The relay can GET a model list.

### His words are his (v1.1.13)

- **A plot essential brought in was changed on the way in.** The box says "It arrives whole", but the checks
  ran on import and took out every capitalised tag — the craft's own Fog of War value `[HIDDEN]` with them —
  and every "TBD:" line. It now arrives exactly as given (Windows line endings made plain); a worldbook in
  SillyTavern's shape is read into the one shape this house reads, its values untouched.
- **Only the craft's alerts are working notes.** They are all two or more words joined (EPISTEMIC_VIOLATION,
  PARROT_FIX …); a one-word tag — `[HIDDEN]`, `[TITLE]`, his own `[FLASHBACK]` — is his document's and stays.
  Alerts come out wherever they are, because they are never story.
- **The checks after a change took out what he had written.** They ran over every document when any changed,
  and removed "TBD:" lines, bonds, and empty headings regardless of who wrote them; leaving the editor did the
  same to his own typing. Now the checks look only at documents changed this turn, and `lint(…, { keep })`
  removes only what the crew added this time: his "TBD:" line, his bond, his empty heading stay.
- **"Clear it and build it again" could not build.** The builder creates the document by name and a cleared
  one still existed, so it was refused. Creating over an empty document now writes it.
- The walk now brings a raw plot essential in through the real screen and edits it in plain words
  ("Jovan should be seventeen now, not sixteen"): it arrives whole, the listener sends the editor, the editor is
  shown it word for word, the change lands, and nothing else of his moves.

### "Not done: that change leaves the words exactly as they were", four times (v1.1.14)

- **A change that put back the very words it found reached him as a failure, once per copy.** He saw
  "Bleach.md — not done: that change leaves the words exactly as they were" four times over a document that had
  not moved, and the persona was told it too. Either the words were already right (nothing to report) or the
  worker meant a change and wrote the old words back (the change he asked for never happened, and nobody tried
  again). It now goes back to the worker once, in the same round as a quote that missed: the worker sends the real
  change or leaves it out, and he never sees it either way. Proven on the old code, which shows the four cards.
- **The same failure is one card.** A worker that sends one failing change several times makes one card, not one
  per copy (`allCards` keeps each refusal once).

### Found making a new world fast and whole (v1.2.0)

- **A whole plot essential was lost to one bare quote.** The builder wrote the document inside a JSON string;
  a plot essential is full of double quotes (the template's own dialogue lines, `> "…" —Claire`, and `LAST:`),
  and a model leaves them bare very often. Proven on the old code: both shapes (line breaks escaped, quotes
  bare; both bare) parsed to **0 changes** — the worker was asked for the whole document again, minutes, and
  could fail the same way. Two fixes. A whole document is now written plainly between `<file name="…">` and
  `</file>`, nothing escaped (`readFiles`), and every worker is taught that form. And a quote inside a value is
  read for what it is by what follows it (`escapeStrayQuotes`): it ends the string only where the data can go
  on from there; a closing quote gone missing before the next name is refused, never guessed. Only tried after
  every older repair fails, so valid data never reaches it. Proven both ways: taken out, 4 checks fail.
- **A document the crew started was given its kind by a second, thinner guess.** `kindFromName` in run.js knew
  nothing of instruction sets or transplants, so an instruction set its writer started as "Eni.md" became a
  plot essential, and the plot essential's checks took out its "TBD:" line and its empty heading. One rule now,
  `js/doc/kind.js`, shared by the screen and the crew; a document is first the kind its maker makes (the
  instructions writer, the worldbook keeper, the auditor, the scribe), else what its name and words say. The
  maker travels with every version of an answer, so walking versions makes it the same kind again.
- **A new worldbook could not be begun the way its keeper's craft says.** The craft (the extension's, carried
  over as it is): "Empty document -> initialize with an append edit whose replace value is a JSON array". The
  house seeded a new worldbook as `[]`, so the first entries made `[]\n[…]` — not readable, and a second worker
  was sent to repair it. New documents start empty, as the extension's did; and a list written after a list
  (or an entry after a list) is joined by code, because what it means is certain.
- **A full rewrite into the very words that were there made a card saying it changed**, and the persona was told
  so. It makes no card now, in either form.
- **An answer left open inside `<file>` is carried on** (the same carry-on as a cut answer, told plainly that the
  document is open), and a continuation that brings nothing stops the carrying on.
- `__pycache__/serve.cpython-312.pyc` was committed, and every test run changed it. It is ignored now.

### A new world, named and ready (v1.2.1)

- **A world kept the name "A new world" for ever.** The plot essential names itself on its first line
  (`# PLOT ESSENTIAL — The Leviathan Quarter — V1.0`), but the world never took it, so the shelf filled with
  worlds all called the same. While a world still has the name nobody chose (`DEFAULT_WORLD_TITLE`), it takes
  the one its plot essential gives (`nameWorld`, `js/doc/index.js`) — where a document arrives whole: a turn
  landing (`landTurn`), one brought in, one he finishes typing (on leaving it, never mid-keystroke, where half a
  title would stick), a world opened (`upgradeWorld`, written back at once). A name he gave is never touched;
  a continuation file's heading and the template's own `[TITLE]` are never a name.
- **Making a new world left the drawer open over it**, so the first thing to do in a world just made was close
  something. It shuts; he is in the empty room, where how to begin is said. Found by the walk.

### The crew's calls stream (v1.2.2)

- **A worker's call was asked for all at once**, where Cozy Tavern's workers ride the same streamed path as its
  storyteller (M28, M270). A worker writing a whole plot essential sat silent for minutes with only a clock to
  show it was alive, and a provider behind a gateway that closes a silent connection could cut it and lose the
  lot. Every call now streams (`callModel`, `stream` defaults on); "Try it" alone asks all at once, because only
  a whole answer reports the thinking tokens an address keeps to itself.
- **One reader for every answer** (`readReply`), for the front and the crew: a stream line by line, what is left
  when it ends, and an answer that is not a stream at all — the device's one-object refusal, or a provider that
  ignored "stream" and answered whole. **The front used to show that last one as an empty reply.** An error in
  the middle of a stream is an error, never a finished answer: what reads as passing is tried again, anything else
  is said once and at once, and it never teaches the house a lesson about thinking (the request was taken). A
  stream that ends having said nothing and never said it was done is tried again.
- **How far along it is, on the status line**: "the builder is on it · 1,240 words so far" (`onProgress`, counted
  over every piece of a carried-on answer). The label keeps its own clock; a word count arriving never restarts
  it. The walk watches it on screen while a slow builder writes.
- **The status line was overwritten by a bare worker id.** The channel announced each job's label ("builder",
  "listener") a moment after the turn had said "the builder is on it", and the room showed the id. The room no
  longer listens to it; the turn says what is happening, in words.
- Every stand-in model in the suites now tells the front from the crew by who is asking, not by whether the call
  streams, and the browser suites' stand-ins stream the crew's answers — so the real browser reads the crew
  through the streamed path end to end.

### His answer is written while the listener reads (v1.2.3)

- **Every plain message waited on a whole model call before the one he talks to began.** The listener reads
  each message first; on a model that thinks that is ten to thirty seconds of nothing, every message, while he
  talks a new world through. Now, when nothing about the message looks like a job and nothing waits on him
  (`plainTalk`: no keyword job, no bare yes to an offer, nothing asked of him), his reply starts at the same
  moment as the listener, **held unseen** (`heldFront`). If the listener sends nobody and clears nothing, it is
  shown the instant the listener has answered — built by the same `frontMessages` from the same inputs, so word
  for word what it would have been (a unit checks the two requests are identical). If the listener sends
  somebody, it is let go, never seen, and the reply is written after the work as always.
- **Measured in the real browser**, a 2 s listener and a 2 s reply, press to reply on screen, three runs:
  1.2.2 4.25 / 4.17 / 4.17 s; now 2.22 / 2.12 / 2.11 s. The walk keeps it (fails over 3.4 s; ran against 1.2.2
  it fails at 4.5 s).
- **Starting early can never cost him his answer**: an early reply that failed before a word came, for a reason
  starting early could cause (busy, a limit on calls at once, a dropped line), is asked for again the ordinary
  way; a bad key is said once, never asked twice (the walk caught that). Held thinking keeps the moment it really
  arrived, so the box says how long the model truly thought.
- A connection that refuses a thinking field is now met by the listener and the reply together on the very first
  call, and each learns from it; the walk checks each one's own tries, never their interleaving.

### Every worker holds what it is told to run (v1.2.4)

- **Seven of the nine workers were told to apply the Core Mandates and never given them.** The spine every
  worker reads (1.3, 3.x, 4) cites M1, M2, M3 and M5 by name — ripple every change through the whole world,
  record only and invent no motives, no predictive text, and the named list of error classes to scan for — and
  only the eye and the diagnostician read 1.1. The builder was told to run its pre-delivery gate ("Verification
  Engine → Expert Eye Tier A on EVERY dossier") and given neither 7.3 nor 2.4; told a blueprint is untrusted and
  "CBPA applies" with no CBPA (7.2); told its import runs "Verification Engine in Preservation Mode, Auto-Fix
  Mandate (8.2)" with neither. The compressor was told to re-run the Shared Audit Pipeline (8.3) it had never
  read; the scribe's own pipeline says "Full CBPA on every event (all seven checks, 7.2)" and it had no 7.2.
  Found by computing, for every worker, each named check and section its reading points at against what it
  reads (his rule: a worker told to use something it never receives will invent it).
- The spine now carries 1.1, and section 2's two-line heading, 2.1 (Anti-Parrot) and 2.3 (the Evidence
  Requirement) that every workflow's report asks for. Each worker is given what its workflow orders it to run.
  Tier A, Tier B and the Auto-Fix Mandate are held by the eye, which reads back every change but a surgical edit;
  the editor, whose one-field edits are not read back, carries Tier A itself. A unit computes the rule from the
  craft and fails on any gap without a written reason; on the old slices it fails for all nine workers.
- Every stand-in model in the suites knew the eye by "THE EXPERT EYE", section 2's heading — now in everyone's
  reading, so the builder and the editor were taken for the eye. They know it by 13.6, which only the eye reads;
  every other marker was checked to be read by exactly one worker.

### "Build it" builds (v1.2.5)

- **The plainest ways to ask for a build were read as talk.** The keyword reading's build rule fires only when
  the sentence names the plot essential (v1.1.12: talking a world through must never start one unasked), so
  "ok build it", "let's build it", "go ahead and build it", "write it up", "can you build it?" all read as
  talk. That reading is the fallback whenever the listener's answer cannot be read — and then "ok build it" in a
  new world got a friendly reply and nothing built — and it decides whether his reply is started early, so every
  build request started one and threw it away. Now, while a world has no plot essential, a whole short sentence
  that IS the ask builds (`BUILD_IT`, router.js); a sentence that merely holds "build" ("the guild would build it
  into the tides", "make it darker", "how would you build it?") is still talk, and with a plot essential there
  "build it" is left to the listener. "Turn this into a plot essential" builds wherever it is said.

### One name for the button, one answer to "is there a plot essential" (v1.2.6)

- **The room taught a button that then could not be found by that name.** The empty room says "Start a plot
  essential builds it from everything you said" — and goes the moment he speaks. The same action in The documents
  and the drawer was called "New plot essential". One name everywhere now, **Start a plot essential**, and the room
  says where it stays (and that saying "build it" does the same). His rule: a control he cannot find does not exist.
- **Three answers to whether a world has a plot essential.** The room and the crew counted one with words in it;
  The documents and the drawer counted any plot essential document, so after "clear the plot essential" they
  offered nothing to start one again. One rule, `hasPlotEssential` (js/doc/index.js), everywhere. (The name the
  documents list suggests for a new document still asks whether any such document exists — to avoid a clash.)
- The README still said a world "gets built as you talk" — false since v1.1.12. Corrected.
- **The same search, across every button (v1.2.7):** going back to the documents list was "All documents" at the
  top of the sheet from a document and from Bring one in, but a second button, "Back to the documents", in the
  body of Side by side — where the top still said "New document". Side by side goes back the same way now. No other
  action in the app has two names (every button label listed and compared).

### The crew's names for its checks never reach the persona (v1.2.8)

- **Found as a consequence of v1.2.4.** Every worker now reads the sections that name the craft's checks, and the
  craft's own report format asks for them — so a worker's notes say "per Protocol 20. Tier A passed; Named-Person
  Gate clean; Disease Scan on ages clean; CBPA …", and the notes reach the persona. `naturalize` already turned
  SCAN EVIDENCE, tags, M-codes and section numbers into nothing or plain words; the checks' own names went through,
  for the persona to repeat to him. Fixed at the source — the return contract asks for what was read and checked
  in plain words, with none of the craft's names for its checks — and backstopped: any that slip through are said
  the way a person would ("the checks passed", "a sweep for the same mistake everywhere"). Ordinary words ("the
  tier of the tower", "a protocol officer") are untouched. The persona firewall's machinery list now includes
  them, with a worker that writes every one; without the backstop it fails.

### The connections panel, read to its end (v1.2.9)

- **A connection kept its last test result after it had become another connection.** "Last tried …: Thinking works
  on this connection" stayed under a connection whose model, address, key or thinking had since changed — telling
  him something about a model he no longer uses, as if current. What the model taught the house was already safe
  (the lessons are kept for one model at one address, `learnKey`); the test result was not. It goes now whenever
  what it was said of changes; a rename keeps it.
- **Remove on a connection deleted it, key and all, on one tap.** Every other delete here asks first and says what
  survives; this one kept no copy at all, because keys are never put in a backup. It asks now, and says the key
  goes with it.
- Read to its end and sound: nothing left empty is ever stored as a number; the front falls back to the first
  connection when its own is removed, and so does the dropdown that shows it; lessons never cross models.

### Export for SillyTavern reads the way the house does (v1.2.10)

- **The export refused a worldbook the house could read.** It read with the extension's reader alone, which fixes
  only trailing commas, and said "cannot be read as data right now — tap Check it, then export" — while the
  documents list, reading the house's way (`readWorldbook`: a line break inside a value, a list written after a
  list, a list wrapped as `{entries}` or in SillyTavern's own shape), was already counting its entries. Detection
  handed to him as a task. The export reads the house's way now and maps with the extension's own pipeline; only
  what no rule can read is left for the keeper, and the message says Check it will put it right. The walk exports a
  list written after a list and gets both entries; with the old reader it gets that message instead.
- `worldbook.js` and the export mapping are the extension's, unchanged, held by `tests/fixtures/worldbook-export.json`.
- **The same search, everywhere a worldbook is read (v1.2.11).** Two more read it with a bare parse. The loss guard's
  count (`countOf`) called a list written after a list uncountable, and the guard stands aside for what it cannot
  count — so five entries rewritten as two, written that way, would have landed unchallenged. And the outline the
  crew and the persona are shown (`parseDoc`) showed such a worldbook, or a SillyTavern export pasted in, as empty.
  Both read the house's way now (`readWorldbook`); on the old readers the four new checks fail, the guard's by
  letting the loss through.

### The transplant check answers to Summaryception's own importer (v1.2.12)

- `lintTransplant` (carried from the Plot Essential Maker, v0.14.1) exists to say what Summaryception's importer
  would silently drop. Held against the importer itself — `parseTransplant` from Summaryception v5.122.0, copied
  verbatim into `tests/fixtures/summaryception-import.js` — it missed two drops and raised one false alarm:
  **a dossier whose fields are all empty** (the importer keeps an entry only if some field has words — the check
  only looked for the field names); **a closer carrying a payload** (`<!-- /SC-SNIPPET {…} -->` is not a closer to
  the importer, so the block runs on and swallows what follows — the check counted it as one); and **a dossier whose
  first field line is indented** (the importer trims the block first; the check did not, and called it fieldless).
  Both drops also went past the loss guard, which reads this check: an auditor's rewrite that emptied a dossier
  landed. Mirrored now, move for move; a unit runs every transplant through both and fails if the importer loses
  anything the check calls sound. The extension's 16 recorded answers are unchanged.
- The Plot Essential Maker extension in SillyTavern carries the same `lintTransplant`, with the same two gaps.

### A thumb that lands a little off (v1.2.13)

- The stylesheet read for a phone: safe-area insets on every edge, `viewport-fit=cover`, no `100vh`; the small text
  in boxes does not matter on his browsers (Chrome and Opera on Android do not zoom on focus). Every visible button
  was then measured in the real browser at 390px. Text buttons are 37px tall and 80–144px wide — easy to hit. The
  one real miss: the small icon buttons — the ⋯ on every world and conversation, the ◂ ▸ between answers — were
  34 × 34px, under the ~44 a thumb needs; a tap a little off the ⋯ opened the world instead of its menu. They keep
  their look and take a touch 5px beyond it on every side. Measured with taps 4px outside each edge: 0 of 4 landed
  before, 4 of 4 now; the walk holds it.

### Every test runs the thing (v1.2.14)

- Every test file was scanned for tests that read the app's source instead of running it (his rule: a test that
  would pass with the feature deleted is worse than none). One did: "the craft is fetched from the root" passed by
  finding a string in `slices.js`. It now loads the craft through a fetcher that records what it was asked for, and
  also proves a craft file that will not come is said, not left for every worker to read nothing; both fail when
  the loading is broken. The other two tests that open files are sound — one edits `serve.py` to prove the server
  relights, the other checks the worldbook craft, which is data the keeper reads. No test's condition is a constant.

### A reply broken off partway is a cut reply (v1.2.15)

- **A truncated reply passed for a finished one** (older than today). When a provider said something went wrong in
  the middle of the persona's reply — an error event in the stream, which OpenRouter and others send — whatever had
  arrived was shown as a whole reply: no failure, no Go on. It is kept as what it is now: cut, by the provider
  (`cutBy: 'provider'`), the room says "the provider stopped partway" rather than "ran out of room", and Go on
  carries it on. The reason travels with the turn: a Go on that finishes clears it, and a version kept aside keeps it.
- **The device's relay let a provider that broke mid-answer escape its handler** (a dropped line, a read that timed
  out, a broken handshake), leaving the page's stream without its end — a bare network error in the middle of
  reading, and even what had arrived lost to a reader taking the answer whole. It now says so on the stream, as an
  error marked passing (a worker asks again), and ends the stream properly. `tests/server.py` drops a provider's
  line partway: on the old relay all three checks fail.

### A story card, pasted, becomes a world ready to play (v1.3.0)

- **`*card`** (and **Build from a story card**, a paste box in the empty room, The documents and the drawer — one
  door: the box sends `*card` + the paste). For community stories from Isekai Zero, AI Dungeon and the like, whose
  hidden prompt cannot be copied but whose premise, plot, characters and opening can. It is the craft's own `*new`,
  reading the card as a blueprint (7.1's Blueprint Ingestion Protocol) — `storyCardTask` in router.js holds what
  the builder is told: his standing leave to add what makes it more immersive and leave nothing a storyteller needs
  blank (all of it current fact, never contradicting the card, said in the notes); the card's notes to its own AI
  kept out of the plot essential; "you" is his character; the first opening unless he names another; finished in
  one answer. What he writes before `*card` (who he plays) travels with it.
- **The whole message is one job.** Read clause by clause like other messages, a card saying "clean up her messes"
  sent the showrunner too, in any world with documents; and the builder got only the first paragraph as its task.
- **A card gets a world of its own**: sent in a world that already has a plot essential, a new world is made first,
  so nothing is written over; it takes the card's title when built.
- **Make a worldbook from it**, on every plot essential: the worldbook keeper writes its world as SillyTavern World
  Info (its own craft: blue always on, green on keywords and — through the export — vectors too, chain on vectors
  only), and Export for SillyTavern hands it over.

## Testing

```
bash tests/all.sh           all seven, exit code intact
```

    node tests/units.mjs         773 checks — the real modules on a real document, and what the persona hears
    node tests/thinking.mjs       13 checks — every thinking level against 198 answers from Cozy Tavern's own code
    node tests/saves.mjs          20 checks — the real store against a server that goes down
    python3 tests/server.py       49 checks — the real serve.py, real files on disk, streams timed
    python3 tests/browser.py      75 checks — real Chromium at 390x844, end to end
    python3 tests/walk_worlds.py 188 checks — the drawer, conversations, swipes and versions, edit and
                                              send again, delete, branch, go on, re-quoting, crafts,
                                              the thinking box live, backup and restore, a model too
                                              small for the world, a real server killed mid-edit
    bash tests/launcher.sh        21 checks — real clone, install, updates pulled live,
                                              and a Cozy Tavern stand-in that must survive

1,139 checks. All seven must be green before a push. `tests/fixtures/` holds answers recorded from the
real code of Cozy Tavern and the Plot Essential Maker; a copy here that disagrees with them is wrong. Never pipe a gate through
`tail` or `head` — they mask the exit code, and a gate whose failure cannot be
seen is not a gate. Measure check counts from real output; never predict them.

A test must **run** the feature: write data, read it back, assert on what came
back. A test that would still pass with the feature deleted is worse than no
test. Nothing in these suites reads source, counts files, or checks a comment.
Where a fix could be doubted it was proven both ways — the test fails with the
fix taken out and passes with it in (the stream's last line, the save note's
stacking, the save line itself).

`tests/browser.py` and `tests/walk_worlds.py` stand a small real model up on a
port and read the prompts that were actually sent to it. That is how the
persona firewall is proved and how it is known which worker was dispatched —
not by reading the code that was supposed to do it.

---

## Running it

```
./install.sh        once
cozymaker           thereafter
```

`cozymaker.sh` compares the running server's `/api/version` against the folder
and puts out an older one still holding the port, and `serve.py` re-execs when
its own file changes. An update that leaves the old server running is an update
the writer cannot see; that has happened before elsewhere and is not allowed to
happen here.


---

## The tavern at night

`css/tavern-night.svg` is drawn by hand: one file, no photograph, nothing
fetched from anywhere. It is used as a background layer with a scrim over it.

The framing is the whole problem and the only thing worth remembering. The
scene is wide; a phone held upright is not. Told to `cover`, it crops to a
four-hundred-pixel slice of empty sky and the party, the tavern and the bard
are all off the edges. So it is laid along the bottom at its full width, at its
own proportions, lifted clear of the composer, with the sky above painted to
match and its top faded out so there is no seam. The layer must be tall enough
for the picture **and** the lift; sized to the picture alone, raising it cuts
the moons and the aurora off the top.

Text contrast over the scene is measured from real pixels in `browser.py` —
the ink colour against the brightest part of the night actually sitting behind
a paragraph, sampled from the stream's own margin where there is no text.
Currently 17.0:1. A picture behind words is only worth having if the words are
still easy to read on the worst patch of it.
