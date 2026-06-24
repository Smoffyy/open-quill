import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from './db.js';
import { resolveProvider, providerSpec } from './providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MODELS_DIR = path.join(__dirname, 'data', 'models');

export function getConfig() {
  const c = getSetting('embedding_config', {}) || {};
  return {
    mode: c.mode === 'local' ? 'local' : 'api',
    providerId: c.providerId || null,
    model: c.model || '',
    localModel: c.localModel || 'nomic-ai/nomic-embed-text-v2-moe',
    normalize: c.normalize !== false
  };
}
export function setConfig(patch) {
  const cur = getConfig();
  const next = {
    mode: patch.mode === 'local' ? 'local' : (patch.mode === 'api' ? 'api' : cur.mode),
    providerId: 'providerId' in patch ? (patch.providerId || null) : cur.providerId,
    model: 'model' in patch ? String(patch.model || '').trim() : cur.model,
    localModel: 'localModel' in patch ? String(patch.localModel || '').trim() : cur.localModel,
    normalize: 'normalize' in patch ? !!patch.normalize : cur.normalize
  };
  if (!next.localModel) next.localModel = 'nomic-ai/nomic-embed-text-v2-moe';
  setSetting('embedding_config', next);
  return next;
}

let TRANSFORMERS = null;
let transformersError = null;
async function loadTransformers() {
  if (TRANSFORMERS) return TRANSFORMERS;
  if (transformersError) throw transformersError;
  let mod = null;
  for (const pkg of ['@huggingface/transformers', '@xenova/transformers']) {
    try { mod = await import(pkg); break; } catch {}
  }
  if (!mod) {
    transformersError = new Error('Local embeddings require the "@huggingface/transformers" package. Install it in server/ with: npm install @huggingface/transformers');
    throw transformersError;
  }
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    mod.env.cacheDir = MODELS_DIR;
    mod.env.allowRemoteModels = true;
    TRANSFORMERS = mod;
    return mod;
  } catch (e) {
    transformersError = new Error('Failed to initialize local embeddings: ' + String(e.message || e));
    throw transformersError;
  }
}

const pipelines = new Map();
async function localPipeline(modelName) {
  if (pipelines.has(modelName)) return pipelines.get(modelName);
  const t = await loadTransformers();
  const p = t.pipeline('feature-extraction', modelName);
  pipelines.set(modelName, p);
  return p;
}

export async function localAvailable() {
  try { await loadTransformers(); return { available: true }; }
  catch (e) { return { available: false, error: String(e.message || e) }; }
}

export function isModelDownloaded(modelName) {
  try {
    const safe = String(modelName || '').replace(/[^a-zA-Z0-9_./-]/g, '');
    return fs.existsSync(path.join(MODELS_DIR, safe));
  } catch { return false; }
}

async function embedApi(texts, cfg) {
  const prov = resolveProvider(cfg.providerId);
  if (!prov) return { ok: false, error: 'No provider selected for API embeddings.' };
  if (!cfg.model) return { ok: false, error: 'No embedding model name set.' };
  const { base, key } = providerSpec(prov);
  const res = await fetch(base.replace(/\/$/, '') + '/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: cfg.model, input: texts })
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `Provider returned ${res.status}: ${t.slice(0, 200)}` }; }
  const json = await res.json().catch(() => ({}));
  const data = Array.isArray(json.data) ? json.data : [];
  const vectors = data.map(d => d.embedding).filter(Array.isArray);
  if (!vectors.length) return { ok: false, error: 'Provider response had no embeddings.' };
  return { ok: true, vectors, dim: vectors[0].length, model: cfg.model, source: 'api' };
}

async function embedLocal(texts, cfg) {
  let pipe;
  try { pipe = await localPipeline(cfg.localModel); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
  try {
    const out = await pipe(texts, { pooling: 'mean', normalize: cfg.normalize });
    const arr = out.tolist ? out.tolist() : out;
    const vectors = Array.isArray(arr[0]) ? arr : [arr];
    return { ok: true, vectors, dim: vectors[0]?.length || 0, model: cfg.localModel, source: 'local' };
  } catch (e) { return { ok: false, error: 'Local embedding failed: ' + String(e.message || e) }; }
}

export async function embed(input) {
  const texts = Array.isArray(input) ? input.map(String) : [String(input)];
  if (!texts.length) return { ok: false, error: 'No input text.' };
  const cfg = getConfig();
  return cfg.mode === 'local' ? embedLocal(texts, cfg) : embedApi(texts, cfg);
}

export async function status() {
  const cfg = getConfig();
  const loc = await localAvailable();
  return {
    ...cfg,
    localPackageAvailable: loc.available,
    localPackageError: loc.available ? null : loc.error,
    localModelDownloaded: cfg.mode === 'local' ? isModelDownloaded(cfg.localModel) : false,
    modelsDir: MODELS_DIR
  };
}

export async function test(text) {
  const r = await embed([String(text || 'The quick brown fox.')]);
  if (!r.ok) return r;
  const v = r.vectors[0] || [];
  return { ok: true, dim: r.dim, model: r.model, source: r.source, sample: v.slice(0, 8).map(x => Math.round(x * 10000) / 10000) };
}
