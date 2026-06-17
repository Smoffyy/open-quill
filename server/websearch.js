import { getSetting } from './db.js';

export function webSearchConfig() {
  let domains = [];
  try { const d = JSON.parse(getSetting('web_search_domains', '[]')); if (Array.isArray(d)) domains = d; } catch {}
  return {
    enabled: getSetting('web_search_enabled', '0') === '1',
    engine: getSetting('web_search_engine', 'searxng'),
    url: (getSetting('searxng_url', '') || '').trim().replace(/\/$/, ''),
    count: Math.max(1, Math.min(20, parseInt(getSetting('web_search_count', '5')) || 5)),
    domains,
    prompt: getSetting('web_search_prompt', DEFAULT_WS_PROMPT)
  };
}

export const DEFAULT_WS_PROMPT = `You have access to a web_search tool that fetches live results from the internet. Only use it when the user explicitly asks you to look something up, or when answering accurately requires information that is not in your training data or may be out of date (for example recent events, current prices, release dates, or niche facts you are unsure about). Do not search for things you already know with confidence.

Before each web_search call, first tell the user in one short natural sentence what you are about to look up. For example "I'll look for the latest iPhone release date." or "Let me search for current pricing on that." Then emit the tool call. You may call the tool more than once in a single response to follow up or refine a query, announcing each search the same way. After searching, base your answer on the retrieved pages and cite the source URLs you relied on.`;

export function webSearchAvailable() {
  const c = webSearchConfig();
  return c.enabled && !!c.url;
}

export function webSearchToolPrompt() {
  return `## Web search tool
When web search is enabled you can run searches by emitting a fenced \`tool\` block. Each block is a single JSON object. Run a search like this:

\`\`\`tool
{"tool": "web_search", "query": "your search query", "count": 5}
\`\`\`

After each block, wait for the tool results (provided back to you as page contents with their URLs), then continue. "count" is optional and capped by the server. Keep queries focused; issue multiple searches if needed.`;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n)); } catch { return ' '; } });
  s = s.replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^[ \t]+/gm, '').trim();
  return s;
}

async function fetchTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

const MAX_PAGE_CHARS = 100000;
async function ingestPage(url) {
  try {
    const r = await fetchTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenQuillBot/1.0)', 'Accept': 'text/html,application/xhtml+xml' } }, 15000);
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/text\/html|text\/plain|application\/xhtml/.test(ct)) return { text: '', chars: 0, truncated: false };
    const html = await r.text();
    const full = ct.includes('html') ? htmlToText(html) : html.trim();
    const truncated = full.length > MAX_PAGE_CHARS;
    return { text: truncated ? full.slice(0, MAX_PAGE_CHARS) : full, chars: full.length, truncated };
  } catch { return { text: '', chars: 0, truncated: false }; }
}

export async function runWebSearch(call) {
  const cfg = webSearchConfig();
  if (!cfg.enabled) return { ok: false, error: 'Web search is disabled.' };
  if (!cfg.url) return { ok: false, error: 'No search engine URL configured.' };
  const query = String(call.query || '').trim();
  if (!query) return { ok: false, error: 'Empty query.' };
  const want = Math.max(1, Math.min(cfg.count, parseInt(call.count) || cfg.count));
  try {
    const sUrl = `${cfg.url}/search?q=${encodeURIComponent(query)}&format=json`;
    const r = await fetchTimeout(sUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'OpenQuillBot/1.0' } }, 12000);
    if (!r.ok) return { ok: false, error: `Search engine returned ${r.status}.` };
    const data = await r.json().catch(() => ({}));
    let hits = Array.isArray(data.results) ? data.results : [];
    if (cfg.domains.length) hits = hits.filter(h => { const host = hostOf(h.url); return cfg.domains.some(d => host === d || host.endsWith('.' + d)); });
    hits = hits.slice(0, want);
    const results = await Promise.all(hits.map(async (h) => {
      const page = await ingestPage(h.url);
      return { title: h.title || h.url, url: h.url, snippet: (h.content || '').slice(0, 400), content: page.text, chars: page.chars, truncated: page.truncated };
    }));
    return { ok: true, query, count: results.length, results };
  } catch (e) {
    return { ok: false, error: 'Search failed: ' + String(e.message || e).slice(0, 200) };
  }
}

export function webSearchResultPayload(call, r) {
  if (!r || !r.ok) return { ok: false, error: r?.error || 'Search failed' };
  return { ok: true, count: r.count, results: (r.results || []).map(x => ({ title: x.title, url: x.url, chars: x.chars || 0 })) };
}

export function formatWebSearchResult(call, r) {
  if (!r || !r.ok) return `web_search "${call.query}" → ERROR: ${r?.error || 'failed'}`;
  if (!r.results.length) return `web_search "${call.query}" → no results found.`;
  const blocks = r.results.map((x, i) => `[${i + 1}] ${x.title}\nURL: ${x.url}\nPage text (${x.chars} chars${x.truncated ? ', truncated' : ', full page'}):\n${x.content || x.snippet || '(no extractable content)'}`);
  return `web_search "${call.query}" → ${r.count} result(s):\n\n${blocks.join('\n\n---\n\n')}`;
}
