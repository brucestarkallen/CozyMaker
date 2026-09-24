/* CozyMaker — js/doc/transplant.js
 * The Plot Essential and Instructions Maker's lintTransplant (v0.14.1),
 * carried over — and held since v1.2.12 against Summaryception's own
 * parseTransplant (v5.122.0, vendored in tests/fixtures), which it must mirror
 * move for move: it reports what that importer would silently drop or
 * misfile, so marker integrity is checked by code, never left to a model.
 * Two moves it had missed are marked where they are: a closer carrying a
 * payload, and a dossier whose fields are all empty.
 * Every scan is linear — it runs on the phone's one thread. */

export function looksLikeTransplant(text) {
  return /<!--\s*SC-(TRANSPLANT|NOTEPAD|LEDGER|SNIPPET|PIN)\b/i.test(String(text || ''));
}

export function lintTransplant(text) {
    const t = String(text ?? '').replace(/\r\n?/g, '\n');
    const KINDS = ['TRANSPLANT', 'NOTEPAD', 'LEDGER', 'SNIPPET', 'PIN'];
    const out = { ok: true, counts: { snippets: 0, ledger: 0, pins: 0, notepad: false, meta: false }, issues: [] };
    // Newline index once; lineAt is a binary search. The old per-issue
    // t.slice(0, idx).split() was O(doc) per issue — unbounded main-thread
    // work on a vandalized paste (issues scale with damage).
    const nls = [-1];
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) nls.push(i);
    const lineAt = (idx) => {
        let lo = 0, hi = nls.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nls[mid] < idx) lo = mid; else hi = mid - 1; }
        return lo + 1;
    };
    const issue = (sev, msg, idx) => out.issues.push({ sev, msg, line: lineAt(idx) });
    // Every comment that *looks like* an SC marker, well-formed or not.
    // Detection is case-INsensitive on purpose: the importer is case-
    // sensitive, so a case-mangled marker is invisible to it — the linter
    // must see it to report it. Classification below stays exact-case.
    const any = /<!--\s*(\/?)([Ss][Cc])-([A-Za-z0-9_-]+)\s*(\{[\s\S]*?\})?\s*-->/g;
    const marks = [];
    const wellFormed = [];
    let m;
    while ((m = any.exec(t)) !== null) {
        // exact = the importer would recognize this marker's name at all
        // (literal "SC-" prefix AND exact-case kind).
        const exact = m[2] === 'SC' && (KINDS.includes(m[3]) || m[3] === 'DETAIL');
        marks.push({ closer: m[1] === '/', prefix: m[2], kind: m[3], exact, json: m[4] || '', idx: m.index, end: m.index + m[0].length });
        wellFormed.push([m.index, m.index + m[0].length]);
    }
    // Comments that mention SC- but did not parse as a marker (a payload
    // without braces, an unterminated comment, junk before a nested valid
    // marker): invisible to the importer — no block opens/closes there.
    // Linear indexOf walk. The previous /<!--[^>]*\bSC-[^>]*-->/ scan was
    // quadratic (nested unbounded classes backtrack per split): 150KB of
    // stray "<!--" froze the main thread for ~2s, scaling to minutes on a
    // large paste — a platform-freeze class on Android WebView. Never
    // reintroduce nested [^>]*…[^>]* scans here; this walk is O(n).
    let ci = 0, wi = 0;
    while ((ci = t.indexOf('<!--', ci)) !== -1) {
        const ce = t.indexOf('-->', ci + 4);
        const end = ce === -1 ? t.length : ce + 3;
        // Remainder = comment span minus any well-formed marker subspans
        // (a valid marker sharing this span's closer is still imported;
        // only the stray shell around it is dead text).
        while (wi < wellFormed.length && wellFormed[wi][1] <= ci) wi++;
        let rem = '', ppos = ci;
        for (let k = wi; k < wellFormed.length && wellFormed[k][0] < end; k++) {
            const w = wellFormed[k];
            if (w[0] > ppos) rem += t.slice(ppos, Math.min(w[0], end));
            ppos = Math.max(ppos, w[1]);
        }
        if (ppos < end) rem += t.slice(ppos, end);
        if (/\bsc-/i.test(rem)) {
            issue('error', 'Malformed SC marker — the importer will not recognize it, so no block opens/closes here: ' + t.slice(ci, end).slice(0, 60), ci);
        }
        ci = end > ci ? end : ci + 4;
    }
    for (const mk of marks) {
        if (mk.exact) {
            if (mk.kind === 'DETAIL' && !mk.closer && mk.json) issue('error', 'SC-DETAIL must carry no payload — the importer will not recognize this marker, the detail merges into the snippet text', mk.idx);
            // CozyMaker v1.2.12, from Summaryception's own parseTransplant (v5.122.0): a block
            // closes only on a bare closer, <!-- /SC-KIND -->; one carrying a payload is not a
            // closer to the importer, so the block runs on and swallows what lies between
            else if (mk.closer && mk.json && KINDS.includes(mk.kind)) issue('error', 'Closer /SC-' + mk.kind + ' carries a payload — the importer does not recognize it as a closer, so the block runs on to the next one and swallows what lies between', mk.idx);
            continue;
        }
        const up = mk.kind.toUpperCase();
        issue('error', (KINDS.includes(up) || up === 'DETAIL')
            ? 'Marker ' + mk.prefix + '-' + mk.kind + ' is case-mismatched (importer is case-sensitive, expects SC-' + up + ') — it is ignored and its data is lost or swallowed'
            : 'Unknown marker ' + mk.prefix + '-' + mk.kind + ' — the importer ignores it; the block it was meant to open/close is lost or swallowed', mk.idx);
    }
    const openers = marks.filter(k => !k.closer && k.exact && KINDS.includes(k.kind));
    const closers = marks.filter(k => k.closer && k.exact && KINDS.includes(k.kind) && !k.json);
    const usedClosers = new Set();
    const reportedClosers = new Set();
    const seenLedger = new Set();
    let seenNotepad = false;
    for (let i = 0; i < openers.length; i++) {
        const op = openers[i];
        if (op.kind === 'TRANSPLANT') {
            out.counts.meta = true;
            if (op.json) { try { JSON.parse(op.json); } catch (e) { issue('warn', 'SC-TRANSPLANT meta JSON invalid — importer drops the meta', op.idx); } }
            continue;
        }
        let pay = null, payBroken = false;
        if (op.json) { try { pay = JSON.parse(op.json); } catch (e) { payBroken = true; } }
        const hardEnd = (i + 1 < openers.length) ? openers[i + 1].idx : t.length;
        const cl = closers.find(c => c.kind === op.kind && c.idx >= op.end && c.idx < hardEnd);
        if (cl) usedClosers.add(cl);
        const bodyEnd = cl ? cl.idx : hardEnd;
        const body = t.slice(op.end, bodyEnd);
        for (const c of closers) {
            if (c !== cl && c.idx > op.end && c.idx < bodyEnd) {
                issue('warn', 'Stray closer /SC-' + c.kind + ' inside an open SC-' + op.kind + ' block — it imports as junk text inside that block', c.idx);
                reportedClosers.add(c);
            }
        }
        if (!cl) issue('warn', 'SC-' + op.kind + ' has no closing marker — its body runs on to the next block (trailing headings/prose are swallowed into it)', op.idx);
        if (op.kind === 'NOTEPAD') {
            if (seenNotepad) issue('warn', 'Multiple SC-NOTEPAD blocks — the later one silently OVERWRITES the earlier on import', op.idx);
            seenNotepad = true;
            if (body.trim()) out.counts.notepad = true;
        } else if (op.kind === 'LEDGER') {
            if (payBroken) { issue('error', 'SC-LEDGER payload JSON is broken — the importer DROPS this entire dossier', op.idx); continue; }
            const name = pay && typeof pay.name === 'string' ? pay.name.trim() : '';
            if (!name) { issue('error', 'SC-LEDGER has no "name" in its payload — the importer DROPS this entire dossier', op.idx); continue; }
            // read as the importer reads it (CozyMaker v1.2.12, Summaryception v5.122.0): the
            // block is trimmed first, each field runs on over the lines after it, and a
            // dossier whose fields all come out empty is dropped like one with none
            const fields = {};
            let cur = null;
            for (const line of body.trim().split('\n')) {
                const f = /^(CORE|STATE|ARC|THREADS):[ \t]*/.exec(line);
                if (f) { cur = f[1]; fields[cur] = line.slice(f[0].length); } else if (cur) fields[cur] += '\n' + line;
            }
            if (!Object.keys(fields).length) { issue('error', 'Ledger "' + name + '" has none of CORE:/STATE:/ARC:/THREADS: — the importer DROPS it', op.idx); continue; }
            if (!Object.values(fields).some(v => v.trim())) { issue('error', 'Ledger "' + name + '" has only empty fields — the importer DROPS it', op.idx); continue; }
            if (seenLedger.has(name)) issue('error', 'Duplicate ledger name "' + name + '" — the later dossier silently OVERWRITES the earlier on import', op.idx);
            seenLedger.add(name);
            out.counts.ledger++;
        } else if (op.kind === 'SNIPPET') {
            if (payBroken) issue('warn', 'SC-SNIPPET payload JSON is broken — the snippet imports but loses its turn range', op.idx);
            const dm = /<!--\s*SC-DETAIL\s*-->/.exec(body);
            const text2 = (dm ? body.slice(0, dm.index) : body).trim();
            if (!text2) { issue('error', 'Empty SC-SNIPPET' + (dm ? ' (detail-only — the importer drops the detail with it)' : '') + ' — the importer DROPS it', op.idx); continue; }
            out.counts.snippets++;
        } else if (op.kind === 'PIN') {
            if (payBroken) issue('warn', 'SC-PIN payload JSON is broken — the pin imports but loses its label', op.idx);
            if (!body.trim()) { issue('error', 'Empty SC-PIN — the importer DROPS it', op.idx); continue; }
            out.counts.pins++;
        }
    }
    for (const c of closers) {
        if (!usedClosers.has(c) && !reportedClosers.has(c)) issue('warn', 'Closer /SC-' + c.kind + ' with no matching open block — dead marker', c.idx);
    }
    for (const mk of marks) {
        if (mk.kind !== 'DETAIL' || !mk.exact || mk.closer || mk.json) continue;
        let inside = false;
        for (let i = 0; i < openers.length; i++) {
            const op = openers[i];
            if (op.kind !== 'SNIPPET') continue;
            const hardEnd = (i + 1 < openers.length) ? openers[i + 1].idx : t.length;
            if (mk.idx >= op.end && mk.idx < hardEnd) { inside = true; break; }
        }
        if (!inside) issue('warn', 'SC-DETAIL marker outside any snippet — dead marker, its text is not the detail of anything', mk.idx);
    }
    out.ok = !out.issues.some(x => x.sev === 'error');
    return out;
}

