export function computeActiveBg(models, currentId, activeId, messagesLen, incognito, prefs) {
  const m = models.find(x => x.id === currentId);
  const isEmpty = !activeId && messagesLen === 0;
  const inChat = prefs?.modelBgInChat !== false;
  const has = !incognito && !!(m?.bgEnabled && m?.bgImage);
  return has && (isEmpty || inChat) ? m.bgImage : null;
}
