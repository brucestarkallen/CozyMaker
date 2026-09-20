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
js/store.js            the browser holds only the open world
js/ui/                 kit, app (the room), docs, settings
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

### Storage

The device holds everything, under `~/.cozymaker`. The browser holds only the
world that is open, and only so the page can draw. **There is no syncing
between browsers**, deliberately, and there never will be. Saves are atomic,
the previous version is kept, and every document is also written as plain
markdown under `~/.cozymaker/exports/` so it is reachable from the shell.

---

## What was carried over from Cozy Tavern and Cozy Chat

Both were read for their documented faults before this shipped — Cozy Tavern's
`AGENTS.md` (8,495 lines of milestone history) and Cozy Chat's `AGENTS.md`.
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
  take away the empty heading he is about to fill. There is no button and
  there is not meant to be.
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

---

## Testing

```
bash tests/all.sh           all three, exit code intact
```

    node tests/units.mjs      229 checks — the real modules on a real document
    python3 tests/server.py    29 checks — the real serve.py, real files on disk
    python3 tests/browser.py   64 checks — real Chromium at 390x844, end to end

All three must be green before a push. Never pipe a gate through `tail` or
`head` — they mask the exit code, and a gate whose failure cannot be seen is
not a gate. Measure check counts from real output; never predict them.

A test must **run** the feature: write data, read it back, assert on what came
back. A test that would still pass with the feature deleted is worse than no
test. Nothing in these suites reads source, counts files, or checks a comment.

`tests/browser.py` stands a small real model up on a port and reads the prompts
that were actually sent to it. That is how the persona firewall is proved and
how it is known which worker was dispatched — not by reading the code that was
supposed to do it.

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
Currently 16.8:1. A picture behind words is only worth having if the words are
still easy to read on the worst patch of it.
