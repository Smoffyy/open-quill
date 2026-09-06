import { t, tk } from '../i18n.jsx';
import { formatVersion, capitalize } from './appversion.js';

const CHANNEL_LABELS = { __proto__: null, rc: tk('Release candidate'), beta: tk('Beta'), alpha: tk('Alpha'), dev: tk('Development'), preview: tk('Preview') };

export function channelLabel(channel) {
  if (!channel) return '';
  const known = CHANNEL_LABELS[String(channel).toLowerCase()];
  return known ? t(known) : capitalize(channel);
}

export function displayVersion(v) {
  return formatVersion(v, channelLabel);
}
