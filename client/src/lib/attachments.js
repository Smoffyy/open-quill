import { useState, useRef, useEffect } from 'react';

const DEFAULT_GLOW = 'var(--text)';

function dominantColor(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const s = 24; const c = document.createElement('canvas'); c.width = s; c.height = s;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, s, s);
        const data = ctx.getImageData(0, 0, s, s).data;
        const counts = {}; let best = null, bestN = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4);
          counts[key] = (counts[key] || 0) + 1;
          if (counts[key] > bestN) { bestN = counts[key]; best = [data[i], data[i + 1], data[i + 2]]; }
        }
        resolve(best ? `rgb(${best[0]},${best[1]},${best[2]})` : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function useAttachments({ visionSupported }) {
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [glow, setGlow] = useState(DEFAULT_GLOW);
  const [upErr, setUpErr] = useState('');
  const dragDepth = useRef(0);
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => () => filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []);

  function addFiles(list) {
    let picked = Array.from(list || []);
    if (!visionSupported) picked = picked.filter(f => !f.type.startsWith('image/'));
    if (!picked.length) return;
    setUpErr('');
    const mapped = picked.map(file => ({
      id: Math.random().toString(36).slice(2), file, name: file.name, type: file.type, size: file.size,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    }));
    setFiles(fs => [...fs, ...mapped]);
    const lastImg = [...mapped].reverse().find(f => f.preview);
    if (lastImg) dominantColor(lastImg.preview).then(c => c && setGlow(c));
  }

  function pickFiles(e) { addFiles(e.target.files); e.target.value = ''; }

  // ctrl+v / cmd+v an image (or any file) straight into the box
  function onPaste(e) {
    const dt = e.clipboardData; if (!dt) return;
    const found = [];
    if (dt.files && dt.files.length) found.push(...Array.from(dt.files));
    else if (dt.items) for (const it of dt.items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) found.push(f); }
    if (found.length) { e.preventDefault(); addFiles(found); }
  }

  function removeFile(id) {
    setFiles(fs => { const t = fs.find(f => f.id === id); if (t?.preview) URL.revokeObjectURL(t.preview); return fs.filter(f => f.id !== id); });
  }

  function clearFiles() {
    filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]);
    setGlow(DEFAULT_GLOW);
  }

  useEffect(() => {
    const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragActive(true); };
    const onOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); };
    const onLeave = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragActive(false); } };
    const onDrop = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragActive(false); addFiles(e.dataTransfer.files); };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [visionSupported]);

  return { files, dragActive, glow, upErr, setUpErr, addFiles, pickFiles, onPaste, removeFile, clearFiles };
}
