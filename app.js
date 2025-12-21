// Kadavernl • IA Media Gallery (via Cloudflare Worker resolver)
// ✅ Put IA identifiers in MEDIA
// ✅ Browser calls your Worker: /resolve?identifier=...
// ✅ Worker returns directUrl + title + thumb etc (no CORS issues)

// ===========================
// CONFIG: PUT YOUR WORKER URL HERE
// Example:
// const IA_RESOLVER = "https://ia-resolver.yourname.workers.dev/resolve";
const IA_RESOLVER = "https://dash.cloudflare.com/8336f13765e85eb46db630fdf2657a9f/workers/services/view/internet-archive/production/builds/a88806d6-0d9e-4565-9f0e-b2bc5cebc888/resolve";

// ===========================
// EDIT THIS LIST
// You can use: { ia: "identifier" } OR { url: "https://..." }
const MEDIA = [
  { ia: "roddelpraat-archief", title: "Roddelpraat Archief", type: "video", tags: ["roddelpraat"] },
  { ia: "jans-reviews-2025", title: "Jan's Reviews (2025)", type: "video", tags: ["reviews", "2025"] },
  { ia: "lil-peep-everybodys-everything_202512", title: "Lil Peep — Everybody's Everything", type: "video", tags: ["docu"] },

  // Direct links still allowed:
  // { url: "https://example.com/myvideo.mp4", title: "My MP4", type: "video" },
];

// ===========================
// DOM
// ===========================
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const countPill = document.getElementById("countPill");
const emptyEl = document.getElementById("empty");

const searchInput = document.getElementById("searchInput");
const typeSelect = document.getElementById("typeSelect");
const reloadBtn = document.getElementById("reloadBtn");
const helpBtn = document.getElementById("helpBtn");

const playerDialog = document.getElementById("playerDialog");
const playerTitle = document.getElementById("playerTitle");
const playerVideo = document.getElementById("playerVideo");
const playerFallback = document.getElementById("playerFallback");
const playerDownload = document.getElementById("playerDownload");
const playerDetails = document.getElementById("playerDetails");
const playerDirect = document.getElementById("playerDirect");

const helpDialog = document.getElementById("helpDialog");

// ===========================
// Helpers
// ===========================
function setStatus(msg) { statusEl.textContent = msg; }
function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function guessTypeFromUrl(url) {
  const u = (url || "").toLowerCase();
  if (/\.(mp4|webm|mkv|avi|mov|m4v|ogv)(\?|#|$)/.test(u)) return "video";
  if (/\.(mp3|wav|flac|m4a|aac|ogg)(\?|#|$)/.test(u)) return "audio";
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg)(\?|#|$)/.test(u)) return "image";
  return "other";
}
function isPlayableInBrowser(url) {
  const u = (url || "").toLowerCase();
  return /\.(mp4|webm|ogv|m4v|mov)(\?|#|$)/.test(u);
}
function iaIdentifierFrom(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^https?:\/\/archive\.org\/details\//i.test(s)) {
    return s.split("/details/")[1]?.split(/[?#]/)[0] || null;
  }
  if (/^[a-z0-9][a-z0-9._-]{1,}$/i.test(s)) return s;
  return null;
}
function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B","KB","MB","GB","TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ===========================
// Normalization via Worker Resolver
// ===========================
let normalized = [];
let loading = false;

async function resolveIa(identifier) {
  if (!IA_RESOLVER || IA_RESOLVER.includes("YOUR-WORKER-URL")) {
    throw new Error("Set IA_RESOLVER in app.js to your deployed Worker /resolve URL.");
  }

  const url = `${IA_RESOLVER}?identifier=${encodeURIComponent(identifier)}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Resolver HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "Resolver failed");
  return data;
}

async function normalizeItem(item) {
  const base = {
    title: item.title || "",
    desc: item.desc || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    type: item.type || "",
    thumb: item.thumb || "",
    detailsUrl: item.detailsUrl || "",
    directUrl: item.directUrl || "",
    source: item.ia ? "ia" : "direct",
    raw: item
  };

  // IA item -> resolve via Worker
  if (item.ia) {
    const identifier = iaIdentifierFrom(item.ia);
    if (!identifier) {
      return { ...base, title: base.title || "Invalid IA item", type: base.type || "other" };
    }

    const data = await resolveIa(identifier);

    return {
      ...base,
      iaIdentifier: identifier,
      title: base.title || data.title || identifier,
      desc: base.desc || data.description || "",
      thumb: base.thumb || data.thumbUrl || "",
      detailsUrl: base.detailsUrl || data.detailsUrl || "",
      directUrl: base.directUrl || data.directUrl || "",
      type: base.type || data.fileType || "other",
      sizeLabel: data.size ? formatSize(data.size) : "",
      fileName: data.fileName || "",
      fileExt: data.fileExt || ""
    };
  }

  // Direct file
  if (item.url) {
    const url = String(item.url).trim();
    const type = base.type || guessTypeFromUrl(url);
    return {
      ...base,
      title: base.title || url.split("/").pop() || "Untitled",
      directUrl: url,
      detailsUrl: base.detailsUrl || url,
      type,
      thumb: base.thumb || "",
      sizeLabel: ""
    };
  }

  return { ...base, title: base.title || "Invalid item", type: base.type || "other" };
}

// ===========================
// Filtering + rendering
// ===========================
function matchesFilters(it) {
  const q = searchInput.value.trim().toLowerCase();
  const t = typeSelect.value;

  if (t && (it.type || "").toLowerCase() !== t) return false;
  if (!q) return true;

  const hay = `${it.title || ""}\n${it.desc || ""}\n${(it.tags || []).join(" ")}\n${it.detailsUrl || ""}\n${it.directUrl || ""}`.toLowerCase();
  return hay.includes(q);
}

function typeBadge(type) {
  const t = (type || "other").toLowerCase();
  if (t === "video") return "video";
  if (t === "audio") return "audio";
  if (t === "image") return "image";
  return "other";
}

function render() {
  grid.innerHTML = "";
  const visible = normalized.filter(matchesFilters);

  emptyEl.classList.toggle("hidden", visible.length !== 0);
  countPill.textContent = `${visible.length} shown • ${normalized.length} total`;

  for (const it of visible) {
    const badge = typeBadge(it.type);
    const title = it.title || "Untitled";
    const desc = it.desc || "";
    const tags = Array.isArray(it.tags) ? it.tags : [];

    const hasThumb = !!it.thumb;
    const thumbHtml = hasThumb
      ? `<img loading="lazy" src="${esc(it.thumb)}" alt="${esc(title)}">`
      : `<div style="width:100%;height:100%;display:grid;place-items:center;color:rgba(231,233,238,.6);font-weight:700;">NO THUMB</div>`;

    const card = document.createElement("article");
    card.className = "card";

    const direct = it.directUrl || "";
    const details = it.detailsUrl || "";
    const size = it.sizeLabel ? ` • ${esc(it.sizeLabel)}` : "";

    card.innerHTML = `
      <div class="thumb">
        ${thumbHtml}
        <div class="badge">${esc(badge)}${size}</div>
      </div>

      <div class="body">
        <div class="title">
          <span title="${esc(title)}">${esc(title)}</span>
          ${tags.length ? `<span class="smallTag">${esc(tags[0])}${tags.length > 1 ? ` +${tags.length - 1}` : ""}</span>` : ""}
        </div>

        <div class="meta">
          <span>${it.source === "ia" ? "Internet Archive" : "Direct link"}</span>
          ${direct ? `<span>✓ direct found</span>` : `<span style="color:rgba(255,77,109,.9)">no direct file</span>`}
        </div>

        <div class="desc" title="${esc(desc)}">${esc(desc)}</div>
      </div>

      <div class="actions">
        ${direct && (it.type === "video" || it.type === "audio")
          ? `<button class="btn btnTiny" data-action="play" data-id="${esc(it._id)}">Play</button>`
          : ""
        }
        ${direct ? `<a class="btn btnTiny" href="${esc(direct)}" target="_blank" rel="noopener">Download</a>` : ""}
        ${details ? `<a class="btn btnTiny" href="${esc(details)}" target="_blank" rel="noopener">Details</a>` : ""}
      </div>
    `;

    grid.appendChild(card);
  }
}

// ===========================
// Player
// ===========================
function openPlayer(it) {
  const direct = it.directUrl;
  const details = it.detailsUrl || direct || "#";

  playerTitle.textContent = it.title || "Player";
  playerDetails.href = details;
  playerDirect.href = direct || details;
  playerDownload.href = direct || details;

  // reset
  try { playerVideo.pause(); } catch {}
  playerVideo.removeAttribute("src");
  playerVideo.load();
  playerFallback.classList.add("hidden");

  if (!direct) {
    playerFallback.classList.remove("hidden");
    playerDialog.showModal();
    return;
  }

  // Try to play
  if ((it.type === "video" || it.type === "audio") && isPlayableInBrowser(direct)) {
    playerVideo.src = direct;
    playerVideo.load();
  } else {
    // MKV/AVI etc: not usually playable
    playerFallback.classList.remove("hidden");
  }

  playerDialog.showModal();
}

// ===========================
// Boot
// ===========================
function attachIds() {
  normalized = normalized.map((it, idx) => ({
    ...it,
    _id: it._id || `m_${idx}_${Math.random().toString(16).slice(2)}`
  }));
}

async function loadAll() {
  if (loading) return;
  loading = true;
  setStatus("Loading items…");

  try {
    if (!MEDIA.length) {
      normalized = [];
      render();
      setStatus("No items yet. Add IA identifiers in MEDIA in app.js.");
      return;
    }

    const out = [];
    for (let i = 0; i < MEDIA.length; i++) {
      const src = MEDIA[i];
      try {
        const norm = await normalizeItem(src);
        out.push(norm);
        setStatus(`Loaded ${i + 1}/${MEDIA.length}…`);
      } catch (e) {
        out.push({
          title: src.title || (src.ia ? String(src.ia) : "Error"),
          desc: `Error: ${String(e.message || e)}`,
          type: src.type || "other",
          source: src.ia ? "ia" : "direct",
          raw: src
        });
      }
    }

    normalized = out;
    attachIds();
    render();
    setStatus(`Ready. Loaded ${normalized.length} items.`);
  } finally {
    loading = false;
  }
}

// Events
searchInput.addEventListener("input", render);
typeSelect.addEventListener("change", render);
reloadBtn.addEventListener("click", loadAll);
helpBtn.addEventListener("click", () => helpDialog.showModal());

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const it = normalized.find(x => x._id === id);
  if (!it) return;
  if (btn.dataset.action === "play") openPlayer(it);
});

playerDialog.addEventListener("close", () => {
  try { playerVideo.pause(); } catch {}
});

// Start
loadAll();
