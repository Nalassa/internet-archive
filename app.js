// Kadavernl • Manual Media Gallery
// - Add items yourself (IA identifier/details link OR direct file URL)
// - If IA item: uses https://archive.org/metadata/<identifier> to find direct downloadable files
// - Prefers mp4/webm for playback, but provides download for mkv/avi too

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
// 1) EDIT THIS LIST
// ===========================
const MEDIA = [
  // Internet Archive examples:
  // { ia: "plan-c-2012", title: "Plan C (2012)", desc: "My video", tags: ["skate", "edit"] },
  // { ia: "https://archive.org/details/plan-c-2012", title: "Plan C (2012)" },

  // Direct file example:
  // { url: "https://example.com/myvideo.mp4", title: "My hosted MP4", type: "video", tags: ["demo"] },
];

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
  if (/\.(mp4|webm|mkv|avi|mov|m4v)(\?|#|$)/.test(u)) return "video";
  if (/\.(mp3|wav|flac|m4a|aac|ogg)(\?|#|$)/.test(u)) return "audio";
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg)(\?|#|$)/.test(u)) return "image";
  return "other";
}
function isPlayableInBrowser(url) {
  const u = (url || "").toLowerCase();
  // Most browsers: mp4, webm, ogg video
  return /\.(mp4|webm|ogv|m4v|mov)(\?|#|$)/.test(u);
}
function iaIdentifierFrom(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^https?:\/\/archive\.org\/details\//i.test(s)) {
    return s.split("/details/")[1]?.split(/[?#]/)[0] || null;
  }
  // If they give an identifier directly
  if (/^[a-z0-9][a-z0-9._-]{1,}$/i.test(s)) return s;
  return null;
}
function iaDetailsUrl(identifier) {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}
function iaThumbUrl(identifier) {
  return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
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
// IA: resolve direct files
// ===========================
const IA_VIDEO_EXTS = ["mp4","webm","mkv","avi","mov","m4v","ogv"];
const IA_AUDIO_EXTS = ["mp3","wav","flac","m4a","aac","ogg"];
const IA_IMAGE_EXTS = ["jpg","jpeg","png","gif","webp","avif","svg"];

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function classifyByExt(ext) {
  if (IA_VIDEO_EXTS.includes(ext)) return "video";
  if (IA_AUDIO_EXTS.includes(ext)) return "audio";
  if (IA_IMAGE_EXTS.includes(ext)) return "image";
  return "other";
}

function scoreFile(f) {
  // Higher = better candidate
  const name = String(f.name || "");
  const ext = extOf(name);
  const type = classifyByExt(ext);

  let s = 0;
  // Prefer original-ish sources, but keep it simple
  if (String(f.source || "").toLowerCase() === "original") s += 20;

  // Prefer browser-playable for "Play"
  if (type === "video") {
    if (ext === "mp4") s += 100;
    else if (ext === "webm") s += 90;
    else if (ext === "m4v" || ext === "mov") s += 70;
    else if (ext === "ogv") s += 60;
    else if (ext === "mkv") s += 40;   // usually not playable
    else if (ext === "avi") s += 30;   // usually not playable
  } else if (type === "audio") {
    if (ext === "mp3") s += 80;
    else if (ext === "m4a") s += 70;
    else if (ext === "ogg") s += 60;
    else if (ext === "flac") s += 50;
    else if (ext === "wav") s += 40;
  } else if (type === "image") {
    if (ext === "jpg" || ext === "jpeg") s += 70;
    else if (ext === "png") s += 65;
    else if (ext === "webp") s += 60;
    else if (ext === "gif") s += 55;
  }

  // Prefer bigger files for video/audio (often the real one)
  const size = Number(f.size || 0);
  if (Number.isFinite(size) && size > 0) {
    // log-ish bump
    s += Math.min(30, Math.log10(size) * 4);
  }

  // Avoid obvious thumbnails / meta
  if (/\bthumb\b|\bthumbnail\b|_thumb|poster|cover/i.test(name)) s -= 40;
  if (/\.(srt|vtt|nfo|txt|json|xml|md|log)$/i.test(name)) s -= 80;

  return s;
}

async function fetchIaMetadata(identifier) {
  const u = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const res = await fetch(u, { headers: { "Accept":"application/json" } });
  if (!res.ok) throw new Error(`IA metadata HTTP ${res.status}`);
  return await res.json();
}

function bestDirectFromIaMeta(meta, wantedTypeHint = "") {
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const server = meta?.server;
  const dir = meta?.dir;
  if (!server || !dir) return null;

  // Candidate pool: only files with name + an extension we know
  const candidates = files
    .filter(f => f && f.name && extOf(f.name))
    .map(f => ({ ...f, _ext: extOf(f.name), _type: classifyByExt(extOf(f.name)) }));

  // If user hinted a type, we can narrow a bit (still allow fallback)
  let pool = candidates;
  if (wantedTypeHint && ["video","audio","image","other"].includes(wantedTypeHint)) {
    const narrowed = candidates.filter(x => x._type === wantedTypeHint);
    if (narrowed.length) pool = narrowed;
  }

  // Choose best-scoring
  pool.sort((a,b) => scoreFile(b) - scoreFile(a));
  const best = pool[0];
  if (!best) return null;

  const direct = `https://${server}${dir}/${encodeURIComponent(best.name)}`;
  return {
    directUrl: direct,
    fileName: best.name,
    fileType: best._type,
    ext: best._ext,
    size: best.size ? Number(best.size) : null
  };
}

// ===========================
// Normalized items
// ===========================
let normalized = [];
let loading = false;

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

  // Internet Archive item
  if (item.ia) {
    const identifier = iaIdentifierFrom(item.ia);
    if (!identifier) {
      return { ...base, title: base.title || "Invalid IA item", type: base.type || "other" };
    }

    const details = iaDetailsUrl(identifier);
    const thumb = iaThumbUrl(identifier);

    // Resolve direct file
    const meta = await fetchIaMetadata(identifier);
    const fallbackTitle = meta?.metadata?.title || identifier;
    const wanted = base.type || ""; // optional hint
    const best = bestDirectFromIaMeta(meta, wanted);

    const resolvedType = base.type || best?.fileType || "other";
    const resolvedTitle = base.title || fallbackTitle;
    const resolvedDesc = base.desc || (meta?.metadata?.description ? String(meta.metadata.description) : "");

    return {
      ...base,
      iaIdentifier: identifier,
      title: resolvedTitle,
      desc: resolvedDesc,
      thumb,
      detailsUrl: details,
      directUrl: best?.directUrl || "",
      type: resolvedType,
      sizeLabel: best?.size ? formatSize(best.size) : ""
    };
  }

  // Direct URL item
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

  // If neither ia nor url
  return { ...base, title: base.title || "Invalid item", type: base.type || "other" };
}

// ===========================
// Rendering + filters
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
        ${direct ? `<button class="btn btnTiny" data-action="play" data-id="${esc(it._id)}">Play</button>` : ""}
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

  // Reset
  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
  playerFallback.classList.add("hidden");

  if (!direct) {
    playerFallback.classList.remove("hidden");
    playerDialog.showModal();
    return;
  }

  // If browser can likely play it, use <video>; otherwise show fallback with download
  if (it.type === "video" && isPlayableInBrowser(direct)) {
    playerVideo.src = direct;
    playerVideo.load();
  } else if (it.type === "audio") {
    // Use <video> as a player for audio too (works fine)
    playerVideo.src = direct;
    playerVideo.load();
  } else if (it.type === "image") {
    // Not a media player use-case — open direct instead
    window.open(direct, "_blank", "noopener");
    return;
  } else {
    playerFallback.classList.remove("hidden");
  }

  playerDialog.showModal();
}

// ===========================
// Boot
// ===========================
function attachIds() {
  // stable internal IDs for click actions
  normalized = normalized.map((it, idx) => ({ ...it, _id: it._id || `m_${idx}_${Math.random().toString(16).slice(2)}` }));
}

async function loadAll() {
  if (loading) return;
  loading = true;
  setStatus("Loading items…");

  try {
    const out = [];
    for (let i = 0; i < MEDIA.length; i++) {
      const src = MEDIA[i];
      try {
        const norm = await normalizeItem(src);
        out.push(norm);
        setStatus(`Loaded ${i + 1}/${MEDIA.length}…`);
      } catch (e) {
        out.push({ title: src.title || "Error", desc: String(e.message || e), type: "other", source: "error", raw: src });
      }
    }

    normalized = out;
    attachIds();
    render();

    if (normalized.length === 0) setStatus("No items yet. Add entries in MEDIA in app.js.");
    else setStatus(`Ready. Loaded ${normalized.length} items.`);
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
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
  const action = btn.dataset.action;

  const it = normalized.find(x => x._id === id);
  if (!it) return;

  if (action === "play") openPlayer(it);
});

// Safety: stop playback when closing dialog
playerDialog.addEventListener("close", () => {
  try { playerVideo.pause(); } catch {}
});

// Start
loadAll();
