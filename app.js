// Kadavernl • IA Gallery
// Uses Internet Archive Search Scrape API (cursor-based pagination).  https://archive.org/services/search/v1/scrape
// Embed URL pattern: https://archive.org/embed/<identifier>

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const countPill = document.getElementById("countPill");
const queryPill = document.getElementById("queryPill");
const emptyEl = document.getElementById("empty");

const searchInput = document.getElementById("searchInput");
const typeSelect = document.getElementById("typeSelect");
const refreshBtn = document.getElementById("refreshBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const embedDialog = document.getElementById("embedDialog");
const embedTextarea = document.getElementById("embedTextarea");
const copyEmbedBtn = document.getElementById("copyEmbedBtn");

// ---- Config ----
// You can override via URL:
//   ?user=kadavernl
//   ?q=creator:(kadavernl)
//   ?fields=identifier,title,mediatype,date,description
const urlParams = new URLSearchParams(location.search);
const USER = urlParams.get("user") || "kadavernl";

// Default query tries creator:(username). If that yields 0, change to something else:
// e.g. (collection:opensource_movies AND creator:(...)) OR uploader:(your@email.com)
const DEFAULT_QUERY = urlParams.get("q") || `uploader:(${USER})`;

const FIELDS = (urlParams.get("fields") || "identifier,title,mediatype,date,description,downloads,creator")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Sort by "date desc" if available; identifier MUST be last in sorts for scrape API.
const SORTS = (urlParams.get("sorts") || "date desc,identifier asc").split(",").map(s => s.trim());

// Recommended: count >= 100 for scrape endpoint
const PAGE_SIZE = Math.max(100, Number(urlParams.get("count") || 100));

// ---- State ----
let cursor = null;
let allItems = [];
let loading = false;
let exhausted = false;

document.getElementById("pageTitle").textContent = USER;
queryPill.textContent = `q: ${DEFAULT_QUERY}`;

function setStatus(msg) { statusEl.textContent = msg; }
function setCount() { countPill.textContent = `${allItems.length} items`; }

function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function iaThumb(identifier) {
  // Simple & reliable item image endpoint:
  return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}

function iaDetails(identifier) {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}

function iaEmbed(identifier) {
  return `https://archive.org/embed/${encodeURIComponent(identifier)}`;
}

function buildEmbedCode(identifier) {
  return `<iframe src="${iaEmbed(identifier)}" width="560" height="384" frameborder="0" webkitallowfullscreen="true" mozallowfullscreen="true" allowfullscreen></iframe>`;
}

function matchesFilters(item) {
  const q = searchInput.value.trim().toLowerCase();
  const t = typeSelect.value;

  if (t && (item.mediatype || "").toLowerCase() !== t) return false;

  if (!q) return true;
  const hay = `${item.title || ""}\n${item.description || ""}\n${item.identifier || ""}`.toLowerCase();
  return hay.includes(q);
}

function render() {
  grid.innerHTML = "";
  const visible = allItems.filter(matchesFilters);

  emptyEl.classList.toggle("hidden", visible.length !== 0);

  for (const it of visible) {
    const identifier = it.identifier;
    const title = it.title || identifier;
    const mediatype = it.mediatype || "item";
    const date = it.date ? String(it.date).slice(0, 10) : "";
    const desc = it.description || "";

    const card = document.createElement("article");
    card.className = "card";

    card.innerHTML = `
      <div class="thumb">
        <img loading="lazy" src="${iaThumb(identifier)}" alt="${esc(title)}">
        <div class="badge">${esc(mediatype)}</div>
      </div>

      <div class="body">
        <div class="title" title="${esc(title)}">${esc(title)}</div>
        <div class="meta">
          ${date ? `<span>📅 ${esc(date)}</span>` : ""}
          ${it.downloads ? `<span>⬇️ ${esc(it.downloads)}</span>` : ""}
        </div>
        <div class="desc" title="${esc(desc)}">${esc(desc)}</div>
      </div>

      <div class="actions">
        <a class="btn btnTiny" href="${iaDetails(identifier)}" target="_blank" rel="noopener">Open</a>
        <button class="btn btnTiny" data-action="embed" data-id="${esc(identifier)}">Embed</button>
        <button class="btn btnTiny" data-action="toggle" data-id="${esc(identifier)}">Preview</button>
      </div>

      <div class="embedWrap hidden" data-embed-wrap="${esc(identifier)}">
        <iframe class="embedFrame" loading="lazy" src="${iaEmbed(identifier)}" allowfullscreen></iframe>
      </div>
    `;

    grid.appendChild(card);
  }
}

async function fetchPage() {
  if (loading || exhausted) return;
  loading = true;
  loadMoreBtn.disabled = true;

  try {
    setStatus(cursor ? "Loading more…" : "Loading…");

    const u = new URL("https://archive.org/services/search/v1/scrape");
    u.searchParams.set("q", DEFAULT_QUERY);
    u.searchParams.set("fields", FIELDS.join(","));
    u.searchParams.set("sorts", SORTS.join(","));
    u.searchParams.set("count", String(PAGE_SIZE));
    if (cursor) u.searchParams.set("cursor", cursor);

    const res = await fetch(u.toString(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    // Cursor paging per docs: response includes next cursor when more items exist.
    cursor = data.cursor || null;

    // If API returns fewer than requested and no cursor, assume end.
    if (!cursor || items.length === 0) exhausted = true;

    // Deduplicate by identifier
    const seen = new Set(allItems.map(x => x.identifier));
    for (const it of items) {
      if (it && it.identifier && !seen.has(it.identifier)) {
        allItems.push(it);
        seen.add(it.identifier);
      }
    }

    setCount();
    render();

    if (allItems.length === 0) {
      setStatus("0 items. Your query may not match your uploads — see note below.");
    } else if (exhausted) {
      setStatus(`Loaded all available results (${allItems.length}).`);
    } else {
      setStatus(`Loaded ${allItems.length}.`);
    }
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}. If this is a CORS issue, run this via a tiny proxy (see note).`);
  } finally {
    loading = false;
    loadMoreBtn.disabled = false;
  }
}

function resetAndReload() {
  cursor = null;
  allItems = [];
  exhausted = false;
  setCount();
  render();
  fetchPage();
}

// ---- Events ----
searchInput.addEventListener("input", render);
typeSelect.addEventListener("change", render);

refreshBtn.addEventListener("click", resetAndReload);
loadMoreBtn.addEventListener("click", fetchPage);

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "embed") {
    embedTextarea.value = buildEmbedCode(id);
    embedDialog.showModal();
  }

  if (action === "toggle") {
    const wrap = document.querySelector(`[data-embed-wrap="${CSS.escape(id)}"]`);
    if (wrap) wrap.classList.toggle("hidden");
  }
});

copyEmbedBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(embedTextarea.value);
    copyEmbedBtn.textContent = "Copied!";
    setTimeout(() => (copyEmbedBtn.textContent = "Copy"), 900);
  } catch {
    embedTextarea.focus();
    embedTextarea.select();
    document.execCommand("copy");
  }
});

// ---- Boot ----
resetAndReload();
