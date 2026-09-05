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
  if (JSON.stringify(getSetting(key, null)) === JSON.stringify(value)) delSetting(PREFIX + key);
  else setSetting(PREFIX + key, value);
}

export function draftKeys() {
  return settingKeysWithPrefix(PREFIX).map(k => k.slice(PREFIX.length));
}

export function hasDrafts() {
  return draftKeys().length > 0;
}

// Returns the live keys that changed, for the audit entry.
export function promoteDrafts() {
  const keys = draftKeys();
  for (const key of keys) {
    setSetting(key, getSetting(PREFIX + key, null));
    delSetting(PREFIX + key);
  }
  return keys;
}

// Promote exactly one key. The theme publish uses this: activating a layout
// stages ui_preset, and shipping the theme without it would leave a member
// rendering the new element rules on the old base preset. Publishing the whole
// draft namespace instead would quietly ship unrelated staged settings, which is
// the workspace Publish button's job, not this one's.
export function promoteDraft(key) {
  const staged = getSetting(PREFIX + key, undefined);
  if (staged === undefined) return false;
  setSetting(key, staged);
  delSetting(PREFIX + key);
  return true;
}

export function discardDrafts() {
  const keys = draftKeys();
  for (const key of keys) delSetting(PREFIX + key);
  return keys;
}
