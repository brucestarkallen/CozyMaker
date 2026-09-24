/* Summaryception's own transplant importer, copied verbatim from
 * brucestarkallen/Summaryception index.js at v5.122.0 (fa38d48), so CozyMaker's
 * transplant check can be held to what the importer really does. Test use only. */

export function parseTransplant(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n');
    const open = /<!--\s*SC-(TRANSPLANT|NOTEPAD|LEDGER|SNIPPET|PIN)\s*(\{[\s\S]*?\})?\s*-->/g;
    const out = { meta: null, notepad: '', ledger: {}, snippets: [], pins: [] };
    const marks = [];
    let m;
    while ((m = open.exec(t)) !== null) {
        let pay = null;
        if (m[2]) { try { pay = JSON.parse(m[2]); } catch (_) { pay = null; } }
        marks.push({ kind: m[1], pay, start: m.index, bodyAt: m.index + m[0].length });
    }
    for (let i = 0; i < marks.length; i++) {
        const mk = marks[i];
        if (mk.kind === 'TRANSPLANT') { out.meta = mk.pay || {}; continue; }
        const hardEnd = (i + 1 < marks.length) ? marks[i + 1].start : t.length;
        const closer = new RegExp('<!--\\s*/SC-' + mk.kind + '\\s*-->');
        const seg = t.slice(mk.bodyAt, hardEnd);
        const cm = closer.exec(seg);
        let body = (cm ? seg.slice(0, cm.index) : seg).trim();
        if (mk.kind === 'NOTEPAD') {
            out.notepad = body;
        } else if (mk.kind === 'LEDGER') {
            const name = mk.pay && typeof mk.pay.name === 'string' ? mk.pay.name.trim() : '';
            if (!name) continue;
            const entry = {};
            const fm = /^(CORE|STATE|ARC|THREADS):[ \t]*/;
            let cur = null;
            for (const line of body.split('\n')) {
                const f = fm.exec(line);
                if (f) { cur = f[1].toLowerCase(); entry[cur] = line.slice(f[0].length); }
                else if (cur) entry[cur] += '\n' + line;
            }
            for (const k of Object.keys(entry)) { entry[k] = entry[k].trim(); if (!entry[k]) delete entry[k]; }
            if (Object.keys(entry).length) out.ledger[name] = entry;
        } else if (mk.kind === 'SNIPPET') {
            const dm = /<!--\s*SC-DETAIL\s*-->/.exec(body);
            let text2 = body, detail;
            if (dm) { text2 = body.slice(0, dm.index).trim(); detail = body.slice(dm.index + dm[0].length).trim(); }
            if (text2) {
                const sn = { text: text2 };
                if (detail) sn.detail = detail;
                if (mk.pay && typeof mk.pay.turns === 'string') sn.turns = mk.pay.turns;
                out.snippets.push(sn);
            }
        } else if (mk.kind === 'PIN') {
            if (body) out.pins.push({ label: (mk.pay && mk.pay.label) ? String(mk.pay.label) : '', excerpt: body });
        }
    }
    return out;
}
