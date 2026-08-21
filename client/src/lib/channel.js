import { t, tk } from '../i18n.jsx';
import { formatVersion, capitalize } from './appversion.js';

// The channels that have a proper name in the UI. Anything else is shown as it was
// written, capitalized, so naming a release "cascade" or "preview" needs no code
// change: it renders as "27.2.0 Cascade 2" without an entry here.
const CHANNEL_LABELS = { __proto__: null, rc: tk('Release candidate'), beta: tk('Beta'), alpha: tk('Alpha'), dev: tk('Development'), preview: tk('Preview') };

export function channelLabel(channel) {
  if (!channel) return '';
  const known = CHANNEL_LABELS[String(channel).toLowerCase()];
  return known ? t(known) : capitalize(channel);
}

export function displayVersion(v) {
  return formatVersion(v, channelLabel);
}
