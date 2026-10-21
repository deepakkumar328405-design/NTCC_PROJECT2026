import { renderMarkdown } from "./markdown.js";

const $ = id => document.getElementById(id);
const root = document.documentElement;
const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isMobile = () => matchMedia("(max-width: 860px)").matches;

/* ---------------------------------------------------------------- storage */
const store = {
    get(key, fallback) {
        try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast("Browser storage is full or unavailable.", "error"); }
    },
    raw(key, value) {
        try { if (value === undefined) return localStorage.getItem(key); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { return null; }
    }
};

/* ------------------------------------------------------------- workspaces */
const WORKSPACES = {
    general: {
        name: "AI Assistant", icon: "general", placeholder: "Message Smart AI…",
        title: "What can I help you with <span>today?</span>",
        subtitle: "Ask questions, write something, study a topic or brainstorm ideas. Smart AI keeps the context of each chat.",
        suggestions: [
            { icon: "bulb", title: "Learn something", desc: "Explain a topic simply", prompt: "Explain how artificial intelligence works in simple words, with an everyday example.", send: true },
            { icon: "creative", title: "Writing & Ideas", desc: "Help me write something", prompt: "Help me write " },
            { icon: "study", title: "Study assistant", desc: "Help me prepare for an exam", prompt: "Help me prepare for my exam on " },
            { icon: "general", title: "Brainstorm", desc: "Generate creative ideas", prompt: "Brainstorm 10 creative ideas for " }
        ]
    },
    creative: {
        name: "Writing & Ideas", icon: "creative", placeholder: "What would you like to write?",
        title: "Write, rewrite and <span>brainstorm.</span>",
        subtitle: "Draft emails, stories, posts and more, or paste your own text to polish its clarity and tone.",
        suggestions: [
            { icon: "mail", title: "Draft an email", desc: "Clear, polite and professional", prompt: "Write a polite, professional email to " },
            { icon: "list", title: "Outline a blog post", desc: "Structure before you write", prompt: "Create a detailed blog post outline about " },
            { icon: "creative", title: "Start a short story", desc: "An opening to build on", prompt: "Write the opening paragraph of a short mystery story set in a rainy city.", send: true },
            { icon: "wand", title: "Polish my text", desc: "Improve clarity and tone", prompt: "Improve the clarity and tone of this text, then briefly explain the main changes:\n\n" }
        ],
        chipsLabel: "Quick formats",
        chips: ["Poem", "Instagram caption", "Speech", "Cover letter", "Product description"].map(c => ({ label: c, prompt: `Write a ${c.toLowerCase()} about ` }))
    },
    study: {
        name: "Study Helper", icon: "study", placeholder: "What are you studying?",
        title: "Learn anything, <span>step by step.</span>",
        subtitle: "Get concepts explained like a patient tutor, plan your revision and test yourself before the exam.",
        suggestions: [
            { icon: "bulb", title: "Explain a concept", desc: "Step by step, with examples", prompt: "Explain this concept step by step with a simple example: " },
            { icon: "calendar", title: "Make a study plan", desc: "Turn an exam into daily steps", prompt: "Create a 7-day study plan for my exam on " },
            { icon: "quiz", title: "Quiz me", desc: "Practice one question at a time", prompt: "Quiz me with 5 questions, one at a time, and wait for my answer each time. Topic: " },
            { icon: "list", title: "Summarise my notes", desc: "Key points and a revision list", prompt: "Summarise these notes into key points and a short revision checklist:\n\n" }
        ],
        chipsLabel: "Subjects",
        chips: ["Mathematics", "Physics", "Chemistry", "Biology", "Computer Science", "History", "Economics"].map(s => ({ label: s, prompt: `I'm studying ${s}. Help me understand: ` }))
    },
    fitness: {
        name: "Fitness Coach", icon: "fitness", placeholder: "Ask about workouts, routines or habits…",
        title: "Your personal <span>fitness coach.</span>",
        subtitle: "General guidance on workouts, stretching and healthy habits, tailored to the preferences you choose to share.",
        suggestions: [
            { icon: "fitness", title: "Beginner routine", desc: "Safe full-body, 3 days a week", prompt: "Give me a safe beginner full-body fitness routine for three days a week.", send: true },
            { icon: "calendar", title: "Weekly plan", desc: "Based on my preferences", prompt: "Create a balanced weekly workout plan based on my preferences.", send: true },
            { icon: "stretch", title: "Daily stretching", desc: "10 minutes for mobility", prompt: "Suggest a 10-minute daily stretching routine for flexibility and posture.", send: true },
            { icon: "leaf", title: "Healthy meals", desc: "Simple ideas for my goal", prompt: "Suggest simple, healthy meal ideas that support my fitness goal.", send: true }
        ]
    },
    image: { name: "Image Studio", icon: "image" }
};
const CHAT_MODES = ["general", "creative", "study", "fitness"];

/* ------------------------------------------------------------------ state */
let chats = loadChats();
let activeId = null;
let mode = "general";
let busy = false;
const pending = new Set();
let profile = store.get("smartProfile", {}) || {};

function loadChats() {
    let list = store.get("smartChats", null);
    if (!Array.isArray(list)) {
        list = [];
        // Migrate the single conversation saved by the previous version.
        const old = store.get("smartHistory", []);
        if (Array.isArray(old) && old.length) {
            const first = old.find(m => m.role === "user");
            list.push({ id: uid(), mode: "general", title: makeTitle(first?.content || "Previous chat"), updated: Date.now(),
                messages: old.filter(m => m && typeof m.content === "string").map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })) });
        }
        store.set("smartChats", list);
        store.raw("smartHistory", null);
    }
    return list.filter(c => c && Array.isArray(c.messages));
}
const saveChats = () => store.set("smartChats", chats);
const currentChat = () => chats.find(c => c.id === activeId) || null;
function makeTitle(text) {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 52 ? t.slice(0, 50).trimEnd() + "…" : t || "New chat";
}

/* --------------------------------------------------------------- elements */
const messagesEl = $("messages"), welcomeEl = $("welcome"), scroller = $("scroller"), input = $("message"), sendBtn = $("send");

/* ---------------------------------------------------------------- toasts */
function toast(text, type = "success") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = icon(type === "error" ? "alert" : "check") + `<span>${esc(text)}</span>`;
    $("toasts").append(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 220); }, 2400);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = Object.assign(document.createElement("textarea"), { value: text });
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.append(ta); ta.select();
        const ok = document.execCommand("copy"); ta.remove();
        if (!ok) { toast("Could not copy to clipboard.", "error"); return false; }
    }
    return true;
}

function flashCopied(btn) {
    const label = btn.querySelector("span");
    const use = btn.querySelector("use");
    const prev = label?.textContent;
    if (label) label.textContent = "Copied";
    use?.setAttribute("href", "#i-check");
    setTimeout(() => { if (label) label.textContent = prev; use?.setAttribute("href", "#i-copy"); }, 1500);
}

/* ---------------------------------------------------------------- confirm */
function confirmDialog(title, text, okLabel = "Delete") {
    const dlg = $("confirmDialog");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmYes").textContent = okLabel;
    dlg.showModal();
    $("confirmNo").focus();
    return new Promise(resolve => {
        const done = value => { dlg.close(); cleanup(); resolve(value); };
        const yes = () => done(true), no = () => done(false), cancel = e => { e.preventDefault(); done(false); };
        function cleanup() {
            $("confirmYes").removeEventListener("click", yes);
            $("confirmNo").removeEventListener("click", no);
            dlg.removeEventListener("cancel", cancel);
        }
        $("confirmYes").addEventListener("click", yes);
        $("confirmNo").addEventListener("click", no);
        dlg.addEventListener("cancel", cancel);
    });
}

/* ----------------------------------------------------------------- status */
let health = "connecting";
function setStatus(state, text) {
    $("status").dataset.state = state;
    $("statusText").textContent = text;
    $("status").title = text;
}
function showHealth() {
    if (busy) return setStatus("busy", "Thinking…");
    if (health === "ready") setStatus("ready", "Ready");
    else if (health === "unconfigured") setStatus("warn", "API key missing");
    else if (health === "offline") setStatus("error", "Offline");
    else setStatus("", "Connecting…");
}
async function checkHealth() {
    try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const d = await r.json();
        health = d.configured ? "ready" : "unconfigured";
    } catch {
        health = "offline";
    }
    showHealth();
}

/* -------------------------------------------------------------- rendering */
function renderNav() {
    $("workspaceNav").innerHTML = Object.entries(WORKSPACES).map(([key, ws]) => `
        <li><button class="nav-item" data-mode="${key}" data-tip-collapsed="${ws.name}" ${key === mode ? 'aria-current="page"' : ""}>
            ${icon(ws.icon)}<span class="sb-label">${ws.name}</span></button></li>`).join("");
}

function renderRecents() {
    const list = [...chats].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 40);
    $("recentEmpty").hidden = list.length > 0;
    $("recentList").innerHTML = list.map(c => `
        <li class="recent-item${c.id === activeId ? " active" : ""}">
            <button class="recent-open" data-chat="${c.id}" title="${esc(c.title)}" ${c.id === activeId ? 'aria-current="true"' : ""}>
                ${icon(WORKSPACES[c.mode]?.icon || "chat")}<span>${esc(c.title)}</span></button>
            <button class="icon-btn recent-del" data-del="${c.id}" aria-label="Delete “${esc(c.title)}”" data-tip="Delete">${icon("trash")}</button>
        </li>`).join("");
}

function renderHeader() {
    const chat = currentChat();
    $("crumbWs").textContent = WORKSPACES[mode].name;
    const hasTitle = Boolean(chat);
    $("crumbSep").hidden = $("crumbTitle").hidden = !hasTitle;
    $("crumbTitle").textContent = chat ? chat.title : "";
    document.querySelector(".crumbs").classList.toggle("has-title", hasTitle);
    $("moreBtn").hidden = mode === "image";
    $("copyChat").disabled = $("clearChat").disabled = !chat || !chat.messages.length;
    document.title = chat ? `${chat.title} · Smart AI` : `${WORKSPACES[mode].name} · Smart AI`;
}

function renderWelcome() {
    const ws = WORKSPACES[mode];
    let extra = "";
    if (ws.chips) {
        extra = `<div class="welcome-extra"><span class="field-label">${ws.chipsLabel}</span><div class="chips">${
            ws.chips.map((c, i) => `<button type="button" class="chip" data-chip="${i}">${esc(c.label)}</button>`).join("")}</div></div>`;
    }
    if (mode === "fitness") {
        const labels = { age: "Age", goal: "Goal", activity: "Activity", equipment: "Equipment", diet: "Food" };
        const tags = Object.entries(labels).filter(([k]) => profile[k]).map(([k, l]) => `<span class="tag">${l}: ${esc(profile[k])}</span>`).join("");
        extra = `<div class="profile-card"><div><b>${tags ? "Your preferences" : "No preferences saved"}</b>
            ${tags ? `<div class="profile-tags">${tags}</div>` : `<p class="muted small" style="margin:2px 0 0">Optionally add your goal and activity level for more relevant suggestions.</p>`}</div>
            <button type="button" class="btn btn-secondary" data-action="profile">${tags ? "Edit" : "Add preferences"}</button></div>
            <div class="note">${icon("alert")}<span>Fitness guidance is general education, not medical advice. Consult a professional for injuries or health conditions.</span></div>`;
    }
    welcomeEl.innerHTML = `
        <div class="welcome-mark">${icon(mode === "general" ? "logo" : ws.icon)}</div>
        <h1>${ws.title}</h1>
        <p>${ws.subtitle}</p>
        <div class="suggestions">${ws.suggestions.map((s, i) => `
            <button type="button" class="suggestion" data-suggest="${i}">
                <span class="s-icon">${icon(s.icon)}</span><span><b>${s.title}</b><small>${s.desc}</small></span>
            </button>`).join("")}</div>${extra}`;
}

function messageEl(m, index) {
    const el = document.createElement("div");
    const time = m.ts ? `<time datetime="${new Date(m.ts).toISOString()}">${new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>` : "";
    const copy = `<button type="button" class="meta-btn" data-copy="${index}" aria-label="Copy message">${icon("copy")}<span>Copy</span></button>`;
    if (m.role === "user") {
        el.className = "msg msg-user";
        el.innerHTML = `<div class="msg-body"><div class="bubble"></div><div class="msg-meta">${time}${copy}</div></div>`;
        el.querySelector(".bubble").textContent = m.content;
    } else {
        el.className = "msg msg-ai";
        el.innerHTML = `<div class="ai-avatar">${icon("logo")}</div><div class="msg-body"><div class="prose">${renderMarkdown(m.content)}</div><div class="msg-meta">${time}${copy}</div></div>`;
    }
    return el;
}

function loadingEl() {
    const el = document.createElement("div");
    el.className = "msg msg-ai";
    el.id = "loadingMsg";
    el.innerHTML = `<div class="ai-avatar">${icon("logo")}</div><div class="msg-body" aria-label="Smart AI is thinking">
        <div class="typing"><span></span><span></span><span></span></div><div class="skeleton"><i></i><i></i><i></i></div></div>`;
    return el;
}

function errorEl(text) {
    const el = document.createElement("div");
    el.className = "msg msg-ai";
    el.id = "errorMsg";
    el.innerHTML = `<div class="ai-avatar">${icon("logo")}</div><div class="msg-body"><div class="error-box" role="alert">${icon("alert")}
        <div><div>${esc(text)}</div><button type="button" class="btn btn-secondary" data-action="retry">${icon("retry")}<span>Retry</span></button></div></div></div>`;
    return el;
}

function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
}

function renderThread() {
    const chat = currentChat();
    const msgs = chat ? chat.messages : [];
    messagesEl.innerHTML = "";
    welcomeEl.hidden = msgs.length > 0 || (chat && pending.has(chat.id));
    if (welcomeEl.hidden) welcomeEl.innerHTML = ""; else renderWelcome();
    msgs.forEach((m, i) => messagesEl.append(messageEl(m, i)));
    if (chat && pending.has(chat.id)) messagesEl.append(loadingEl());
    else if (chat && msgs.at(-1)?.role === "user") messagesEl.append(errorEl(chat.error || "This message didn't receive a response."));
    scrollToBottom(false);
}

function renderComposer() {
    const ws = WORKSPACES[mode];
    input.placeholder = ws.placeholder || "Message Smart AI…";
    $("composerMode").innerHTML = `${icon(ws.icon)}<span>${ws.name}</span>`;
    updateSend();
}

function updateSend() {
    sendBtn.disabled = busy || !input.value.trim();
    sendBtn.classList.toggle("loading", busy);
    sendBtn.querySelector("use").setAttribute("href", busy ? "#i-retry" : "#i-send");
    sendBtn.setAttribute("aria-label", busy ? "Waiting for response" : "Send message");
}

function render() {
    const isImage = mode === "image";
    $("chatView").hidden = isImage;
    $("imageView").hidden = !isImage;
    renderNav();
    renderRecents();
    renderHeader();
    if (!isImage) { renderThread(); renderComposer(); }
}

/* ------------------------------------------------------------- navigation */
function openWorkspace(next) {
    mode = next;
    activeId = null;
    render();
    closeDrawer();
    if (next === "image") $("imagePrompt").focus({ preventScroll: true });
    else if (!isMobile()) input.focus({ preventScroll: true });
}

function openChat(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    activeId = id;
    mode = CHAT_MODES.includes(chat.mode) ? chat.mode : "general";
    render();
    closeDrawer();
}

function newChat() {
    openWorkspace(mode === "image" ? "general" : mode);
}

async function deleteChat(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    const ok = await confirmDialog("Delete conversation?", `“${chat.title}” will be permanently removed from this browser.`);
    if (!ok) return;
    chats = chats.filter(c => c.id !== id);
    saveChats();
    if (activeId === id) activeId = null;
    render();
    toast("Conversation deleted");
}

/* ------------------------------------------------------------------- chat */
function prefill(text) {
    input.value = text;
    autosize();
    updateSend();
    input.focus();
    input.setSelectionRange(text.length, text.length);
}

function send(text) {
    text = (text ?? input.value).trim();
    if (!text || busy) return;
    let chat = currentChat();
    if (!chat) {
        chat = { id: uid(), mode, title: makeTitle(text), messages: [], updated: Date.now() };
        chats.push(chat);
        activeId = chat.id;
    }
    delete chat.error;
    chat.messages.push({ role: "user", content: text, ts: Date.now() });
    chat.updated = Date.now();
    saveChats();
    input.value = "";
    autosize();
    renderRecents();
    renderHeader();
    welcomeEl.hidden = true;
    $("errorMsg")?.remove();
    messagesEl.append(messageEl(chat.messages.at(-1), chat.messages.length - 1));
    request(chat);
}

async function request(chat) {
    busy = true;
    pending.add(chat.id);
    updateSend();
    showHealth();
    if (activeId === chat.id) { messagesEl.append(loadingEl()); scrollToBottom(); }

    const last = chat.messages.at(-1);
    const history = chat.messages.slice(0, -1).slice(-20).map(({ role, content }) => ({ role, content }));
    try {
        const r = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: last.content, history, profile, mode: chat.mode })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
            if (d.code === "not_configured") health = "unconfigured";
            throw new Error(d.error || `Request failed (${r.status}).`);
        }
        health = "ready";
        chat.messages.push({ role: "assistant", content: d.reply, ts: Date.now() });
        chat.updated = Date.now();
        saveChats();
        pending.delete(chat.id);
        if (activeId === chat.id) {
            $("loadingMsg")?.remove();
            messagesEl.append(messageEl(chat.messages.at(-1), chat.messages.length - 1));
            renderHeader();
        }
    } catch (e) {
        if (e instanceof TypeError) { health = "offline"; e = new Error("Can't reach the Smart AI server. Check that it is running and your connection is online."); }
        chat.error = e.message;
        pending.delete(chat.id);
        if (activeId === chat.id) {
            $("loadingMsg")?.remove();
            messagesEl.append(errorEl(e.message));
            scrollToBottom();
        }
    } finally {
        busy = false;
        updateSend();
        showHealth();
    }
}

function retry() {
    const chat = currentChat();
    if (!chat || busy || chat.messages.at(-1)?.role !== "user") return;
    delete chat.error;
    $("errorMsg")?.remove();
    request(chat);
}

function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
}

/* --------------------------------------------------------------- composer */
$("chatForm").addEventListener("submit", e => { e.preventDefault(); send(); });
input.addEventListener("input", () => { autosize(); updateSend(); });
input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

$("voice").addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported in this browser. Try Chrome or Edge.", "error"); return; }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.onstart = () => $("voice").classList.add("listening");
    rec.onend = () => $("voice").classList.remove("listening");
    rec.onresult = e => { prefill((input.value ? input.value.trimEnd() + " " : "") + e.results[0][0].transcript); };
    rec.onerror = () => toast("Couldn't use the microphone. Check its permission.", "error");
    rec.start();
});

/* ------------------------------------------------------------ delegation */
welcomeEl.addEventListener("click", e => {
    const s = e.target.closest("[data-suggest]");
    if (s) {
        const item = WORKSPACES[mode].suggestions[s.dataset.suggest];
        return item.send ? send(item.prompt) : prefill(item.prompt);
    }
    const c = e.target.closest("[data-chip]");
    if (c) return prefill(WORKSPACES[mode].chips[c.dataset.chip].prompt);
    if (e.target.closest('[data-action="profile"]')) openProfile();
});

messagesEl.addEventListener("click", async e => {
    const codeBtn = e.target.closest(".code-copy");
    if (codeBtn) {
        if (await copyText(codeBtn.closest(".code-block").querySelector("code").textContent)) flashCopied(codeBtn);
        return;
    }
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
        const m = currentChat()?.messages[copyBtn.dataset.copy];
        if (m && await copyText(m.content)) flashCopied(copyBtn);
        return;
    }
    if (e.target.closest('[data-action="retry"]')) retry();
});

$("workspaceNav").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]");
    if (b) openWorkspace(b.dataset.mode);
});

$("recentList").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) return deleteChat(del.dataset.del);
    const open = e.target.closest("[data-chat]");
    if (open) openChat(open.dataset.chat);
});

$("newChat").addEventListener("click", newChat);

/* ----------------------------------------------------------- header menu */
const moreBtn = $("moreBtn"), moreMenu = $("moreMenu");
function toggleMenu(open = moreMenu.hidden) {
    moreMenu.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
    if (open) moreMenu.querySelector("button:not(:disabled)")?.focus();
}
moreBtn.addEventListener("click", () => toggleMenu());
moreMenu.addEventListener("keydown", e => {
    const items = [...moreMenu.querySelectorAll("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === "Escape" || e.key === "Tab") { toggleMenu(false); if (e.key === "Escape") moreBtn.focus(); }
});
document.addEventListener("click", e => { if (!moreMenu.hidden && !e.target.closest(".menu-wrap")) toggleMenu(false); });

$("copyChat").addEventListener("click", async () => {
    toggleMenu(false);
    const chat = currentChat();
    if (!chat) return;
    const text = chat.messages.map(m => `${m.role === "user" ? "You" : "Smart AI"}:\n${m.content}`).join("\n\n");
    if (await copyText(text)) toast("Conversation copied");
});
$("clearChat").addEventListener("click", () => { toggleMenu(false); if (activeId) deleteChat(activeId); });

/* ------------------------------------------------------- sidebar / drawer */
function setCollapsed(collapsed) {
    root.classList.toggle("sb-collapsed", collapsed);
    store.raw("smartSidebar", collapsed ? "collapsed" : null);
    $("collapseBtn").setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    $("collapseBtn").dataset.tip = collapsed ? "Expand sidebar" : "Collapse sidebar";
}
$("collapseBtn").addEventListener("click", () => setCollapsed(!root.classList.contains("sb-collapsed")));
setCollapsed(root.classList.contains("sb-collapsed"));

function openDrawer() {
    root.classList.add("drawer-open");
    $("scrim").hidden = false;
    $("sidebar").setAttribute("aria-modal", "true");
    $("closeDrawer").focus();
}
function closeDrawer() {
    if (!root.classList.contains("drawer-open")) return;
    root.classList.remove("drawer-open");
    $("scrim").hidden = true;
    $("sidebar").removeAttribute("aria-modal");
}
$("openDrawer").addEventListener("click", openDrawer);
$("closeDrawer").addEventListener("click", () => { closeDrawer(); $("openDrawer").focus(); });
$("scrim").addEventListener("click", closeDrawer);
matchMedia("(max-width: 860px)").addEventListener("change", () => closeDrawer());

/* ------------------------------------------------------------------ theme */
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const themePref = () => store.raw("smartTheme") || "system";
const effectiveTheme = () => (themePref() === "system" ? (darkQuery.matches ? "dark" : "light") : themePref());
function applyTheme(pref) {
    if (pref === "system") { delete root.dataset.theme; store.raw("smartTheme", null); }
    else { root.dataset.theme = pref; store.raw("smartTheme", pref); }
    const dark = effectiveTheme() === "dark";
    $("themeBtn").querySelector("use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
    const label = dark ? "Switch to light theme" : "Switch to dark theme";
    $("themeBtn").dataset.tip = label;
    $("themeBtn").setAttribute("aria-label", label);
    document.querySelectorAll("[data-theme-opt]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.themeOpt === themePref())));
}
$("themeBtn").addEventListener("click", () => applyTheme(effectiveTheme() === "dark" ? "light" : "dark"));
document.querySelectorAll("[data-theme-opt]").forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.themeOpt)));
darkQuery.addEventListener("change", () => applyTheme(themePref()));
applyTheme(themePref());

/* --------------------------------------------------------------- dialogs */
document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
document.querySelectorAll("dialog.modal").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));

$("settingsBtn").addEventListener("click", () => { closeDrawer(); $("settingsDialog").showModal(); });
$("openProfile").addEventListener("click", () => { $("settingsDialog").close(); openProfile(); });
$("deleteAll").addEventListener("click", async () => {
    $("settingsDialog").close();
    if (!chats.length) return toast("There are no conversations to delete.");
    const ok = await confirmDialog("Delete all conversations?", `All ${chats.length} conversation${chats.length > 1 ? "s" : ""} will be permanently removed from this browser.`, "Delete all");
    if (!ok) return;
    chats = [];
    activeId = null;
    saveChats();
    render();
    toast("All conversations deleted");
});

const profileFields = ["age", "goal", "activity", "equipment", "diet"];
function openProfile() {
    profileFields.forEach(f => { $(f).value = profile[f] || ""; });
    $("profileDialog").showModal();
}
$("cancel").addEventListener("click", () => $("profileDialog").close());
$("profileForm").addEventListener("submit", e => {
    e.preventDefault();
    profile = Object.fromEntries(profileFields.map(f => [f, $(f).value.trim()]));
    store.set("smartProfile", profile);
    $("profileDialog").close();
    toast("Preferences saved");
    if (mode === "fitness" && !welcomeEl.hidden) renderWelcome();
});

/* --------------------------------------------------------------- tooltips */
const tip = $("tooltip");
function showTip(el) {
    const text = el.dataset.tip || (root.classList.contains("sb-collapsed") && !isMobile() ? el.dataset.tipCollapsed : "");
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    let x, y;
    if (el.dataset.tipPos === "right" || el.dataset.tipCollapsed) { x = r.right + 8; y = r.top + r.height / 2 - t.height / 2; }
    else { x = r.left + r.width / 2 - t.width / 2; y = r.bottom + 6; if (y + t.height > innerHeight - 4) y = r.top - t.height - 6; }
    tip.style.left = Math.max(6, Math.min(x, innerWidth - t.width - 6)) + "px";
    tip.style.top = Math.max(6, y) + "px";
}
const hideTip = () => { tip.hidden = true; };
document.addEventListener("pointerover", e => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest("[data-tip],[data-tip-collapsed]");
    if (el) showTip(el);
});
document.addEventListener("pointerout", e => { if (e.target.closest("[data-tip],[data-tip-collapsed]")) hideTip(); });
document.addEventListener("focusin", e => {
    const el = e.target.closest?.("[data-tip],[data-tip-collapsed]");
    if (el && el.matches(":focus-visible")) showTip(el); else hideTip();
});
document.addEventListener("focusout", hideTip);
document.addEventListener("pointerdown", hideTip);
addEventListener("scroll", hideTip, true);

/* ------------------------------------------------------- global shortcuts */
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
document.querySelector(".new-chat kbd").textContent = isMac ? "⇧⌘O" : "Ctrl⇧O";
document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(); }
    if (e.key === "Escape" && root.classList.contains("drawer-open")) { closeDrawer(); $("openDrawer").focus(); }
});

/* ------------------------------------------------------------ image studio */
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const IMAGE_IDEAS = [
    "A cozy reading nook with warm lamp light, watercolor style",
    "Futuristic city skyline at dusk, cinematic, ultra detailed",
    "Minimal flat illustration of a person meditating on a mountain",
    "Macro photo of a dew-covered leaf in morning light"
];
let ratio = "1:1";
let imageBusy = false;
const gallery = [];

$("ratioGroup").innerHTML = RATIOS.map(r => `<button type="button" role="radio" data-ratio="${r}" aria-checked="${r === ratio}">${r}</button>`).join("");
$("ratioGroup").addEventListener("click", e => {
    const b = e.target.closest("[data-ratio]");
    if (!b) return;
    ratio = b.dataset.ratio;
    $("ratioGroup").querySelectorAll("button").forEach(x => x.setAttribute("aria-checked", String(x === b)));
});
$("imageIdeas").innerHTML = IMAGE_IDEAS.map((p, i) => `<button type="button" class="chip" data-idea="${i}">${esc(p.split(",")[0])}</button>`).join("");
$("imageIdeas").addEventListener("click", e => {
    const b = e.target.closest("[data-idea]");
    if (!b) return;
    $("imagePrompt").value = IMAGE_IDEAS[b.dataset.idea];
    $("imagePrompt").focus();
});

function renderGallery() {
    $("galleryEmpty").hidden = gallery.length > 0;
    $("gallery").innerHTML = gallery.map((g, i) => g.pending
        ? `<figure class="g-item pending" style="margin:0;--ratio:${g.ratio.replace(":", "/")}"><div class="g-media" aria-label="Generating image"></div>
            <figcaption class="g-info"><p>${esc(g.prompt)}</p></figcaption></figure>`
        : `<figure class="g-item" style="margin:0"><div class="g-media"><img src="${g.src}" alt="${esc(g.prompt)}"></div>
            <figcaption class="g-info"><p title="${esc(g.prompt)}">${esc(g.prompt)}</p>
            <div class="g-actions"><a class="meta-btn" href="${g.src}" download="smart-ai-image-${i + 1}.png">${icon("download")}<span>Download</span></a>
            <button type="button" class="meta-btn" data-reuse="${i}">${icon("retry")}<span>Reuse prompt</span></button></div></figcaption></figure>`).join("");
}
$("gallery").addEventListener("click", e => {
    const b = e.target.closest("[data-reuse]");
    if (!b) return;
    $("imagePrompt").value = gallery[b.dataset.reuse].prompt;
    $("imagePrompt").closest(".scroller").scrollTo({ top: 0, behavior: "smooth" });
    $("imagePrompt").focus({ preventScroll: true });
});

$("imagePrompt").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("imageForm").requestSubmit(); }
});
$("imageForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (imageBusy) return;
    const prompt = $("imagePrompt").value.trim();
    const errBox = $("imageError");
    errBox.hidden = true;
    if (!prompt) { $("imagePrompt").focus(); return toast("Describe the image first.", "error"); }

    imageBusy = true;
    const btn = $("generateImage");
    btn.disabled = true;
    btn.classList.add("loading");
    btn.querySelector("span").textContent = "Generating…";
    btn.querySelector("use").setAttribute("href", "#i-retry");
    const item = { prompt, ratio, pending: true };
    gallery.unshift(item);
    renderGallery();
    try {
        const r = await fetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, aspectRatio: ratio }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Image request failed (${r.status}).`);
        item.src = d.image;
        delete item.pending;
        toast("Image generated");
    } catch (err) {
        gallery.splice(gallery.indexOf(item), 1);
        const msg = err instanceof TypeError ? "Can't reach the Smart AI server. Check that it is running." : err.message;
        errBox.innerHTML = `<div class="error-box">${icon("alert")}<div><div>${esc(msg)}</div>
            <button type="button" class="btn btn-secondary" id="imageRetry">${icon("retry")}<span>Try again</span></button></div></div>`;
        errBox.hidden = false;
        $("imageRetry").addEventListener("click", () => $("imageForm").requestSubmit());
    } finally {
        imageBusy = false;
        btn.disabled = false;
        btn.classList.remove("loading");
        btn.querySelector("span").textContent = "Generate image";
        btn.querySelector("use").setAttribute("href", "#i-wand");
        renderGallery();
    }
});

/* -------------------------------------------------------------------- init */
addEventListener("online", checkHealth);
addEventListener("offline", () => { health = "offline"; showHealth(); });
addEventListener("storage", e => { if (e.key === "smartChats") { chats = loadChats(); if (!currentChat()) activeId = null; render(); } });

renderGallery();
render();
checkHealth();
if (!isMobile()) input.focus({ preventScroll: true });
