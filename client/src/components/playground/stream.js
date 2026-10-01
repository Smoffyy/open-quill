import { TAB_ID } from '../../lib/api.js';
import { sseSplit } from '../../lib/playground.js';

export async function streamJobs({ jobs, groupOf, signal, fallbackError }) {
  const groups = new Map();
  for (const job of jobs) {
    const key = groupOf(job.lane);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  await Promise.all([...groups.values()].map(async (list) => {
    for (const job of list) await streamReply({ ...job, signal, fallbackError });
  }));
}

export async function streamReply({ lane, history, signal, onPatch, fallbackError }) {
  const startedAt = Date.now();
  let reply = { content: '', reasoning: '', error: '', finish: '', usage: null, request: null, progress: null, startedAt, firstAt: 0, endedAt: 0, status: 'run' };
  const paint = (patch) => { reply = { ...reply, ...patch }; onPatch(reply); };
  paint({});
  try {
    const res = await fetch('/api/admin/playground/stream', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', 'X-Oq-Tab': TAB_ID },
      body: JSON.stringify({
        modelId: lane.modelId, source: lane.source, kwargValues: lane.kwargValues, extended: lane.extended, tools: lane.tools !== false, messages: history
      })
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || fallbackError(res.status));
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const { events, rest } = sseSplit(buf + dec.decode(value, { stream: true }));
      buf = rest;
      for (const ev of events) {
        const first = reply.firstAt || Date.now();
        if (ev.type === 'start') paint({ request: ev.request });
        else if (ev.type === 'content') paint({ content: reply.content + ev.text, firstAt: first, endedAt: Date.now() });
        else if (ev.type === 'reasoning') paint({ reasoning: reply.reasoning + ev.text, firstAt: first, endedAt: Date.now() });
        else if (ev.type === 'usage') paint({ usage: ev.usage });
        else if (ev.type === 'finish') paint({ finish: ev.reason });
        else if (ev.type === 'progress') paint({ progress: { processed: ev.processed, total: ev.total } });
        else if (ev.type === 'tool') paint({ tools: [...(reply.tools || []), ev.tool] });
        else if (ev.type === 'error') paint({ error: ev.error });
      }
    }
    paint({ status: reply.error ? 'error' : 'done', endedAt: Date.now() });
  } catch (e) {
    if (e?.name === 'AbortError') paint({ status: 'stopped', endedAt: Date.now() });
    else paint({ status: 'error', error: String(e?.message || e), endedAt: Date.now() });
  }
  return reply;
}
