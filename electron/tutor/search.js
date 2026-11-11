// App-owned search works with every tutor engine, including plain-text APIs.
// Search excerpts are untrusted reference material, never tutor instructions.
const UA = "MyLecture/2.0 (educational desktop app; https://github.com/touhid314/mylecture)";

export function plainText(html) {
  return String(html).replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity.startsWith("#")) {
      const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity.toLowerCase()];
  }).replace(/\s+/g, " ").trim();
}

export function searchResults(html) {
  const results = [];
  const re = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b[^>]*class="[^"]*\bresult__a\b|$)/gi;
  for (const m of html.matchAll(re)) {
    try {
      const link = new URL(plainText(m[1]), "https://duckduckgo.com");
      const url = new URL(link.searchParams.get("uddg") || link.href);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || /(^|\.)duckduckgo\.com$/.test(url.hostname)) continue;
      const title = plainText(m[2]).slice(0, 200);
      const snippet = plainText(m[3].match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i)?.[1] || "").slice(0, 900);
      if (title && !results.some((r) => r.url === url.href)) results.push({ title, url: url.href, snippet });
      if (results.length === 5) break;
    } catch {}
  }
  return results;
}

export async function searchWeb(query, { signal, fetcher = fetch } = {}) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!q) throw new Error("A search query is required.");
  const res = await fetcher(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Web search returned HTTP ${res.status}.`);
  const results = searchResults(await res.text());
  if (!results.length) throw new Error("Web search returned no usable results. Try a different query or try again later.");
  return { query: q, retrieved: new Date().toISOString(), results };
}
