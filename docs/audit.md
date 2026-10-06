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
| js/agents/run.js | 725–905 | **not yet** | the crew loop: dispatch, repairs, the read-back |
| js/agents/call.js | 528 | done | clean |
| js/agents/listener.js | 161 | done | clean |
| js/agents/roster.js | 49 | done | clean |
| js/ui/kit.js | 141 | done | clean |
| js/ui/pace.js, js/ui/streamtext.js | 44, 64 | done | written in v1.6.0, read whole |
| js/ui/app.js | 1–480, 760–1030 | done | v1.6.0's own fixes (see AGENTS.md) |
| js/ui/app.js | 480–760 | **not yet** | edit, branch, delete, go on |
| js/doc/lint.js | 617 | **not yet** | |
| js/ui/docs.js | 676 | **not yet** | |
| js/providers.js | 460 | **not yet** | |
| js/ui/settings.js | 508 | **not yet** (the look read) | |
| js/agents/router.js | 368 | **not yet** (route read) | |
| js/doc/index.js | 339 | **not yet** | |
| js/ui/drawer.js | 245 | **not yet** | |
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
