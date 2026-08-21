export const clients = new Map(); // ws -> {userId, abort}

export function requestedKwargs(msg) {
  const out = {};
  if (msg && typeof msg.reasoningEffort === 'string' && msg.reasoningEffort) out.effort = msg.reasoningEffort;
  if (msg && msg.kwargValues && typeof msg.kwargValues === 'object') {
    for (const k of Object.keys(msg.kwargValues)) {
      const v = msg.kwargValues[k];
      if (v == null) continue;
      out[String(k).slice(0, 40)] = String(v).slice(0, 200);
    }
  }
  return out;
}

function send(ws, msg) { if (ws.readyState !== 1) return; try { ws.send(msg); } catch {} }

export function broadcastConfig() {
  const msg = JSON.stringify({ type: 'config' });
  for (const ws of clients.keys()) send(ws, msg);
}

// notify only admin sessions to refresh their draft view (live editing)
export function broadcastAdminConfig() {
  const msg = JSON.stringify({ type: 'config' });
  for (const [ws, st] of clients.entries()) if (st.isAdmin) send(ws, msg);
}

export function killSessionSockets(sessionId) {
  if (!sessionId) return;
  const msg = JSON.stringify({ type: 'session_revoked' });
  for (const [ws, st] of clients.entries()) {
    if (st.sessionId === sessionId) {
      try { for (const c of st.aborts.values()) c.abort(); } catch {}
      try { if (ws.readyState === 1) ws.send(msg); } catch {}
      try { ws.close(); } catch {}
    }
  }
}

export function broadcastToUser(userId, payload) {
  const msg = JSON.stringify(payload);
  for (const [sock, st] of clients.entries()) if (st.userId === userId) send(sock, msg);
}
