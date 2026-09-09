import { useEffect, useState } from 'react';
import { api } from '../api.js';

const ALIASES = {
  __proto__: null,
  'llama.cpp': 'llamacpp',
  qwq: 'qwen', qvq: 'qwen', tongyi: 'qwen', alibaba: 'qwen',
  claude: 'anthropic',
  palm: 'google', bard: 'google',
  gpt: 'openai', codex: 'openai', o1: 'openai', o3: 'openai', o4: 'openai',
  llama: 'meta', codellama: 'meta', llamaguard: 'meta',
  mixtral: 'mistral', codestral: 'mistral', devstral: 'mistral',
  magistral: 'mistral', ministral: 'mistral', pixtral: 'mistral',
  glm: 'zai', chatglm: 'zai',
  kimi: 'moonshot',
  grok: 'xai',
  'lm studio': 'lmstudio',
  phi: 'microsoft', nemotron: 'nvidia', command: 'cohere',
  lfm: 'liquid', solar: 'upstage', arctic: 'snowflake', cogito: 'deepcogito'
};

const normalize = (s) => String(s == null ? '' : s).toLowerCase();
const isColor = (file) => /-color\.svg$/i.test(file);
const slugOf = (file) => file.replace(/\.svg$/i, '').replace(/-color$/i, '').toLowerCase();

const SEP = /[._\s-]+/g;
const squash = (s) => s.replace(SEP, '');

const patterns = new Map();
function patternFor(keyword) {
  let re = patterns.get(keyword);
  if (!re) {
    const body = keyword.split(SEP).filter(Boolean)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[._\\s-]*');
    re = new RegExp('(^|[^a-z])' + body + '($|[^a-z])');
    patterns.set(keyword, re);
  }
  return re;
}

export function mentions(text, keyword) {
  return patternFor(keyword).test(text);
}

function filesBySlug(files) {
  const out = new Map();
  for (const f of files) {
    if (!/\.svg$/i.test(f)) continue;
    const slug = slugOf(f);
    const key = squash(slug);
    if (!out.has(key) || isColor(f)) out.set(key, { file: f, slug });
  }
  return out;
}

export function logoFor(text, files) {
  if (!Array.isArray(files) || !files.length) return null;
  if (Array.isArray(text)) {
    for (const one of text) {
      const hit = logoFor(one, files);
      if (hit) return hit;
    }
    return null;
  }
  const s = normalize(text);
  if (!s) return null;

  const bySlug = filesBySlug(files);
  let best = null;
  const consider = (keyword, key) => {
    if (best && keyword.length <= best.keyword.length) return;
    if (mentions(s, keyword)) best = { keyword, key };
  };
  for (const [key, entry] of bySlug) consider(entry.slug, key);
  for (const keyword of Object.keys(ALIASES)) consider(keyword, squash(ALIASES[keyword]));

  const hit = best && bySlug.get(best.key);
  return hit ? { src: '/assets/' + hit.file, color: isColor(hit.file) } : null;
}

export function modelIconFor(name, files) {
  const hit = logoFor(name, files);
  return hit ? hit.src : null;
}

let manifest = null;

export function useLogos() {
  const [files, setFiles] = useState(() => (Array.isArray(manifest) ? manifest : []));
  useEffect(() => {
    if (Array.isArray(manifest)) return undefined;
    if (!manifest) {
      manifest = api.get('/api/admin/logos')
        .then(r => (manifest = Array.isArray(r?.logos) ? r.logos : []))
        .catch(() => (manifest = []));
    }
    let live = true;
    Promise.resolve(manifest).then(list => { if (live) setFiles(list); });
    return () => { live = false; };
  }, []);
  return files;
}
