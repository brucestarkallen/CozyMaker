# The line-by-line audit (from v1.6.1)

Asked for on 6 Oct 2026: every file, line by line, until nothing is left. This is the ledger, so the audit
carries on across sessions exactly where it stopped. A file is marked **done** only when every line of it
was read; a finding is **fixed** only with a law in the suites that fails on the code before the fix.

| file | lines | state | what was found |
|---|---|---|---|
| js/store.js | 436 | done | clean — every caller of openProject/createProject flushes the open world first; the save line, retries and deletes hold |
| serve.py | 531 | done | **fixed** — two document names that clean to the same file name shared one file in the shell copy, the second writing over the first; and every save rewrote and flushed every document's copy, changed or not |
| js/doc/edits.js | 758 | done | **fixed** — a quote that fits in two OVERLAPPING places ("ab ab" in "ab ab ab") was counted once and written at the first, breaking the one law of finding; checked and sound: the undo record of a deleted document keeps its kind (run.js commit rebuilds it) |
| js/agents/run.js | 1–540, 540–725, 905–1290 | done | **fixed** — the thought-stripper ran over a worker's whole answer, documents included: a preset or instruction set holding the word <thinking> was cut there, and his question in <ask> after it was lost; **fixed** — the persona re-read its own earlier reply through that same stripper, so a reply that named a <thinking> tag mid-sentence came back to it cut short |
| js/agents/run.js | 725–905 | done | **fixed** (v1.6.2) — the turn read the crew's cards by position, so a change that left a document exactly as it was (a whole file sent back unchanged) wrote no card and shifted every card after it onto the wrong change: a change that had landed, repeated in a re-quote, came back as a false "not done" (reproduced through the real turn) |
| js/agents/call.js | 528 | done | clean |
| js/agents/listener.js | 161 | done | clean |
| js/agents/roster.js | 49 | done | clean |
| js/ui/kit.js | 141 | done | clean |
| js/ui/pace.js, js/ui/streamtext.js | 44, 64 | done | written in v1.6.0, read whole |
| js/ui/app.js | 1–480, 760–1030 | done | v1.6.0's own fixes (see AGENTS.md) |
| js/ui/app.js | 480–760 | done | clean — edit, send again from here, delete, branch, go on |
| js/doc/lint.js | 617 | done | **fixed** — taking out one of the craft's markers collapsed the spacing of the WHOLE document, flattening the craft's own indented lines ("  - e007: …"); **fixed** — an event written with its tags but no colon after them was read by its first letter alone and sent to the chronicler to be tagged, every turn |
| js/ui/docs.js | 1–130, 330–480 | done | clean — leaving a document, the hand-edit put-back, Import, a story card |
| js/ui/docs.js | 130–330, 480–676 | **not yet** | |
| js/providers.js | 460 | done | **fixed** — a streamed reasoning field that is not text was added to the thinking as "[object Object]" (the whole answer already took words only) |
| js/ui/settings.js | 508 | **not yet** (the look read) | |
| js/agents/router.js | 368 | done | clean |
| js/doc/index.js | 339 | done | clean |
| js/ui/drawer.js | 245 | done | **fixed** — a transplant and an instruction set were called just "document" on the shelf, where The documents name them; a plot essential saved before kinds existed got no Tidy it up |
| js/doc/transplant.js | 165 | **not yet** | |
| js/engine/slices.js | 148 | **not yet** | |
| js/doc/worldbook.js | 130 | **not yet** | |
| js/agents/persona.js | 128 | **not yet** | |
| js/agents/shortcuts.js | 112 | **not yet** | |
| js/doc/entries.js | 100 | **not yet** | |
| js/doc/kind.js | 51 | **not yet** | |
| js/doc/branch.js | 48 | **not yet** | |
| js/engine/crafts.js | 46 | **not yet** | |
| index.html, css/cozy.css, sw.js, manifest, cozymaker.sh, install.sh | | **not yet** | |
