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
        top:72px;max-width:920px;width:calc(100% - 48px);
        background:#0f1115;border:1px solid #2b2f36;border-radius:10px;
        padding:8px 10px;display:flex;gap:8px;align-items:center;
        box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,Segoe UI,Arial}
      #cb-input{flex:1;resize:vertical;min-height:36px;max-height:160px;
        color:#e5e7eb;background:#151922;border:1px solid #2b2f36;border-radius:8px;padding:8px}
      #cb-run{padding:8px 12px;border:1px solid #2b2f36;background:#1e2633;
        color:#e5e7eb;border-radius:8px;cursor:pointer}
      #cb-status{font-size:12px;color:#93a1b1;margin-left:6px}
      #cb-preview{white-space:pre-wrap;font-size:12px;color:#9aa4af;margin-top:4px;max-height:120px;overflow:auto}
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

// ======= selectors for ChatGPT input/send =======
function getChatBox() {
  // New UI tends to use [data-testid="prompt-textarea"] or contenteditable textbox
  const a = document.querySelector('[data-testid="prompt-textarea"]');
  if (a) return a;
  const b = [...document.querySelectorAll('[contenteditable="true"]')]
    .find(el => el.getAttribute("role") === "textbox");
  return b || null;
}
function setChatText(el, text) {
  // Support textarea or contenteditable
  if (!el) return false;
  if (el.tagName === "TEXTAREA") {
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  // contenteditable
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
function clickSend() {
  const btn = document.querySelector('[data-testid="send-button"]') ||
              document.querySelector('button[aria-label="Send"]');
  if (btn) btn.click();
}

// ======= main =======
async function onAugment() {
  const prompt = document.getElementById("cb-input")?.value?.trim() || "";
  if (!prompt) { setStatus("Empty prompt."); return; }
  setStatus("Fetching context...");
  setPreview("");

  try {
    // GET style: /ask?q=...
    const url = BACKEND_URL + "?q=" + encodeURIComponent(prompt);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();

    // Our server returns plain text: answer + "---\nCONTEXT USED:\n..."
    // Split to isolate the context block. If not found, just inject original.
    let context = "";
    const splitIdx = txt.indexOf("---\nCONTEXT USED:\n");
    if (splitIdx >= 0) {
      context = txt.slice(splitIdx + 19).trim();
      setPreview(context);
    } else {
      // fallback if server returns JSON later
      try {
        const j = JSON.parse(txt);
        context = j.context || "";
        setPreview(context);
      } catch {}
    }

    const augmented = context
      ? `CONTEXT:\n${context}\n\nQUESTION:\n${prompt}`
      : prompt;

    const box = getChatBox();
    if (!box) throw new Error("ChatGPT textbox not found.");
    setChatText(box, augmented);
    setStatus("Injected. Press Enter or I can auto send.");
    // Auto send. Comment out if you hate power.
    clickSend();
    setStatus("Sent.");
  } catch (e) {
    setStatus("Failed: " + e.message);
  }
}

// kick it off
insertBar();
