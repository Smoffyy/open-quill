import { getSetting, setSetting, delSetting, settingKeysWithPrefix } from '../db.js';

// Admin edits land in a parallel namespace and only become the live value when
// the admin publishes. Every runtime read stays a plain getSetting(), so nothing
// outside this file has to know a draft exists.
const PREFIX = 'draft:';

export function draftGet(key, fallback = null) {
  const staged = getSetting(PREFIX + key, undefined);
  return staged === undefined || staged === null ? getSetting(key, fallback) : staged;
}

export function draftSet(key, value) {
  // Staging a value identical to the live one would light up the publish banner
  // for a change nobody made, so it clears the draft instead.
  if (JSON.stringify(getSetting(key, null)) === JSON.stringify(value ?? null)) delSetting(PREFIX + key);
  else setSetting(PREFIX + key, value);
}

export function draftDrop(key) {
  delSetting(PREFIX + key);
}

export function draftKeys() {
  return settingKeysWithPrefix(PREFIX).map(k => k.slice(PREFIX.length));
}