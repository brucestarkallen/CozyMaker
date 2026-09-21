# CozyMaker

A comfortable place to build a world.

CozyMaker makes the guide a storyteller later reads as the whole truth of your
world — the plot essential, the continuation files, the worldbook. You talk to
one person about it. A crew works behind them and you never hear from the crew.

## Getting it running

In Termux:

```
git clone https://github.com/brucestarkallen/CozyMaker
cd CozyMaker
./install.sh
cozymaker
```

That's the only time you type all of that. From then on, one word:

```
cozymaker
```

It pulls the latest, replaces the running server if it's out of date, and opens
the app in your browser. If nothing changed it just opens the app. It never
touches Cozy Tavern — both run a file called `serve.py`, so CozyMaker only ever
stops whatever is on its own port (8090), and only by asking it to leave.

If something else is on 8090: `COZYMAKER_PORT=8091 cozymaker`.

Everything you make lives on the device, in `~/.cozymaker`. The browser holds
only the world that is open. There is no syncing between browsers — close every
tab, open a different browser, reboot the phone, and the work is exactly where
it was.

Every document is also written as plain markdown under `~/.cozymaker/exports/`,
so you can reach it from the shell without opening the app.

## Setting it up

Tap the cog.

**Who you are making this with.** Paste your own instructions — who they are,
how they talk. They go first and are never touched. Then their name, your name,
and whether this place speaks to them as *you* or as *I*. Everything the app
adds underneath is written the way two people talk, so nothing in here can
knock them out of character.

**Connections.** Address, model, key. What you set is what gets sent — your
temperature, your top-p, your thinking. What you leave alone is not sent at
all, so the provider does whatever it normally does. "Try it" makes a real call
and tells you what came back.

**Who does what.** The one at the front is the only one you talk to. Any of the
crew can have their own connection: careful backstage work can ride a cheap
model while the front keeps the good one.

## Using it

Talk. Tell them about the place, the people, the trouble, or paste something
you already have. There are no commands to learn — "change Claire's age to
fifteen", "fold all that into the plot essential", "this has got convoluted,
untangle it" all reach the right person. The old written commands (`*new`,
`#q`, `*continuity`, `*optimize`, `#skip`, `*cleanup`…) still work if you
prefer them.

If you are just talking, nobody gets sent anywhere. It is meant to be a
comfortable place, and a comfortable place lets you talk.

Changes land in the documents themselves and show as small cards underneath the
reply, each with **put it back** if you want it gone. Tap **what changed** on a card
to see what was there before and what is there now.

**Tap any message** for **Copy**, **Edit**, **Branch here** and **Delete**. The last
reply has **Another answer**; ◂ ▸ walks between the answers, and only the one shown
is in the documents. Edit one of your messages and **Send again from here**: whatever
the later replies changed is put back first. Deleting a reply that changed something
puts that back too. A reply cut off at the limit offers **Go on**.

**Your worlds and conversations** are on the left: tap ☰ at the top left, or
swipe in from the left edge. Worlds are listed newest first. Inside the open
one are its conversations — as many as you like, all working on the same
documents — and its documents. Every world and conversation can be renamed or
deleted from its ⋯.

**New plot essential** starts one with the crew: tell them about the world and
it gets built as you talk. **Bring one in** takes a plot essential,
continuation file or worldbook you already have — paste it or pick the file —
and tidies it on the way in.

**Every document carries its jobs by name:** *Tidy it up* (untangle and
declutter), *Make it shorter*, *Check it*. A worldbook also has *Export for
SillyTavern*, which saves it in SillyTavern's World Info format — import it
there under World Info. Each job shows in the conversation in plain words, the
same as if you had typed it.

A document also has **Copy all**, **Save as a file**, **Duplicate**, and — after you
have edited it by hand — **Put back my edits**. **Side by side** shows two to four
documents next to each other. Under the cog, **Save everything to a file** keeps
every world in one file (not your connections or keys), and **Bring everything back
from a file** only ever adds: nothing already here is replaced.

A connection's thinking level is said the way that provider understands it —
the same words Cozy Tavern sends, checked against it. A level you have not set is
not sent. If a provider refuses a thinking setting, the house learns what it takes
and remembers it for that model.

While the crew works, the send button becomes **Stop** and looks like it. A
turn that failed and changed nothing offers **Try again**. If the server on the
phone stops answering, a note says so and your work keeps trying to save until
it lands — keep the page open.

## The look

Four coats of paint under the cog. **The tavern at night** puts a drawn scene
behind the room — purple sky, two moons, an aurora, lanterns strung across a
yard, a bard mid-song and somebody buying a round. It is one hand-drawn file,
nothing is fetched from anywhere, and the words stay at 17.0:1 contrast over
it, measured rather than assumed.

## The crew

| | |
|---|---|
| **the builder** | starts a new world, or rebuilds an old story without losing a word |
| **the chronicler** | folds what happened into the plot essential |
| **the scribe** | turns notes, a summary or pasted prose into a clean continuation file |
| **the editor** | changes one exact thing and leaves the rest alone |
| **the eye** | reads the whole thing back and catches what slipped past |
| **the showrunner** | untangles a story that has grown knotted |
| **the compressor** | says the same thing in fewer words, losing nothing |
| **the novelist** | works out whether the story can reach where you want it |
| **the diagnostician** | works out why the storyteller went wrong |
| **the worldbook keeper** | builds and keeps a SillyTavern worldbook, every field chosen per entry |
| **the memory auditor** | audits and repairs a Summaryception transplant, markers intact |
| **the instructions writer** | writes and keeps AI instruction sets and presets |

The last three work from the Plot Essential and Instructions Maker's own crafts
(its Worldbook Maker and Summaryception Auditor, word for word) and your own for
instructions; each can be changed from its document, with the original one tap
away. The craft the rest work from lives in one file, `engine/generalist.md`. Each of them
is handed only the parts of it their job needs — the biggest share is a third
of the whole. The cog, under the floor, shows exactly who reads what.

## For anyone working on the code

Read `AGENTS.md` first.

```
bash tests/all.sh    seven suites, 688 checks
```

`docs/lineage.md` lists every version of Cozy Tavern and Cozy Chat and what
each one means for CozyMaker.
