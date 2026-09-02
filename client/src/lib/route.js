// URL to view, as a pure function. Deciding which screen a path means used to be
// tangled up with the setState calls that opened it, so the rules could only be
// checked by clicking. They are separated here: parseRoute answers "what does
// this path mean", App does the opening.

// Admin-only views are resolved against the viewer, because a member landing on
// /admin must be sent home rather than shown a screen that fails to load.
const ADMIN_ONLY = new Set(['admin', 'playground']);

export function parseRoute(pathname, opts = {}) {
  const p = String(pathname || '/');
  const isAdmin = !!opts.isAdmin;

  const named = (
    /^\/admin(\/|$)/.test(p) ? 'admin' :
    /^\/playground(\/|$)/.test(p) ? 'playground' :
    /^\/spaces(\/|$)/.test(p) ? 'spaces' :
    null
  );
  if (named) {
    if (ADMIN_ONLY.has(named) && !isAdmin) return { view: 'home', replace: '/' };
    return { view: named };
  }

  const project = p.match(/^\/project\/(.+)$/);
  if (project) return { view: 'project', id: decodeStrict(project[1]) };
  if (/^\/projects(\/|$)/.test(p)) return { view: 'projects', id: null };

  const chat = p.match(/^\/chat\/(.+)$/);
  if (chat) return { view: 'chat', id: decodeStrict(chat[1]) };

  return { view: 'home' };
}

// A hand-edited URL can carry a stray percent, and decodeURIComponent throws on
// it. The raw segment is a better answer than a crash.
function decodeStrict(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// The paths a view is allowed to sit on. Leaving one of these screens returns to
// "/" only when the URL still points at the screen being closed — otherwise the
// user has already navigated somewhere else and rewriting it would undo that.
const OWNS = {
  admin: /^\/admin(\/|$)/,
  playground: /^\/playground(\/|$)/,
  spaces: /^\/spaces(\/|$)/,
  projects: /^\/projects?(\/|$)|^\/project\//
};

export function shouldResetPath(view, pathname) {
  const re = OWNS[view];
  return !!re && re.test(String(pathname || ''));
}

export function pathForChat(id) { return '/chat/' + id; }
export function pathForProject(id) { return id ? '/project/' + id : '/projects'; }
