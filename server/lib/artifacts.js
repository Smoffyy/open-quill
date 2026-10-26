import * as sandbox from '../sandbox.js';
import { copyFiles } from './workspacefiles.js';
import { artifactName } from './artifactname.js';

export const ARTIFACT_TOOLS = new Set(['artifact', 'artifact_edit', 'artifact_read']);
export const ARTIFACT_MAX_BYTES = 512 * 1024;
export const ARTIFACT_LIMIT = 40;

const INLINE_BUDGET = 30000;
const INLINE_FILE_MAX = 12000;

export function listArtifacts(chatId) {
  try { return sandbox.list(sandbox.artifactKey(chatId)); } catch { return []; }
}

export function runArtifactTool(chatId, call) {
  const n = artifactName(call.name ?? call.path);
  if (!n.ok) return { ok: false, error: n.error };
  const key = sandbox.artifactKey(chatId);
  const existing = listArtifacts(chatId);
  const exists = existing.some(f => f.path === n.name);
  if (call.tool === 'artifact_read') {
    if (!exists) return { ok: false, error: `There is no artifact called ${n.name}.` };
    const text = sandbox.readText(key, n.name) ?? '';
    return { ok: true, name: n.name, content: text, v: sandbox.versionOf(key, n.name) };
  }
  if (call.tool === 'artifact_edit') {
    if (!exists) return { ok: false, error: `There is no artifact called ${n.name}. Create it with artifact first.` };
    if (!call.old_str) return { ok: false, error: 'old_str is required: the exact passage to replace. To rewrite the whole artifact, use artifact.' };
    const r = sandbox.strReplace(key, n.name, call.old_str, call.new_str ?? '');
    return { ...r, name: n.name };
  }
  const content = call.content ?? call.text;
  if (content == null) return { ok: false, error: 'content is required: the complete text of the artifact.' };
  const body = String(content);
  if (Buffer.byteLength(body, 'utf8') > ARTIFACT_MAX_BYTES) return { ok: false, error: `An artifact can be at most ${ARTIFACT_MAX_BYTES / 1024} KB. Split it into several artifacts.` };
  if (!exists && existing.length >= ARTIFACT_LIMIT) return { ok: false, error: `This chat already has ${ARTIFACT_LIMIT} artifacts. Replace one of them instead of adding another.` };
  const r = sandbox.createFile(key, n.name, body);
  return { ...r, name: n.name };
}

export function artifactPayload(call, r) {
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  for (const k of ['name', 'v', 'bytes', 'adds', 'dels']) if (r[k] != null) o[k] = r[k];
  if (r.unchanged) o.unchanged = true;
  return o;
}

export function formatArtifactResult(call, r) {
  if (!r.ok) return `${call.tool} ${r.name || call.name || ''} → ERROR: ${r.error}`;
  if (call.tool === 'artifact_read') return `artifact_read ${r.name} (v${r.v}) →\n${r.content}`;
  if (r.unchanged) return `${call.tool} ${r.name} → unchanged (already v${r.v}, identical content)`;
  return `${call.tool} ${r.name} → saved as v${r.v} (+${r.adds ?? 0}/-${r.dels ?? 0}). The user sees it in the artifacts panel; do not paste it into your reply.`;
}

export function artifactsText(chatId) {
  const files = listArtifacts(chatId);
  if (!files.length) return '(none yet)';
  const key = sandbox.artifactKey(chatId);
  let budget = INLINE_BUDGET;
  const out = [];
  for (const f of files) {
    const text = sandbox.readText(key, f.path) ?? '';
    if (text.length > INLINE_FILE_MAX || text.length > budget) {
      out.push(`### ${f.path} (v${f.v}, ${f.size} bytes, too long to show here; read it with artifact_read before editing)`);
      continue;
    }
    budget -= text.length;
    out.push(`### ${f.path} (v${f.v})\n\`\`\`${f.ext || ''}\n${text}\n\`\`\``);
  }
  return out.join('\n\n');
}

export function copyArtifacts(fromChatId, toChatId) {
  return copyFiles(sandbox.artifactKey(fromChatId), sandbox.artifactKey(toChatId));
}

export function removeArtifacts(chatId) {
  try { sandbox.remove(sandbox.artifactKey(chatId)); } catch {}
}