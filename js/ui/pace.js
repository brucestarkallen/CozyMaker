/* CozyMaker — js/ui/pace.js
 *
 * SMOOTH STREAMING: HOW MUCH OF WHAT HAS ARRIVED IS SHOWN THIS FRAME.
 *
 * A provider does not send words evenly. They come in clumps — a dozen
 * pieces in one network packet, then nothing for a tenth of a second — and
 * drawn as they come, the reply lurches: a line appears at once, the screen
 * stands still, another line appears. SillyTavern's Smooth Streaming answers
 * that with a typewriter at a fixed speed, which falls behind a fast model and
 * keeps typing after the model has finished.
 *
 * Here the pace follows the model instead. Whatever has arrived and is not on
 * screen yet (the backlog) is drawn a share at a time: each frame shows the
 * part of it that would empty it within PACE_MS if nothing more came. A clump
 * is spread over the next moment, so the words flow; a fast model is followed
 * just as fast, because a bigger backlog is drawn faster; and the words on
 * screen are never more than about PACE_MS behind the words that arrived.
 * Pure: no DOM, no clock of its own — the caller says how long the frame was. */

export const PACE_MS = 150;

/* How many characters to show this frame, out of `backlog` waiting, for a frame
 * that lasted `frameMs`. Never more than is waiting, never less than one while
 * anything is: the stream always ends. A long frame (the page was busy, or
 * hidden) shows more, so a stall is caught up rather than stretched. */
export function revealCount(backlog, frameMs, paceMs = PACE_MS) {
  const waiting = Math.max(0, Math.floor(Number(backlog) || 0));
  if (!waiting) return 0;
  const dt = Math.min(Math.max(Number(frameMs) || 16, 1), 1000);
  return Math.min(waiting, Math.max(1, Math.ceil((waiting * dt) / Math.max(1, paceMs))));
}

/* The first `n` characters of `text`, never splitting a character that takes
 * two code units (an emoji, a rare letter): half of one drawn alone shows as a
 * broken box until its other half arrives. */
export function takeChars(text, n) {
  const s = String(text || '');
  let k = Math.max(0, Math.min(s.length, Math.floor(Number(n) || 0)));
  if (k > 0 && k < s.length) {
    const c = s.charCodeAt(k - 1);
    if (c >= 0xd800 && c <= 0xdbff) k += 1;
  }
  return s.slice(0, k);
}
