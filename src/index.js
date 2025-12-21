export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // /resolve?identifier=<ia_identifier>
    if (url.pathname !== "/resolve") {
      return json({ ok: false, error: "Use /resolve?identifier=<ia_identifier>" }, 404);
    }

    const identifier = (url.searchParams.get("identifier") || "").trim();
    if (!identifier) return json({ ok: false, error: "Missing identifier" }, 400);

    const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
    const metaRes = await fetch(metaUrl, { headers: { Accept: "application/json" } });

    if (!metaRes.ok) {
      return json({ ok: false, error: `IA metadata HTTP ${metaRes.status}` }, 502);
    }

    const meta = await metaRes.json();
    const server = meta?.server;
    const dir = meta?.dir;
    const files = Array.isArray(meta?.files) ? meta.files : [];

    if (!server || !dir || !files.length) {
      return json({ ok: false, error: "No files/server/dir found on IA metadata" }, 502);
    }

    const pick = pickBestFile(files);
    const directUrl = pick?.name
      ? `https://${server}${dir}/${encodeURIComponent(pick.name)}`
      : "";

    const detailsUrl = `https://archive.org/details/${encodeURIComponent(identifier)}`;
    const thumbUrl = `https://archive.org/services/img/${encodeURIComponent(identifier)}`;

    return json({
      ok: true,
      identifier,
      title: meta?.metadata?.title || identifier,
      description: String(meta?.metadata?.description || ""),
      detailsUrl,
      thumbUrl,
      directUrl,
      fileName: pick?.name || "",
      fileExt: pick?.ext || "",
      fileType: pick?.type || "other",
      size: pick?.size || null
    });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function pickBestFile(files) {
  const badExt = new Set(["srt","vtt","nfo","txt","json","xml","md","log","jpg","jpeg","png","gif","webp","avif","svg"]);
  const playableFirst = ["mp4","webm","m4v","mov","ogv"];
  const videoNext = ["mkv","avi"];
  const audio = ["mp3","m4a","ogg","flac","wav"];

  const candidates = files
    .filter(f => f && typeof f.name === "string")
    .map(f => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const size = Number(f.size || 0) || 0;
      let type = "other";
      if ([...playableFirst, ...videoNext].includes(ext)) type = "video";
      else if (audio.includes(ext)) type = "audio";
      return { name: f.name, ext, size, source: String(f.source || "").toLowerCase(), type };
    })
    .filter(x => x.ext && !badExt.has(x.ext));

  const score = (x) => {
    let s = 0;
    if (x.source === "original") s += 20;
    const iP = playableFirst.indexOf(x.ext);
    const iV = videoNext.indexOf(x.ext);
    const iA = audio.indexOf(x.ext);
    if (iP !== -1) s += 200 - iP * 5;
    else if (iV !== -1) s += 140 - iV * 5;
    else if (iA !== -1) s += 120 - iA * 5;
    if (x.size > 0) s += Math.min(30, Math.log10(x.size) * 4);
    if (/thumb|thumbnail|poster|cover/i.test(x.name)) s -= 50;
    return s;
  };

  candidates.sort((a,b) => score(b) - score(a));
  return candidates[0] || null;
}
