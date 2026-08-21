// How a version string is read and shown. The wire format is the npm version
// verbatim, which is also the git tag and the GitHub release title: "27.1.0",
// "27.1.0-beta.3", "27.1.0-cascade.2". Never prefixed with "v".
//
// Import-free on purpose, so node --test can cover it. The translated channel
// wording lives in lib/channel.js, which layers i18n on top of formatVersion.

// The prerelease tail is whatever the release was named, not a fixed vocabulary:
// beta, rc, alpha, dev, preview, cascade, developer. Anything alphabetic is a
// channel and anything numeric after it is the build. Written this way so a
// channel nobody has thought of yet still renders as words and a number rather
// than as raw punctuation.
function splitTail(rest) {
  const parts = rest.split(/[.\-_]/).filter(Boolean);
  let channel = '';
  const build = [];
  for (const p of parts) {
    if (!channel) {
      // "beta", and also "rc1" and "beta3", where the number is glued on.
      const m = /^([A-Za-z]+)(\d+)?$/.exec(p);
      if (m) { channel = m[1]; if (m[2]) build.push(m[2]); continue; }
    }
    build.push(p);
  }
  return { channel, build: build.join('.') };
}

export function parseVersion(v) {
  // A stray "v" is tolerated on the way in and dropped, so a build tagged the old
  // way still displays consistently. Nothing this app produces should carry one.
  const s = String(v || '').trim().replace(/^v(?=\d)/i, '');
  if (!s) return null;
  const core = s.split('+')[0];               // "+build" metadata is not shown
  const i = core.indexOf('-');
  const base = i === -1 ? core : core.slice(0, i);
  const rest = i === -1 ? '' : core.slice(i + 1);
  const { channel, build } = rest ? splitTail(rest) : { channel: '', build: '' };
  const year = (base.match(/^(\d{4})/) || [])[1] || '';
  return { full: s, base, channel, build, year };
}

export function capitalize(word) {
  const s = String(word || '');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// The human form, for places that show a version inline rather than in a labelled
// field: "27.1.0-beta.3" reads as "27.1.0 Beta 3", "27.1.0" stays "27.1.0".
// labelFor translates the channel word; without one it is simply capitalized.
export function formatVersion(v, labelFor = capitalize) {
  const p = parseVersion(v);
  if (!p) return '';
  return [p.base, p.channel ? labelFor(p.channel) : '', p.build].filter(Boolean).join(' ');
}
