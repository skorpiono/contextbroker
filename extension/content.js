// ======= config =======
const BACKEND_URL = "https://web-production-851cd.up.railway.app/ask"; // supports GET ?q=...
const MAX_PREVIEW_CHARS = 600;

// ======= ui =======
function insertBar() {
  if (document.getElementById("cb-bar")) return;

  const wrap = document.createElement("div");
  wrap.id = "cb-bar";
  wrap.innerHTML = `
    <style>
      #cb-bar{position:fixed;z-index:99999;left:50%;transform:translateX(-50%);
        top:72px;max-width:1100px;width:calc(100% - 48px);
        background:#0f1115;border:1px solid #2b2f36;border-radius:10px;
        padding:8px 10px;display:flex;gap:8px;align-items:flex-start;
        box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,Segoe UI,Arial}
      #cb-input{flex:1;resize:vertical;min-height:36px;max-height:160px;
        color:#e5e7eb;background:#151922;border:1px solid #2b2f36;border-radius:8px;padding:8px}
      #cb-run{padding:8px 12px;border:1px solid #2b2f36;background:#1e2633;
        color:#e5e7eb;border-radius:8px;cursor:pointer;white-space:nowrap}
      #cb-status{font-size:12px;color:#93a1b1;margin-left:6px;white-space:nowrap}
      #cb-preview{white-space:pre-wrap;font-size:12px;color:#9aa4af;margin-top:2px;
        max-height:140px;overflow:auto;flex:1}
    </style>
    <textarea id="cb-input" placeholder="Type your prompt here."></textarea>
    <button id="cb-run">Augment</button>
    <span id="cb-status"></span>
    <div id="cb-preview"></div>
  `;
  document.body.appendChild(wrap);

  document.getElementById("cb-run").addEventListener("click", onAugment);
  document.getElementById("cb-input").addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onAugment();
  });
}

function setStatus(txt) {
  const el = document.getElementById("cb-status");
  if (el) el.textContent = txt || "";
}
function setPreview(txt) {
  const el = document.getElementById("cb-preview");
  if (!el) return;
  if (!txt) { el.textContent = ""; return; }
  const cut = txt.length > MAX_PREVIEW_CHARS ? txt.slice(0, MAX_PREVIEW_CHARS) + " ..." : txt;
  el.textContent = "Context preview:\n" + cut;
}

/* ======= deep query utilities (DOM + shadow DOM) ======= */

function* allRoots(start = document) {
  const stack = [start];
  while (stack.length) {
    const node = stack.pop();
    yield node;
    // Shadow root
    if (node.shadowRoot) stack.push(node.shadowRoot);
    // Regular children
    const kids = node.querySelectorAll ? node.querySelectorAll("*") : [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      stack.push(k);
      if (k.shadowRoot) stack.push(k.shadowRoot);
    }
  }
}

function deepQuerySelector(selector) {
  for (const root of allRoots(document)) {
    try {
      const found = root.querySelector ? root.querySelector(selector) : null;
      if (found) return found;
    } catch {}
  }
  return null;
}

function deepQuerySelectorAll(selector) {
  const out = [];
  for (const root of allRoots(document)) {
    try {
      const list = root.querySelectorAll ? root.querySelectorAll(selector) : [];
      for (const el of list) out.push(el);
    } catch {}
  }
  return out;
}

/* ======= robust composer detection & send ======= */

function findComposer() {
  // 1) official textarea
  let el = deepQuerySelector('[data-testid="prompt-textarea"]');
  if (el) return el;

  // 2) textarea inside any form with a submit button
  const forms = deepQuerySelectorAll("form");
  for (const f of forms) {
    const hasSubmit = f.querySelector('button[type="submit"], [data-testid="send-button"]');
    if (!hasSubmit) continue;
    const te = f.querySelector("textarea");
    if (te) return te;
    const ce = f.querySelector('[contenteditable="true"][role="textbox"]');
    if (ce) return ce;
    const rb = f.querySelector('[role="textbox"]');
    if (rb) return rb;
  }

  // 3) any visible contenteditable or textarea near bottom
  const candidates = deepQuerySelectorAll('[contenteditable="true"][role="textbox"], [role="textbox"], textarea')
    .filter(el => el.offsetParent !== null);
  if (candidates.length) return candidates[candidates.length - 1];

  return null;
}

function setChatText(el, text) {
  if (!el) return false;

  // textarea path
  if (el.tagName === "TEXTAREA") {
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // contenteditable or role="textbox"
  if (el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox") {
    el.focus();
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(text));

    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  return false;
}

function clickSend() {
  let btn =
    deepQuerySelector('[data-testid="send-button"]') ||
    deepQuerySelector('form button[type="submit"]') ||
    deepQuerySelector('button[aria-label*="Send"], button[aria-label*="Senden"]');

  if (btn) {
    btn.click();
    return true;
  }

  // fallback: synthesize Enter
  const el = findComposer();
  if (!el) return false;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true }));
  return true;
}

/* ======= main ======= */

async function onAugment() {
  const prompt = document.getElementById("cb-input")?.value?.trim() || "";
  if (!prompt) { setStatus("Empty prompt."); return; }
  setStatus("Fetching context...");
  setPreview("");

  try {
    const url = BACKEND_URL + "?q=" + encodeURIComponent(prompt);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();

    // plain text: answer + "---\nCONTEXT USED:\n..."
    let context = "";
    const splitIdx = txt.indexOf("---\nCONTEXT USED:\n");
    if (splitIdx >= 0) {
      context = txt.slice(splitIdx + 19).trim();
      setPreview(context);
    } else {
      try {
        const j = JSON.parse(txt);
        context = j.context || "";
        setPreview(context);
      } catch {}
    }

    const augmented = context
      ? `CONTEXT:\n${context}\n\nQUESTION:\n${prompt}`
      : prompt;

    const box = findComposer();
    console.log("[ContextBroker] composer:", box);
    if (!box) throw new Error("ChatGPT textbox not found.");

    const ok = setChatText(box, augmented);
    if (!ok) throw new Error("Could not inject text.");

    setStatus("Injected. Sending...");
    setTimeout(() => {
      clickSend();
      setStatus("Sent.");
    }, 120);
  } catch (e) {
    setStatus("Failed: " + e.message);
    console.error("[ContextBroker]", e);
  }
}

// kick it off
insertBar();

// keep it resilient across SPA route changes
new MutationObserver(() => {
  if (!document.getElementById("cb-bar")) insertBar();
}).observe(document.body, { childList: true, subtree: true });

// helpful initial log
console.log("[ContextBroker] content script loaded");
