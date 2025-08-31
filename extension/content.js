// ---------- Config ----------
const CONFIG = {
  API_BASE: "https://YOUR_RAILWAY_URL", // e.g. https://web-production-abc.up.railway.app
  AUGMENT_ENDPOINT: "/augment",
  selectors: {
    textarea: [
      '#prompt-textarea',
      'textarea[placeholder*="message"]',
      'textarea[placeholder*="Nachricht"]',
      'textarea'
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Senden"]',
      'form button[type="submit"]'
    ]
  }
};

// ---------- DOM helpers ----------
function $(sel) { return document.querySelector(sel); }
function findFirst(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

// ---------- Overlay ----------
function buildOverlay() {
  if (document.getElementById("cb-overlay")) return;

  const root = document.createElement("div");
  root.id = "cb-overlay";

  root.innerHTML = `
    <div id="cb-header">
      <div>
        <span id="cb-title">ContextBroker</span>
        <span id="cb-status"></span>
      </div>
      <div id="cb-actions">
        <button id="cb-toggle" class="cb-btn secondary">Hide</button>
        <button id="cb-augment" class="cb-btn">Augment</button>
      </div>
    </div>
    <div id="cb-context">
      <div style="font-weight:600; margin-bottom:4px;">Context preview</div>
      <ul id="cb-list"></ul>
    </div>
  `;

  document.body.appendChild(root);

  // Toggle preview
  const toggle = $("#cb-toggle");
  const ctx = $("#cb-context");
  toggle.addEventListener("click", () => {
    const isHidden = ctx.style.display !== "block";
    ctx.style.display = isHidden ? "block" : "none";
    toggle.textContent = isHidden ? "Hide" : "Show";
  });

  // Augment click
  $("#cb-augment").addEventListener("click", onAugmentClick);

  // Make sure we attach to the current textarea
  attachToTextarea();
}

function setStatus(msg) {
  const el = $("#cb-status");
  if (el) el.textContent = msg ? `· ${msg}` : "";
}

// ---------- Core ----------
async function getJWT() {
  return new Promise(resolve => {
    try {
      chrome.storage?.local.get(["ctx_jwt"], (res) => resolve(res?.ctx_jwt || null));
    } catch {
      resolve(null);
    }
  });
}

async function augment(prompt) {
  const jwt = await getJWT();
  const res = await fetch(`${CONFIG.API_BASE}${CONFIG.AUGMENT_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { "Authorization": `Bearer ${jwt}` } : {})
    },
    body: JSON.stringify({ prompt })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`augment failed: ${res.status} ${txt}`);
  }
  return res.json(); // { augmentedPrompt, contextPreview, tokenUsageEstimate }
}

function getTextarea() {
  return findFirst(CONFIG.selectors.textarea);
}
function getSendButton() {
  return findFirst(CONFIG.selectors.sendButton);
}

async function onAugmentClick() {
  const ta = getTextarea();
  if (!ta) return setStatus("textarea not found");
  const raw = (ta.value || "").trim();
  if (!raw) return setStatus("empty prompt");

  try {
    setStatus("fetching context…");
    const { augmentedPrompt, contextPreview = [] } = await augment(raw);

    // Show context bullets
    const list = $("#cb-list");
    list.innerHTML = "";
    for (const item of contextPreview) {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    $("#cb-context").style.display = "block";
    $("#cb-toggle").textContent = "Hide";

    // Replace textarea text
    ta.value = augmentedPrompt;

    // Try to click send if there is a send button
    setStatus("ready");
    const btn = getSendButton();
    if (btn) btn.click();
    else ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  } catch (err) {
    console.error("[ContextBroker] augment error", err);
    setStatus("error");
  }
}

function attachToTextarea() {
  // If ChatGPT re-renders the input, nothing breaks
  const ta = getTextarea();
  if (!ta) return;
}

// ---------- Boot ----------
function init() {
  console.log("[ContextBroker] content script loaded");
  buildOverlay();

  // Watch for SPA route changes and reattach
  const obs = new MutationObserver(() => attachToTextarea());
  obs.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
