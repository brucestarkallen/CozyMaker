/* CozyMaker — js/doc/worldbook.js
 * The Plot Essential and Instructions Maker's worldbook engine (v0.14.2),
 * carried over unchanged: its tolerant reading of any worldbook — its own
 * list, {entries:[…]}, or SillyTavern's numbered map, with SillyTavern's own
 * fields read for what they mean (constant is always-on, key is keys, a
 * numeric position is a place) — and its export to SillyTavern's World Info.
 * tests/fixtures/worldbook-export.json holds its answers; this copy must give
 * the same ones. */

import { stripTrailingCommasOutsideStrings } from './edits.js';

export function numOr(v, d) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : d;
    if (typeof v === 'string') {
        const t = v.trim();
        if (!t) return d;
        const n = Number(t);
        return Number.isFinite(n) ? n : d;
    }
    return d;
}

export function normalizePosition(p) {
    if (typeof p === 'number') {
        if (p === 0) return 'before_char';
        if (p === 4) return 'at_depth';
        return 'after_char';
    }
    const v = String(p || '').toLowerCase().replace(/^@/, '').replace(/[\s-]+/g, '_');
    if (v === 'before_char' || v === 'before' || v === 'before_char_defs' || v === 'wibefore') return 'before_char';
    if (v === 'at_depth' || v === 'depth' || v === 'atdepth' || v === 'in_chat') return 'at_depth';
    if (v === 'after_char' || v === 'after' || v === 'after_char_defs' || v === 'wiafter' || v === '') return 'after_char';
    return 'after_char';
}

export function positionToST(pos) {
    if (pos === 'before_char') return 0;
    if (pos === 'at_depth') return 4;
    return 1; // after_char
}

export function parseWorldbook(text) {
    const raw = String(text || '').trim();
    if (!raw) return { entries: [] };
    let data;
    try { data = JSON.parse(raw); }
    catch (e) {
        try { data = JSON.parse(stripTrailingCommasOutsideStrings(raw)); }
        catch (e2) { return { entries: [], error: 'not valid JSON: ' + e2.message }; }
    }
    let arr = null;
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.entries)) arr = data.entries;
    else if (data && data.entries && typeof data.entries === 'object') arr = Object.values(data.entries); // ST format: entries keyed by index
    if (!arr) return { entries: [], error: 'expected a JSON array of entries' };
    const entries = [];
    for (const e of arr) {
        if (!e || typeof e !== 'object') continue;
        const name = String(e.name ?? e.comment ?? '').trim();
        let keys = [];
        if (Array.isArray(e.keys)) keys = e.keys.map(k => String(k).trim()).filter(Boolean);
        else if (typeof e.keys === 'string') keys = e.keys.split(',').map(k => k.trim()).filter(Boolean);
        else if (Array.isArray(e.key)) keys = e.key.map(k => String(k).trim()).filter(Boolean);
        let strat = String(e.strategy || '').toLowerCase();
        if (!['blue', 'green', 'chain'].includes(strat)) {
            // infer: constant->blue, explicit vectorized->chain, else green
            if (e.constant === true) strat = 'blue';
            else if (e.vectorized === true && (!keys.length)) strat = 'chain';
            else strat = 'green';
        }
        entries.push({
            name: name || '(unnamed)',
            keys,
            content: String(e.content ?? '').trim(),
            strategy: strat,
            order: numOr(e.order, 100),
            position: normalizePosition(e.position),
            depth: Math.max(0, Math.round(numOr(e.depth, 4))),
            probability: Math.max(0, Math.min(100, numOr(e.probability, 100))),
            comment: String(e.comment ?? '').trim(),
        });
    }
    return { entries };
}

export function worldbookToST(entries) {
    const out = { entries: {} };
    entries.forEach((e, i) => {
        const blue = e.strategy === 'blue';
        const chain = e.strategy === 'chain';
        const keys = (blue || chain) ? [] : e.keys.slice();
        const pos = positionToST(e.position);
        const prob = Number.isFinite(e.probability) ? e.probability : 100;
        out.entries[String(i)] = {
            uid: i,
            key: keys,
            keysecondary: [],
            comment: e.name || '',
            content: e.content || '',
            constant: blue,                       // blue = always on
            vectorized: chain || (!blue),         // green + chain are vector-eligible; blue is not
            selective: !blue && keys.length > 0,  // keyword-selective when it has keys
            selectiveLogic: 0,
            addMemo: true,
            order: Number.isFinite(e.order) ? e.order : 100,
            position: pos,                         // 0 before-char, 1 after-char, 4 at-depth
            disable: false,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: false,
            probability: prob,
            useProbability: prob !== 100,
            depth: pos === 4 ? (Number.isFinite(e.depth) ? e.depth : 4) : 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: null,
            sticky: 0,
            cooldown: 0,
            delay: 0,
            displayIndex: i,
        };
    });
    return out;
}
