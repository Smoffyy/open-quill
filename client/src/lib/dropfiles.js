const hidden = (name) => !name || name.startsWith('.');

const readAll = (reader) => new Promise((resolve, reject) => { reader.readEntries(resolve, reject); });
const fileOf = (entry) => new Promise((resolve, reject) => { entry.file(resolve, reject); });

export const ownsDrop = (target) => !!(target && typeof target.closest === 'function' && target.closest('[data-own-drop]'));

export function pickedFiles(list) {
  return Array.from(list || []).map(file => ({ file, path: file.webkitRelativePath || file.name }))
    .filter(x => !x.path.split('/').some(hidden));
}

export async function droppedFiles(dt) {
  const entries = Array.from(dt?.items || [])
    .filter(it => it.kind === 'file' && typeof it.webkitGetAsEntry === 'function')
    .map(it => it.webkitGetAsEntry())
    .filter(Boolean);
  if (!entries.length) return pickedFiles(dt?.files);
  const out = [];
  const walk = async (entry, prefix) => {
    if (hidden(entry.name)) return;
    if (entry.isFile) {
      try { out.push({ file: await fileOf(entry), path: prefix + entry.name }); } catch {}
      return;
    }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    for (;;) {
      let batch;
      try { batch = await readAll(reader); } catch { return; }
      if (!batch.length) return;
      for (const child of batch) await walk(child, prefix + entry.name + '/');
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}