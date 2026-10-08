# CozyMaker

A comfortable place to build a world.

CozyMaker makes the guide a storyteller later reads as the whole truth of your
world — the plot essential, the continuation files, the worldbook. You talk to
one person about it, and they do the work: they read your whole engine and every
document, word for word, and change the documents themselves — the way your own
engine ran in one model. When they want a second pair of eyes or a keeper with a
craft of its own, they call one of their helpers by name, and what the helper
says comes back to them before they answer you.

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

**Who does what.** The one you talk to does the work. Their helpers can each
have their own connection: careful work can ride a cheaper model while the one
you talk to keeps the good one.

## Using it

Talk. Tell them about the place, the people, the trouble, or paste something
you already have. There are no commands to learn — "change Claire's age to
fifteen", "fold all that into the plot essential", "this has got convoluted,
untangle it" all reach the right person. The old written commands (`*new`,
`#q`, `*continuity`, `*optimize`, `#skip`, `*cleanup`…) still work if you
prefer them. `*regress` keeps a line in the anti-regression registry every update reads; `*show_full_file`
opens the plot essential whole; `*next` carries on a reply that was cut off. Every shortcut, what it
does and how to type it, is under the cog, in **Shortcuts**. A new story — asked for in plain words, typed as `*new`, or a
story card — in a world that already has a plot essential gets a world of its own, with the talk that led to it.

If you are just talking, nobody gets sent anywhere. It is meant to be a
comfortable place, and a comfortable place lets you talk.

Changes land in the documents themselves and show as small cards underneath the
reply, each with **put it back** if you want it gone. Tap **what changed** on a card
to see what was there before and what is there now.

When a model thinks, a **Thinking** box sits above its reply. It opens the moment
the model starts thinking and fills as the thinking arrives, from its first word,
counting the seconds. When the reply begins, it folds itself shut and says how
long the model thought. Tap it to read the thinking again; **Copy the thinking**
takes it away. A finger on the thinking, or on the conversation, holds it where
you put it while words keep arriving; it follows again once you are back at the
end. While nothing has arrived yet, the ember keeps glowing.

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

**Start a plot essential** (or just saying "build it") or **Start a worldbook** — whichever you are making — starts
it: talk the world through first — nothing is written until you ask — and it is built from everything
you said. If nothing has been said yet, you are asked what you need first. A worldbook made this way is named after
its world, and so is the world. **Build from a story card**
(or `*card` followed by the paste) takes a community story from Isekai Zero, AI Dungeon or the like — its
premise, plot, characters and opening — and builds a plot essential ready to play, in a world of its own, with
whatever makes it more immersive added. On a plot essential, **Make a worldbook from it** has the worldbook keeper
write its world as SillyTavern World Info — blue always on, green on keywords and vectors, chain on vectors
only — and **Export for SillyTavern** on the worldbook hands it over. **Import** takes a plot essential,
continuation file or worldbook you already have — paste it or pick the file —
and tidies it on the way in.

**Every document carries its jobs by name:** *Tidy it up* (untangle and
declutter), *Make it shorter*, *Check it*. A worldbook also has *Export for
SillyTavern*, which saves it in SillyTavern's World Info format — import it
there under World Info. Each job shows in the conversation in plain words, the
same as if you had typed it.

A document has **Copy all** and **Export** (the file lands in your downloads) at its top, **Duplicate**, and — after you
have edited it by hand — **Put back my edits**. **Side by side** shows two to four
documents next to each other. Under the cog, **Save everything to a file** keeps
every world in one file (not your connections or keys, and not the What was sent
records, which stay on the phone that made them), and **Bring everything back
from a file** only ever adds: nothing already here is replaced.

A connection's thinking level is said the way that provider understands it —
the same words Cozy Tavern sends, checked against it. A level you have not set is
not sent. If a provider refuses a thinking setting, the house learns what it takes
and remembers it for that model.

While a reply is being made, the send button becomes **Stop** and looks like it. A
turn that failed and changed nothing offers **Try again**. If the server on the
phone stops answering, a note says so and your work keeps trying to save until
it lands — keep the page open.

## The note at the end

Under their instructions, in The house, **The note at the end** takes anything you
like — a reminder, a rule, a mood — and sends it after your message on every turn,
so it is the last thing the one you talk to reads before answering: SillyTavern's
post-history instructions, Cozy Tavern's note at the end. `{{user}}` and `{{char}}`
read as the two names. **Send the note at the end** keeps the words and stops
sending them; **Sent after your message as** chooses a system message (the
default) or a user message at the end of yours. A model that takes no system
message after yours is remembered, and sent it at the end of yours instead.

## Searching the internet

Under the cog, **Search the internet** is off until you turn it on. Off, nothing is
ever looked up, and everything works exactly as it always has. On, anything real
they are not sure of — a canon detail of an existing story, a real person, place
or date — is looked up on the internet first, instead of guessed: when your
message turns on such a thing, it is looked up before anyone answers, and a
worker that needs a fact while it works asks for it and gets it.

The searching is done by **your Hermes Agent** — the same one Cozy Chat uses, whose
own web tools do the looking. Add it as a connection (address
`http://127.0.0.1:8642/v1`, model `hermes-agent`, its key from `API_SERVER_KEY`
in `~/.hermes/.env`); it is picked on its own, or choose it under **Who searches
the internet**. If Hermes is given a new key, the old copy here is refused once,
and the house takes the new one from Hermes itself and carries on.

## The look

Six coats of paint under the cog. **The tavern at night** puts a drawn scene
behind the room — purple sky, two moons, an aurora, lanterns strung across a
yard, a bard mid-song and somebody buying a round. It is one hand-drawn file,
nothing is fetched from anywhere, and the words stay at 17.0:1 contrast over
it, measured rather than assumed.

**Lamplight** is a warm room above a neon city after rain: the city's purple
light at the edges of the room, the replies on soft plum pages, your own words in
the lamp's warmth, and along the bottom a skyline with lit windows, a neon sign or
two, a plant and a mug on the windowsill. It is made for long nights: no pure
black and no pure white (the words read at about 15:1, the hints above 4.5:1,
measured), no glare, and nothing moves. **Neon** is the brighter, sharper purple.

**Smooth streaming** (on unless you turn it off) evens out how a reply arrives. A
provider sends words in clumps; with it on, each clump flows in over the next
moment instead of landing all at once, and the words keep pace with the model —
never more than a moment behind it. Off, each piece shows the moment it arrives.

## How it works

The one you talk to reads, every time you speak: your instructions for them,
your whole engine (`engine/generalist.md`, word for word), how this room works,
and every document in the world, whole. They answer you, and when you ask for a
change they make it themselves, inside their reply — part of a document by
quoting it exactly, or a whole document written out plainly. You see their
words; the changes appear as cards underneath, each with **put it back**.

After every reply the house puts the changes in and runs its checks. If
something needs them — a change whose quote did not match, something the checks
found that this reply brought in, a helper's report — the house tells them, with
the documents as they now stand, and they carry on in the same reply. Problems
that were already in a document before this turn are never raised again, so a
small change never sets off a rewrite of everything around it.

**The second pass.** Before a turn that changed a plot essential or a continuation
file ends, the eye reads back exactly what changed — the whole document for
context, judging only the changes and what they touch — against your engine. It
changes nothing itself: anything it raises goes to the one you talk to, which puts
it right — or says why the eye is mistaken — before it answers. Under the reply,
one line says how the read-back went ("nothing wrong", or that it raised
something, with its notes folded), and the engine's own EXPERT EYE check is folded
beside it. The message itself stays a short summary of what changed. A document
you asked to be emptied is not read back.

**One copy of your documents.** What the one you talk to reads holds your documents
once: as they stand now, labelled by name. When a step changes them, the new copy
rides at the end of the house's note and is the only one it reads or quotes from;
its own earlier steps keep only its words and its small blocks of changes, never a
document it wrote out whole.

Their helpers, each called by name, each reporting back to them:

| | |
|---|---|
| **the eye** | reads the documents back with fresh eyes against your engine, and puts right what slipped past |
| **the worldbook keeper** | builds and keeps a SillyTavern worldbook, every field chosen per entry |
| **the memory auditor** | audits and repairs a Summaryception transplant, markers intact |
| **the instructions writer** | writes and keeps AI instruction sets and presets |

The last three work from the Plot Essential and Instructions Maker's own crafts
(its Worldbook Maker and Summaryception Auditor, word for word) and your own for
instructions; each can be changed from its document, with the original one tap
away. The cog, under the floor, shows exactly who reads what.

## What was sent, and what it cost

Tap a reply and choose **What was sent**: every request that reply cost — each
step of the one you talk to, each helper, each search — exactly as it went. **In
parts** shows each piece with how many tokens it is (your instructions and the
greeting, your engine, how this room works, then each message); **Raw** shows the
settings and every message word for word, with Copy. The line at the top adds it
up: the service's own count when it sends one (with what it read from cache),
otherwise an estimate, and it says which. The newest 40 replies of each world are
kept on the device, in `~/.cozymaker/sent`, never with your key.

**The context line**, just above the box you type in, says how much the one you
talk to reads with your next message in this conversation — "Context ~38,412
tokens" — built by the same code that builds the real request, your draft
included, so it grows as you type. When the service counted the last reply itself,
that number is beside it ("last reply 41,230 counted"). Tap it for what was sent.

On a typical turn the one you talk to reads about 31,000 tokens of engine, about
3,000 of the room and your instructions, your documents whole (a plot essential is
usually 6,000–10,000), and the conversation.

## Starting your own persona

Their instructions and the note at the end each have **Return to default**, which
puts back an example to make your own from: {{char}}, a five-hundred-year-old
vampire who keeps worlds the way she kept a countess's ledgers, and a short note
that keeps her voice. A brand-new house begins with it; a house you have set up is
never touched. The note at the end goes as a system message, or as a user message
added to the end of yours — your choice, beside it.

## Connections, copied

Every connection has **Copy** beside Try it, and **Paste** beside Add another
makes a new one from it — same provider, key and settings — and opens it, so only
the model needs changing.

## For anyone working on the code

Read `AGENTS.md` first.

```
bash tests/all.sh    eleven runs, 1,265 checks
```

`docs/lineage.md` lists every version of Cozy Tavern and Cozy Chat and what
each one means for CozyMaker.
