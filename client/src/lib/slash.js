export function slashState(value) {
  if (!value.startsWith('/') || value.includes('\n')) return null;
  const raw = value.slice(1);
  const space = raw.indexOf(' ');
  if (space < 0) return { word: raw.toLowerCase(), rest: null };
  return { word: raw.slice(0, space).toLowerCase(), rest: raw.slice(space + 1).trim().toLowerCase() };
}

export function matchSlash(cmds, value) {
  const state = slashState(value);
  if (!state) return { parent: null, items: [] };
  if (state.rest !== null) {
    const parent = cmds.find(c => c.items && c.word === state.word);
    if (!parent) return { parent: null, items: [] };
    return { parent, items: parent.items.filter(i => i.label.toLowerCase().includes(state.rest)) };
  }
  return { parent: null, items: cmds.filter(c => c.word.startsWith(state.word) || c.label.toLowerCase().includes(state.word)) };
}