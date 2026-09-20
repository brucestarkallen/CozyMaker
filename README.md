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

Then open **http://127.0.0.1:8090** in your browser.

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
reply, each with **put it back** if you want it gone. Tap the page icon to read
or hand-edit any document.

## The look

Four coats of paint under the cog. **The tavern at night** puts a drawn scene
behind the room — purple sky, two moons, an aurora, lanterns strung across a
yard, a bard mid-song and somebody buying a round. It is one hand-drawn file,
nothing is fetched from anywhere, and the words stay at 16.8:1 contrast over
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

The craft they work from lives in one file, `engine/generalist.md`. Each of them
is handed only the parts of it their job needs — the biggest share is a third
of the whole. The cog, under the floor, shows exactly who reads what.

## For anyone working on the code

Read `AGENTS.md` first.

```
bash tests/all.sh    229 + 29 + 64 checks
```
