import { getSetting } from '../db.js';
import { allProvidersLocal } from '../providers.js';

export function autoTitleDefault() {
  return allProvidersLocal() ? '1' : '0';
}

export function autoTitleEnabled() {
  return getSetting('auto_title_enabled', autoTitleDefault()) === '1';
}
