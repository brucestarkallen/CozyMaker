/* CozyMaker — js/doc/branch.js
 *
 * THE DOCUMENTS AS THEY STOOD AT A MOMENT. Every change made since — the
 * crew's, from every conversation in the world, and his own hand edits — put
 * back newest first, on a COPY of the documents, never on the world itself.
 * Branch here builds on it: a world of its own, split off at a message, with
 * its own documents as they stood then; the original is left exactly as it
 * is. Rolling an update back is branching from the message before it.
 *
 * Each step goes through the same undo every other put-back in the room uses
 * (edits.js undoBatch), so a change that cannot be put back — the words it
 * wrote have been changed since — stops the roll-back and says why, and the
 * caller keeps the documents as they stand rather than half of them rolled. */

import { undoBatch } from './edits.js';

export function rollBackTo(world, cutoff) {
  let docs = (world.docs || []).map((d) => ({ ...d }));
  const steps = [];
  for (const c of world.chats || []) {
    for (const t of c.turns || []) {
      if (!t || (t.at || 0) <= cutoff) continue;
      /* a turn's changes, last first; the sort below is stable, so they stay so */
      const live = (t.batches || []).filter((b) => !b.undone);
      for (const b of live.slice().reverse()) steps.push({ at: t.at || 0, batch: b });
    }
  }
  for (const u of world.undo || []) if (u && (u.at || 0) > cutoff) steps.push({ at: u.at || 0, hand: u });
  steps.sort((a, b) => b.at - a.at);
  for (const s of steps) {
    if (s.batch) {
      if (s.batch.tooOld) return { ok: false, why: 'some of the changes since are too old to put back' };
      const out = undoBatch(docs.map((d) => ({ name: d.name, text: d.text })), s.batch);
      if (!out.ok) return { ok: false, why: out.why };
      for (const ch of out.changes) {
        if (ch.remove) docs = docs.filter((d) => d.name !== ch.name);
        else if (ch.add) docs = [...docs, { id: '', name: ch.name, kind: ch.kind || 'pe', text: ch.text || '' }];
        else docs = docs.map((d) => (d.name === ch.name ? { ...d, text: ch.text } : d));
      }
    } else {
      const d = docs.find((x) => x.id === s.hand.docId);
      if (!d) continue;
      if (d.text !== s.hand.after) return { ok: false, why: `${s.hand.name} was changed by hand since, in a way that cannot be put back` };
      d.text = s.hand.before;
    }
  }
  return { ok: true, docs };
}
