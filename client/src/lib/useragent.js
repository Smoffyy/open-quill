const BROWSERS = [[/edg/i, 'Edge'], [/chrome|crios/i, 'Chrome'], [/firefox|fxios/i, 'Firefox'], [/safari/i, 'Safari']];
const SYSTEMS = [[/windows/i, 'Windows'], [/android/i, 'Android'], [/iphone|ipad|ios/i, 'iOS'], [/mac os|macintosh/i, 'macOS'], [/linux/i, 'Linux']];

const pick = (list, ua) => {
  const s = String(ua || '');
  const hit = list.find(([re]) => re.test(s));
  return hit ? hit[1] : null;
};

export const browserName = (ua) => pick(BROWSERS, ua);
export const systemName = (ua) => pick(SYSTEMS, ua);
