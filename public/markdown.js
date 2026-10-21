// Small, dependency-free Markdown renderer for AI replies.
// Everything is HTML-escaped first, so model output can never inject markup.

const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const KEYWORDS = new Set(("abstract and as async await break case catch class const continue def default del delete do elif else enum " +
    "except export extends false final finally fn for from func function go if impl import in instanceof interface is " +
    "lambda let match mod mut new nil none not null or package pass private protected pub public raise return self " +
    "static struct super switch this throw throws true try type typeof undefined var void while with yield " +
    "select insert update where join into values create table drop alter int float double char bool boolean string " +
    "echo print println printf include using namespace std").split(" "));

// Lightweight syntax highlighting: comments, strings, numbers and common keywords.
export function highlight(code, lang = "") {
    const hashComments = /^(py|python|rb|ruby|sh|bash|shell|zsh|yaml|yml|r|perl|toml|dockerfile|makefile)$/i.test(lang);
    const sqlComments = /^(sql|lua|haskell)$/i.test(lang);
    const isMarkup = /^(html|xml|svg|vue)$/i.test(lang);
    if (isMarkup) {
        return escapeHtml(code)
            .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tk-k">$2</span>')
            .replace(/([\w-]+)=(&quot;.*?&quot;)/g, '<span class="tk-a">$1</span>=<span class="tk-s">$2</span>');
    }

    const parts = [
        "(\\/\\*[\\s\\S]*?\\*\\/)",
        hashComments ? "(#[^\\n]*)" : sqlComments ? "(--[^\\n]*)" : "(\\/\\/[^\\n]*)",
        "(\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|`(?:\\\\.|[^`\\\\])*`)",
        "(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)",
        "([A-Za-z_$][\\w$]*)"
    ];
    const re = new RegExp(parts.join("|"), "g");
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
        out += escapeHtml(code.slice(last, m.index));
        const [tok, block, line, str, num, word] = m;
        if (block || line) out += `<span class="tk-c">${escapeHtml(tok)}</span>`;
        else if (str) out += `<span class="tk-s">${escapeHtml(tok)}</span>`;
        else if (num) out += `<span class="tk-n">${tok}</span>`;
        else if (word && KEYWORDS.has(word.toLowerCase())) out += `<span class="tk-k">${tok}</span>`;
        else if (word && code[re.lastIndex] === "(") out += `<span class="tk-f">${tok}</span>`;
        else out += escapeHtml(tok);
        last = re.lastIndex;
    }
    return out + escapeHtml(code.slice(last));
}

function safeUrl(url) {
    return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

function inline(text) {
    const codes = [];
    let s = text.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = escapeHtml(s);
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
        const href = safeUrl(url.replace(/&amp;/g, "&"));
        return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : all;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[i])}</code>`);
}

function codeBlock(code, lang) {
    const label = escapeHtml(lang || "code");
    return `<div class="code-block"><div class="code-head"><span>${label}</span>` +
        `<button type="button" class="code-copy" aria-label="Copy code"><svg class="ic"><use href="#i-copy"/></svg><span>Copy</span></button></div>` +
        `<pre><code>${highlight(code, lang)}</code></pre></div>`;
}

function table(lines) {
    const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
    const head = cells(lines[0]);
    const aligns = cells(lines[1]).map(c => c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "");
    const th = head.map((c, i) => `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${inline(c)}</th>`).join("");
    const rows = lines.slice(2).map(l => "<tr>" + cells(l).map((c, i) => `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${inline(c)}</td>`).join("") + "</tr>").join("");
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function list(lines, start) {
    // Builds nested lists from indentation.
    const items = [];
    const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    for (const l of lines) {
        const m = l.match(re);
        if (m) items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), num: parseInt(m[2], 10), text: m[3] });
        else if (items.length) items[items.length - 1].text += " " + l.trim();
    }
    let i = 0;
    function build(level) {
        const first = items[i];
        const tag = first.ordered ? "ol" : "ul";
        let html = `<${tag}${first.ordered && first.num !== 1 ? ` start="${first.num}"` : ""}>`;
        while (i < items.length && items[i].indent >= level) {
            if (items[i].indent > level) { html = html.replace(/<\/li>$/, "") + build(items[i].indent) + "</li>"; continue; }
            let text = items[i].text;
            const task = text.match(/^\[([ xX])\]\s+(.*)$/);
            text = task ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ${inline(task[2])}` : inline(text);
            html += `<li>${text}</li>`;
            i++;
        }
        return html + `</${tag}>`;
    }
    let out = "";
    while (i < items.length) out += build(items[i].indent);
    return out;
}

export function renderMarkdown(src) {
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
    const isTableSep = l => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes("-");

    while (i < lines.length) {
        const line = lines[i];

        const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
        if (fence) {
            const code = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
            i++;
            out.push(codeBlock(code.join("\n"), fence[2]));
            continue;
        }
        if (!line.trim()) { i++; continue; }

        const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (h) { const n = Math.min(h[1].length + 1, 6); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

        if (/^\s*>/.test(line)) {
            const quote = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
            out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
            continue;
        }

        if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
            const rows = [];
            while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(lines[i++]);
            out.push(table(rows));
            continue;
        }

        if (isList(line)) {
            const block = [];
            while (i < lines.length && (isList(lines[i]) || (lines[i].trim() && /^\s{2,}/.test(lines[i])) ||
                (!lines[i].trim() && i + 1 < lines.length && isList(lines[i + 1])))) {
                if (lines[i].trim()) block.push(lines[i]);
                i++;
            }
            out.push(list(block));
            continue;
        }

        const para = [];
        while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !isList(lines[i]) &&
            !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
        out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    }
    return out.join("");
}
