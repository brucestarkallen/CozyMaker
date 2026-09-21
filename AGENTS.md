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
scribe           41,253      showrunner     28,827      editor      26,401
eye              41,054      diagnostician  28,650      builder     25,827
compressor       37,506      chronicler     28,299      novelist    24,907
the whole craft 122,410 — nobody carries all of it
```

The biggest slice is 34% of the monolith. That is the entire argument for
several workers instead of one: a worker reading only its own laws applies
them; a worker reading all of them skims.

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
js/agents/router.js    plain words -> the right worker (arithmetic, not a model)
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

## Testing

```
bash tests/all.sh           all seven, exit code intact
```

    node tests/units.mjs         495 checks — the real modules on a real document, and what the persona hears
    node tests/thinking.mjs       13 checks — every thinking level against 198 answers from Cozy Tavern's own code
    node tests/saves.mjs          20 checks — the real store against a server that goes down
    python3 tests/server.py       31 checks — the real serve.py, real files on disk, streams timed
    python3 tests/browser.py      66 checks — real Chromium at 390x844, end to end
    python3 tests/walk_worlds.py 139 checks — the drawer, conversations, swipes and versions, edit and
                                              send again, delete, branch, go on, re-quoting, crafts,
                                              the thinking box live, backup and restore, a model too
                                              small for the world, a real server killed mid-edit
    bash tests/launcher.sh        21 checks — real clone, install, updates pulled live,
                                              and a Cozy Tavern stand-in that must survive

785 checks. All seven must be green before a push. `tests/fixtures/` holds answers recorded from the
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
