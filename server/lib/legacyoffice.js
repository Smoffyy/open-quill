const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;
const NOSTREAM = 0xffffffff;

const cp1252 = new TextDecoder('windows-1252');
const utf16 = new TextDecoder('utf-16le');
const latin1 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('latin1');

const LANG_CODEPAGE = {
  __proto__: null,
  0x19: 'windows-1251', 0x22: 'windows-1251', 0x23: 'windows-1251', 0x02: 'windows-1251', 0x2f: 'windows-1251', 0x3f: 'windows-1251', 0x40: 'windows-1251', 0x43: 'windows-1251', 0x44: 'windows-1251', 0x50: 'windows-1251',
  0x05: 'windows-1250', 0x15: 'windows-1250', 0x0e: 'windows-1250', 0x1b: 'windows-1250', 0x24: 'windows-1250', 0x18: 'windows-1250', 0x1c: 'windows-1250', 0x1a: 'windows-1250',
  0x08: 'windows-1253', 0x1f: 'windows-1254', 0x0d: 'windows-1255', 0x01: 'windows-1256', 0x29: 'windows-1256', 0x20: 'windows-1256',
  0x25: 'windows-1257', 0x26: 'windows-1257', 0x27: 'windows-1257', 0x2a: 'windows-1258', 0x1e: 'windows-874',
  0x11: 'shift_jis', 0x12: 'euc-kr'
};
const CYRILLIC_SERBIAN = new Set([0x0c1a, 0x1c1a, 0x201a]);
const SIMPLIFIED_CHINESE = new Set([0x0804, 0x1004]);

function ansiDecoder(lid) {
  const primary = lid & 0x3ff;
  let enc = LANG_CODEPAGE[primary] || 'windows-1252';
  if (CYRILLIC_SERBIAN.has(lid)) enc = 'windows-1251';
  if (primary === 0x04) enc = SIMPLIFIED_CHINESE.has(lid) ? 'gbk' : 'big5';
  try { return new TextDecoder(enc); } catch { return cp1252; }
}

export function isCfb(buf) {
  return buf.length >= 512 && CFB_MAGIC.every((b, i) => buf[i] === b);
}

export function readCfb(buf) {
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSize = 1 << buf.readUInt16LE(0x20);
  const cutoff = buf.readUInt32LE(0x38);
  const sectorAt = (n) => (n + 1) * sectorSize;
  const perSector = sectorSize / 4;

  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  let difat = buf.readUInt32LE(0x44);
  for (let guard = 0; difat !== END && difat !== FREE && guard < 4096; guard++) {
    const at = sectorAt(difat);
    if (at + sectorSize > buf.length) break;
    for (let i = 0; i < perSector - 1; i++) {
      const s = buf.readUInt32LE(at + i * 4);
      if (s !== FREE) fatSectors.push(s);
    }
    difat = buf.readUInt32LE(at + sectorSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) {
    const at = sectorAt(s);
    if (at + sectorSize > buf.length) continue;
    for (let i = 0; i < perSector; i++) fat.push(buf.readUInt32LE(at + i * 4));
  }

  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let s = start; s !== END && s < table.length && !seen.has(s); s = table[s]) { seen.add(s); out.push(s); }
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start, fat).map(s => sectorAt(s)).filter(at => at < buf.length).map(at => buf.subarray(at, Math.min(buf.length, at + sectorSize))));

  const dirBuf = readChain(buf.readUInt32LE(0x30));
  const entries = [];
  for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
    const nameLen = Math.min(64, dirBuf.readUInt16LE(off + 0x40));
    entries.push({
      name: utf16.decode(dirBuf.subarray(off, off + Math.max(0, nameLen - 2))),
      type: dirBuf[off + 0x42],
      left: dirBuf.readUInt32LE(off + 0x44),
      right: dirBuf.readUInt32LE(off + 0x48),
      child: dirBuf.readUInt32LE(off + 0x4c),
      start: dirBuf.readUInt32LE(off + 0x74),
      size: dirBuf.readUInt32LE(off + 0x78)
    });
  }
  const root = entries[0];
  if (!root) throw new Error('empty compound file');

  const miniFatBuf = readChain(buf.readUInt32LE(0x3c));
  const miniFat = [];
  for (let off = 0; off + 4 <= miniFatBuf.length; off += 4) miniFat.push(miniFatBuf.readUInt32LE(off));
  let miniStream = null;

  const paths = new Map();
  const seen = new Set();
  const walk = (id, prefix) => {
    if (id === NOSTREAM || id >= entries.length || seen.has(id)) return;
    seen.add(id);
    const e = entries[id];
    walk(e.left, prefix);
    walk(e.right, prefix);
    const p = prefix + e.name;
    if (e.type === 2) paths.set(p, e);
    else if (e.type === 1) walk(e.child, p + '/');
  };
  walk(root.child, '');

  const read = (name) => {
    const e = paths.get(name);
    if (!e) return null;
    if (e.size < cutoff) {
      if (!miniStream) miniStream = readChain(root.start);
      const parts = chain(e.start, miniFat).map(s => miniStream.subarray(s * miniSize, s * miniSize + miniSize));
      return Buffer.concat(parts).subarray(0, e.size);
    }
    return readChain(e.start).subarray(0, e.size);
  };
  return { has: (name) => paths.has(name), read, names: () => [...paths.keys()] };
}

function stripFields(s) {
  let out = '';
  const stack = [];
  for (const ch of s) {
    if (ch === '\x13') { stack.push(false); continue; }
    if (ch === '\x14') { if (stack.length) stack[stack.length - 1] = true; continue; }
    if (ch === '\x15') { stack.pop(); continue; }
    if (stack.length && !stack[stack.length - 1]) continue;
    out += ch;
  }
  return out;
}

function cleanWordText(s) {
  return stripFields(s)
    .replace(/\r\x07/g, '\t').replace(/\x07/g, '\t')
    .replace(/[\r\x0b\x0c\x0e]/g, '\n')
    .replace(/[\x00-\x08\x0f-\x1f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function pieceText(wd, clx, fcClx, lcbClx, decodePiece) {
  if (!clx || !lcbClx || fcClx + lcbClx > clx.length) return '';
  let i = fcClx;
  const stop = fcClx + lcbClx;
  while (i < stop && clx[i] === 0x01) i += 3 + clx.readUInt16LE(i + 1);
  if (clx[i] !== 0x02 || i + 5 > stop) return '';
  const lcb = clx.readUInt32LE(i + 1);
  const plc = i + 5;
  const n = Math.floor((lcb - 4) / 12);
  if (plc + (n + 1) * 4 + n * 8 > clx.length) return '';
  let text = '';
  for (let k = 0; k < n; k++) {
    const count = Math.max(0, clx.readUInt32LE(plc + (k + 1) * 4) - clx.readUInt32LE(plc + k * 4));
    text += decodePiece(clx.readUInt32LE(plc + (n + 1) * 4 + k * 8 + 2), count);
  }
  return text;
}

function wordSections(text, ccps) {
  const [ccpText, ccpFtn, ccpHdd, ccpMcr, ccpAtn, ccpEdn] = ccps;
  const part = (from, len) => cleanWordText(text.slice(from, from + len)).trim();
  const body = cleanWordText(text.slice(0, ccpText || text.length)).trim();
  const ftn = part(ccpText, ccpFtn);
  const atnAt = ccpText + ccpFtn + ccpHdd + ccpMcr;
  const atn = part(atnAt, ccpAtn);
  const edn = part(atnAt + ccpAtn, ccpEdn);
  return [body, ftn && 'Footnotes:\n' + ftn, edn && 'Endnotes:\n' + edn, atn && 'Comments:\n' + atn].filter(Boolean).join('\n\n');
}

function word97(cfb, wd, flags) {
  const table = cfb.read(flags & 0x0200 ? '1Table' : '0Table');
  let pos = 32;
  const csw = wd.readUInt16LE(pos); pos += 2 + csw * 2;
  const cslw = wd.readUInt16LE(pos); const lw = pos + 2; pos += 2 + cslw * 4 + 2;
  const ccp = (i) => (lw + i * 4 + 4 <= wd.length ? wd.readUInt32LE(lw + i * 4) : 0);
  const fcClx = pos + 0x110 <= wd.length ? wd.readUInt32LE(pos + 0x108) : 0;
  const lcbClx = pos + 0x110 <= wd.length ? wd.readUInt32LE(pos + 0x10c) : 0;
  let text = pieceText(wd, table, fcClx, lcbClx, (raw, count) => {
    if (raw & 0x40000000) {
      const at = (raw & 0x3fffffff) / 2;
      return cp1252.decode(wd.subarray(at, at + count));
    }
    return utf16.decode(wd.subarray(raw, raw + count * 2));
  });
  if (!text) {
    const fcMin = wd.readUInt32LE(0x18), fcMac = wd.readUInt32LE(0x1c);
    if (fcMac > fcMin && fcMac <= wd.length) text = cp1252.decode(wd.subarray(fcMin, fcMac));
  }
  return wordSections(text, [3, 4, 5, 6, 7, 8].map(ccp));
}

function word6(wd, flags) {
  const u32 = (at) => (at + 4 <= wd.length ? wd.readUInt32LE(at) : 0);
  const dec = ansiDecoder(wd.readUInt16LE(0x06));
  let text = '';
  if (flags & 0x0004) {
    text = pieceText(wd, wd, u32(0x1a2), u32(0x1a6), (raw, count) => dec.decode(wd.subarray(raw, raw + count)));
  }
  if (!text) {
    const fcMin = u32(0x18), fcMac = u32(0x1c);
    if (fcMac > fcMin && fcMac <= wd.length) text = dec.decode(wd.subarray(fcMin, fcMac));
  }
  return wordSections(text, [0x34, 0x38, 0x3c, 0x40, 0x44, 0x48].map(u32));
}

function doc(cfb) {
  const wd = cfb.read('WordDocument');
  if (!wd || wd.length < 0x200) return '';
  const ident = wd.readUInt16LE(0);
  if (ident !== 0xa5ec && ident !== 0xa5dc) return '';
  const flags = wd.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new Error('the document is password protected');
  return ident === 0xa5dc || wd.readUInt16LE(2) < 101 ? word6(wd, flags) : word97(cfb, wd, flags);
}

class Segments {
  constructor(parts) { this.parts = parts; this.i = 0; this.off = 0; }
  get done() { return this.i >= this.parts.length; }
  roll() {
    while (this.i < this.parts.length && this.off >= this.parts[this.i].length) { this.i++; this.off = 0; }
  }
  u8() { this.roll(); const v = this.parts[this.i][this.off]; this.off += 1; return v; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n) {
    while (n > 0 && !this.done) {
      this.roll();
      if (this.done) return;
      const take = Math.min(n, this.parts[this.i].length - this.off);
      this.off += take; n -= take;
    }
  }
  chars(n, high) {
    let out = '';
    while (n > 0 && !this.done) {
      if (this.off >= this.parts[this.i].length) {
        this.i++; this.off = 0;
        if (this.done) break;
        high = !!(this.parts[this.i][this.off++] & 1);
      }
      const seg = this.parts[this.i];
      const width = high ? 2 : 1;
      const take = Math.min(n, Math.floor((seg.length - this.off) / width));
      if (take <= 0) { this.off = seg.length; continue; }
      const bytes = seg.subarray(this.off, this.off + take * width);
      out += high ? utf16.decode(bytes) : latin1(bytes);
      this.off += take * width; n -= take;
    }
    return out;
  }
}

function xlString(b, at, cchBytes) {
  const cch = cchBytes === 1 ? b[at] : b.readUInt16LE(at);
  const flags = b[at + cchBytes];
  const start = at + cchBytes + 1;
  return flags & 1 ? utf16.decode(b.subarray(start, start + cch * 2)) : latin1(b.subarray(start, start + cch));
}

function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else { const d = Buffer.alloc(8); d.writeUInt32LE((v & 0xfffffffc) >>> 0, 4); n = d.readDoubleLE(0); }
  return v & 1 ? n / 100 : n;
}

const num = (n) => Number.isFinite(n) ? String(Number(n.toPrecision(15))) : '';
const csvCell = (v) => /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

function xls(cfb) {
  const wb = cfb.read('Workbook') || cfb.read('Book');
  if (!wb) return '';
  const records = [];
  for (let off = 0; off + 4 <= wb.length;) {
    const type = wb.readUInt16LE(off), len = wb.readUInt16LE(off + 2);
    records.push({ type, off, data: wb.subarray(off + 4, Math.min(wb.length, off + 4 + len)) });
    off += 4 + len;
  }
  const sheetNames = new Map();
  let sst = [];
  for (let r = 0; r < records.length; r++) {
    const { type, data } = records[r];
    if (type === 0x002f) throw new Error('the workbook is password protected');
    if (type === 0x0085 && data.length >= 8) sheetNames.set(data.readUInt32LE(0), { name: xlString(data, 6, 1), kind: data[5] });
    if (type === 0x00fc) {
      const parts = [data];
      for (let k = r + 1; k < records.length && records[k].type === 0x003c; k++) parts.push(records[k].data);
      const s = new Segments(parts);
      s.skip(4);
      const unique = s.u32();
      sst = [];
      for (let k = 0; k < unique && !s.done; k++) {
        const cch = s.u16();
        const f = s.u8();
        const runs = f & 8 ? s.u16() : 0;
        const ext = f & 4 ? s.u32() : 0;
        sst.push(s.chars(cch, !!(f & 1)));
        s.skip(runs * 4 + ext);
      }
    }
  }
  const sheets = [];
  let cur = null, depth = 0, lastFormula = null;
  const put = (row, col, val) => {
    if (!cur || val === '') return;
    if (!cur.rows.has(row)) cur.rows.set(row, new Map());
    cur.rows.get(row).set(col, val);
  };
  for (const { type, off, data } of records) {
    if (type === 0x0809) {
      depth++;
      if (depth === 1 && sheetNames.has(off)) {
        const meta = sheetNames.get(off);
        cur = meta.kind === 0 ? { name: meta.name, rows: new Map() } : null;
        if (cur) sheets.push(cur);
      } else if (depth === 1) cur = null;
      continue;
    }
    if (type === 0x000a) { depth = Math.max(0, depth - 1); if (!depth) cur = null; continue; }
    if (!cur || depth !== 1 || data.length < 6) continue;
    const row = data.readUInt16LE(0), col = data.readUInt16LE(2);
    if (type === 0x00fd && data.length >= 10) put(row, col, sst[data.readUInt32LE(6)] ?? '');
    else if (type === 0x0203 && data.length >= 14) put(row, col, num(data.readDoubleLE(6)));
    else if (type === 0x027e && data.length >= 10) put(row, col, num(rk(data.readUInt32LE(6))));
    else if (type === 0x00bd) {
      const last = data.readUInt16LE(data.length - 2);
      for (let c = col, at = 4; c <= last && at + 6 <= data.length - 2; c++, at += 6) put(row, c, num(rk(data.readUInt32LE(at + 2))));
    } else if (type === 0x0204 && data.length >= 9) put(row, col, xlString(data, 6, 2));
    else if (type === 0x0205 && data.length >= 8) { if (!data[7]) put(row, col, data[6] ? 'TRUE' : 'FALSE'); }
    else if (type === 0x0006 && data.length >= 14) {
      lastFormula = null;
      if (data.readUInt16LE(12) === 0xffff) {
        const kind = data[6];
        if (kind === 0) lastFormula = { row, col };
        else if (kind === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE');
      } else put(row, col, num(data.readDoubleLE(6)));
    } else if (type === 0x0207 && lastFormula) {
      put(lastFormula.row, lastFormula.col, xlString(data, 0, 2));
      lastFormula = null;
    }
  }
  return sheets.map(s => {
    const lines = [...s.rows.keys()].sort((a, b) => a - b).map(r => {
      const cells = s.rows.get(r);
      const width = Math.max(...cells.keys()) + 1;
      return Array.from({ length: width }, (_, c) => csvCell(cells.get(c) ?? '')).join(',');
    });
    return `## Sheet: ${s.name}\n${lines.join('\n')}`;
  }).join('\n\n');
}

const PPT_TEXT_CHARS = 0x0fa0;
const PPT_TEXT_BYTES = 0x0fa8;
const PPT_SLWT = 0x0ff0;
const PPT_SLIDE_PERSIST = 0x03f3;
const PPT_PERSIST_DIR = 0x1772;
const PPT_MAIN_MASTER = 0x03f8;

function pptRecords(b, start, end, visit, depth = 0) {
  for (let off = start; off + 8 <= end;) {
    const verInst = b.readUInt16LE(off), type = b.readUInt16LE(off + 2), len = b.readUInt32LE(off + 4);
    const body = off + 8, stop = Math.min(end, body + len);
    const container = (verInst & 0x0f) === 0x0f;
    if (visit({ type, instance: verInst >> 4, body, stop, container, depth }) !== false && container && depth < 32) pptRecords(b, body, stop, visit, depth + 1);
    off = stop;
  }
}

function pptAtomText(b, type, body, stop) {
  const raw = type === PPT_TEXT_CHARS ? utf16.decode(b.subarray(body, stop)) : latin1(b.subarray(body, stop));
  return raw.replace(/[\r\x0b]/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
}


const PPT_USER_EDIT = 0x0ff5;
const PPT_DOCUMENT = 0x03e8;
const PPT_SLIDE = 0x03ee;

function readPersistDir(b, body, stop, map) {
  for (let at = body; at + 4 <= stop;) {
    const head = b.readUInt32LE(at); at += 4;
    const first = head & 0xfffff, count = head >>> 20;
    for (let k = 0; k < count && at + 4 <= stop; k++, at += 4) if (!map.has(first + k)) map.set(first + k, b.readUInt32LE(at));
  }
}

function pptPersist(cfb, b) {
  const map = new Map();
  let docRef = null;
  const cu = cfb.read('Current User');
  let edit = cu && cu.length >= 20 ? cu.readUInt32LE(16) : 0;
  const seen = new Set();
  while (edit && edit + 28 <= b.length && !seen.has(edit) && b.readUInt16LE(edit + 2) === PPT_USER_EDIT) {
    seen.add(edit);
    const body = edit + 8;
    if (docRef == null) docRef = b.readUInt32LE(body + 16);
    const dir = b.readUInt32LE(body + 12);
    if (dir + 8 <= b.length && b.readUInt16LE(dir + 2) === PPT_PERSIST_DIR) readPersistDir(b, dir + 8, Math.min(b.length, dir + 8 + b.readUInt32LE(dir + 4)), map);
    edit = b.readUInt32LE(body + 8);
  }
  if (!map.size) {
    const dirs = [];
    pptRecords(b, 0, b.length, (r) => { if (r.type === PPT_PERSIST_DIR) dirs.push(r); return false; });
    for (const r of dirs.reverse()) readPersistDir(b, r.body, r.stop, map);
  }
  return { map, docRef };
}

function containerAt(b, at, type) {
  if (at == null || at + 8 > b.length || b.readUInt16LE(at + 2) !== type) return null;
  return { body: at + 8, stop: Math.min(b.length, at + 8 + b.readUInt32LE(at + 4)) };
}

function slideGroups(b, start, stop) {
  const groups = [];
  let group = null;
  let slwtEnd = -1;
  pptRecords(b, start, stop, (r) => {
    if (r.type === PPT_MAIN_MASTER) return false;
    if (r.type === PPT_SLWT) {
      if (r.instance !== 0) return false;
      group = null;
      slwtEnd = r.stop;
      return true;
    }
    if (r.type === PPT_SLIDE_PERSIST && r.body < slwtEnd) {
      group = { persistId: b.readUInt32LE(r.body), texts: [] };
      groups.push(group);
      return false;
    }
    if ((r.type === PPT_TEXT_CHARS || r.type === PPT_TEXT_BYTES) && group && r.body < slwtEnd) {
      const t = pptAtomText(b, r.type, r.body, r.stop);
      if (t) group.texts.push(t);
    }
    return true;
  });
  return groups;
}

function ppt(cfb) {
  const b = cfb.read('PowerPoint Document');
  if (!b) return '';
  const { map: persist, docRef } = pptPersist(cfb, b);
  const docBox = containerAt(b, persist.get(docRef), PPT_DOCUMENT);
  let groups = docBox ? slideGroups(b, docBox.body, docBox.stop) : [];
  if (!groups.length) {
    let last = null;
    pptRecords(b, 0, b.length, (r) => { if (r.type === PPT_DOCUMENT) last = r; return false; });
    if (last) groups = slideGroups(b, last.body, last.stop);
  }
  if (!groups.length) {
    const texts = [];
    pptRecords(b, 0, b.length, (r) => {
      if (r.type === PPT_MAIN_MASTER) return false;
      if (r.type === PPT_TEXT_CHARS || r.type === PPT_TEXT_BYTES) { const t = pptAtomText(b, r.type, r.body, r.stop); if (t) texts.push(t); }
      return true;
    });
    return texts.join('\n');
  }
  return groups.map((g, i) => {
    const texts = g.texts.slice();
    const box = containerAt(b, persist.get(g.persistId), PPT_SLIDE);
    if (box) {
      pptRecords(b, box.body, box.stop, (r) => {
        if (r.type === PPT_TEXT_CHARS || r.type === PPT_TEXT_BYTES) {
          const t = pptAtomText(b, r.type, r.body, r.stop);
          if (t && !texts.includes(t)) texts.push(t);
        }
        return true;
      });
    }
    return `## Slide ${i + 1}\n${texts.join('\n')}`;
  }).join('\n\n');
}


const MSG_FIELDS = [['0037', 'Subject'], ['0C1A', 'From'], ['0C1F', 'From address'], ['0E04', 'To'], ['0E03', 'Cc']];

function msg(cfb, htmlText) {
  const prop = (prefix, id) => {
    const u = cfb.read(`${prefix}__substg1.0_${id}001F`);
    if (u) return utf16.decode(u).replace(/\0+$/, '');
    const a = cfb.read(`${prefix}__substg1.0_${id}001E`);
    return a ? cp1252.decode(a).replace(/\0+$/, '') : '';
  };
  const head = MSG_FIELDS.map(([id, label]) => { const v = prop('', id); return v ? `${label}: ${v}` : ''; }).filter(Boolean);
  let body = prop('', '1000');
  if (!body) {
    const html = cfb.read('__substg1.0_10130102');
    if (html) body = htmlText(html.toString('utf8'));
  }
  const attachments = [...new Set(cfb.names().filter(n => n.startsWith('__attach_version1.0_')).map(n => n.split('/')[0]))]
    .map(dir => prop(dir + '/', '3707') || prop(dir + '/', '3704')).filter(Boolean);
  return [head.join('\n'), body.trim(), attachments.length ? 'Attachments: ' + attachments.join(', ') : ''].filter(Boolean).join('\n\n');
}

export function extractCfb(buf, htmlText) {
  const cfb = readCfb(buf);
  if (cfb.has('EncryptedPackage')) throw new Error('the document is password protected');
  if (cfb.has('WordDocument')) return doc(cfb);
  if (cfb.has('Workbook') || cfb.has('Book')) return xls(cfb);
  if (cfb.has('PowerPoint Document')) return ppt(cfb);
  if (cfb.names().some(n => n.startsWith('__substg1.0_'))) return msg(cfb, htmlText);
  return '';
}
