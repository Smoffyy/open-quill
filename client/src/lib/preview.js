const EXTERNAL_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;
const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/g;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;
const MODULE_SPEC_RE = /(\bfrom\s+|\bimport\s+|\bimport\s*\(\s*)(['"])([^'"\n]+)\2/g;
const SCRIPT_CLOSE_RE = /<\/(script)/gi;

const MIME = {
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  json: 'application/json', map: 'application/json', html: 'text/html', htm: 'text/html',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', vtt: 'text/vtt'
};

const MAX_CSS_DEPTH = 5;
const MAX_MODULE_DEPTH = 12;

const BOOTSTRAP = [
  '(function(){',
  'function mk(){var m=Object.create(null);return{',
  'getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},',
  'setItem:function(k,v){m[String(k)]=String(v)},',
  'removeItem:function(k){delete m[String(k)]},',
  'clear:function(){m=Object.create(null)},',
  'key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null},',
  'get length(){return Object.keys(m).length}};}',
  'var names=["localStorage","sessionStorage"];',
  'for(var i=0;i<names.length;i++){var n=names[i],ok=false;',
  'try{var s=window[n];if(s){s.getItem("__oq_probe");ok=true;}}catch(e){ok=false;}',
  'if(!ok){try{Object.defineProperty(window,n,{value:mk(),configurable:true,writable:true});}catch(e){}}}',
  '})();'
].join('');

function extOf(p) { return (String(p).split('.').pop() || '').toLowerCase(); }

function dirOf(p) {
  const i = String(p).lastIndexOf('/');
  return i === -1 ? '' : String(p).slice(0, i);
}

function isLocalRef(ref) {
  if (ref == null) return false;
  const r = String(ref).trim();
  if (!r || r[0] === '#') return false;
  return !EXTERNAL_RE.test(r);
}

function resolvePath(baseDir, ref) {
  let r = String(ref).trim();
  const cut = r.search(/[?#]/);
  if (cut !== -1) r = r.slice(0, cut);
  if (!r) return null;
  const parts = r[0] === '/' ? r.slice(1).split('/') : (baseDir ? baseDir.split('/') : []).concat(r.split('/'));
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function dataUrlFromText(text, mime) {
  return 'data:' + mime + ';base64,' + toBase64(text);
}

function blobToDataUrl(blob, mime) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      const comma = s.indexOf(',');
      resolve(comma === -1 ? s : 'data:' + mime + ';base64,' + s.slice(comma + 1));
    };
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

async function replaceAsync(str, re, fn) {
  const parts = [];
  const jobs = [];
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(str))) {
    parts.push(str.slice(last, m.index), null);
    jobs.push(Promise.resolve(fn(m)));
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (!jobs.length) return str;
  parts.push(str.slice(last));
  const done = await Promise.all(jobs);
  let k = 0;
  return parts.map(p => (p === null ? done[k++] : p)).join('');
}

function makeLoader(chatId) {
  const cache = new Map();
  return (path, kind) => {
    const key = kind + '\u0000' + path;
    if (!cache.has(key)) {
      const url = '/api/chats/' + encodeURIComponent(chatId) + '/download?path=' + encodeURIComponent(path);
      const job = fetch(url, { credentials: 'same-origin' })
        .then(res => {
          if (!res.ok) return null;
          return res.blob().then(blob => {
            if (kind === 'text') return blob.text();
            return blobToDataUrl(blob, MIME[extOf(path)] || blob.type || 'application/octet-stream');
          });
        })
        .catch(() => null);
      cache.set(key, job);
    }
    return cache.get(key);
  };
}

async function inlineCss(css, baseDir, load, depth) {
  let out = String(css || '');
  if (depth < MAX_CSS_DEPTH) {
    out = await replaceAsync(out, IMPORT_RE, async (m) => {
      const ref = m[2] || m[4];
      const media = (m[5] || '').trim();
      if (!isLocalRef(ref)) return m[0];
      const target = resolvePath(baseDir, ref);
      if (!target) return m[0];
      const text = await load(target, 'text');
      if (text == null) return m[0];
      const nested = await inlineCss(text, dirOf(target), load, depth + 1);
      return media ? '@media ' + media + '{' + nested + '}' : nested;
    });
  }
  out = await replaceAsync(out, CSS_URL_RE, async (m) => {
    const ref = m[2];
    if (!isLocalRef(ref)) return m[0];
    const target = resolvePath(baseDir, ref);
    if (!target) return m[0];
    const data = await load(target, 'binary');
    return data == null ? m[0] : 'url("' + data + '")';
  });
  return out;
}

async function inlineModule(path, load, depth, stack) {
  if (depth > MAX_MODULE_DEPTH || stack.has(path)) return null;
  const code = await load(path, 'text');
  if (code == null) return null;
  stack.add(path);
  const baseDir = dirOf(path);
  const out = await replaceAsync(code, MODULE_SPEC_RE, async (m) => {
    const ref = m[3];
    if (!isLocalRef(ref)) return m[0];
    const target = resolvePath(baseDir, ref);
    if (!target) return m[0];
    const nested = await inlineModule(target, load, depth + 1, stack);
    if (nested == null) return m[0];
    return m[1] + m[2] + dataUrlFromText(nested, 'text/javascript') + m[2];
  });
  stack.delete(path);
  return out;
}

function safeScriptText(code) {
  return String(code).replace(SCRIPT_CLOSE_RE, '<\\/$1');
}

async function inlineStyles(doc, baseDir, load) {
  const jobs = [];
  for (const link of doc.querySelectorAll('link[href]')) {
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (!rel.split(/\s+/).includes('stylesheet')) continue;
    const href = link.getAttribute('href');
    if (!isLocalRef(href)) continue;
    const target = resolvePath(baseDir, href);
    if (!target) continue;
    jobs.push((async () => {
      const text = await load(target, 'text');
      if (text == null) return;
      const style = doc.createElement('style');
      const media = link.getAttribute('media');
      if (media) style.setAttribute('media', media);
      style.textContent = await inlineCss(text, dirOf(target), load, 0);
      link.replaceWith(style);
    })());
  }
  for (const style of doc.querySelectorAll('style')) {
    const text = style.textContent || '';
    if (!text.includes('url(') && !text.includes('@import')) continue;
    jobs.push(inlineCss(text, baseDir, load, 0).then(css => { style.textContent = css; }));
  }
  for (const el of doc.querySelectorAll('[style]')) {
    const text = el.getAttribute('style') || '';
    if (!text.includes('url(')) continue;
    jobs.push(inlineCss(text, baseDir, load, MAX_CSS_DEPTH).then(css => { el.setAttribute('style', css); }));
  }
  await Promise.all(jobs);
}

async function inlineScripts(doc, baseDir, load) {
  const jobs = [];
  for (const el of doc.querySelectorAll('script[src]')) {
    const src = el.getAttribute('src');
    if (!isLocalRef(src)) continue;
    const target = resolvePath(baseDir, src);
    if (!target) continue;
    const isModule = (el.getAttribute('type') || '').toLowerCase() === 'module';
    jobs.push((async () => {
      const code = isModule
        ? await inlineModule(target, load, 0, new Set())
        : await load(target, 'text');
      if (code == null) return;
      el.removeAttribute('src');
      el.removeAttribute('integrity');
      el.removeAttribute('crossorigin');
      el.textContent = safeScriptText(code);
    })());
  }
  for (const el of doc.querySelectorAll('script:not([src])')) {
    if ((el.getAttribute('type') || '').toLowerCase() !== 'module') continue;
    const code = el.textContent || '';
    if (!code.includes('import')) continue;
    jobs.push(replaceAsync(code, MODULE_SPEC_RE, async (m) => {
      const ref = m[3];
      if (!isLocalRef(ref)) return m[0];
      const target = resolvePath(baseDir, ref);
      if (!target) return m[0];
      const nested = await inlineModule(target, load, 1, new Set());
      if (nested == null) return m[0];
      return m[1] + m[2] + dataUrlFromText(nested, 'text/javascript') + m[2];
    }).then(next => { el.textContent = safeScriptText(next); }));
  }
  await Promise.all(jobs);
}

const MEDIA_ATTRS = [
  ['img', 'src'], ['img', 'srcset'], ['source', 'src'], ['source', 'srcset'],
  ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'],
  ['embed', 'src'], ['object', 'data'], ['input', 'src'], ['iframe', 'src'],
  ['use', 'href'], ['image', 'href'], ['link', 'href']
];

async function swapSrcset(value, baseDir, load) {
  const parts = String(value).split(',');
  const next = await Promise.all(parts.map(async (part) => {
    const trimmed = part.trim();
    if (!trimmed) return null;
    const sp = trimmed.indexOf(' ');
    const ref = sp === -1 ? trimmed : trimmed.slice(0, sp);
    const suffix = sp === -1 ? '' : trimmed.slice(sp);
    if (!isLocalRef(ref)) return trimmed;
    const target = resolvePath(baseDir, ref);
    if (!target) return trimmed;
    const data = await load(target, 'binary');
    return (data == null ? ref : data) + suffix;
  }));
  return next.filter(Boolean).join(', ');
}

async function inlineMedia(doc, baseDir, load) {
  const jobs = [];
  for (const [tag, attr] of MEDIA_ATTRS) {
    for (const el of doc.querySelectorAll(tag + '[' + attr + ']')) {
      if (tag === 'link') {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (!rel.includes('icon') && !rel.includes('preload') && !rel.includes('manifest')) continue;
      }
      const value = el.getAttribute(attr);
      if (!value) continue;
      if (attr === 'srcset') {
        jobs.push(swapSrcset(value, baseDir, load).then(v => { el.setAttribute(attr, v); }));
        continue;
      }
      if (!isLocalRef(value)) continue;
      const target = resolvePath(baseDir, value);
      if (!target) continue;
      jobs.push(load(target, 'binary').then(data => { if (data != null) el.setAttribute(attr, data); }));
    }
  }
  await Promise.all(jobs);
}

function injectBootstrap(doc) {
  const script = doc.createElement('script');
  script.textContent = BOOTSTRAP;
  const head = doc.head || doc.documentElement;
  if (head.firstChild) head.insertBefore(script, head.firstChild);
  else head.appendChild(script);
}

export async function buildPreviewDoc({ chatId, path, html }) {
  const source = String(html || '');
  if (!source.trim()) return source;
  if (extOf(path) === 'svg') return source;
  if (typeof DOMParser === 'undefined') return source;
  let doc;
  try { doc = new DOMParser().parseFromString(source, 'text/html'); } catch { return source; }
  if (!doc || !doc.documentElement) return source;
  const baseDir = dirOf(path);
  const load = makeLoader(chatId);
  try {
    await Promise.all([
      inlineStyles(doc, baseDir, load),
      inlineScripts(doc, baseDir, load),
      inlineMedia(doc, baseDir, load)
    ]);
  } catch { return source; }
  injectBootstrap(doc);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
