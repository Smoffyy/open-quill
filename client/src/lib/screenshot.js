export function screenshotSupported() {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getDisplayMedia === 'function'
    && typeof document !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined';
}

export function isCaptureCancel(err) {
  const name = err && err.name;
  return name === 'NotAllowedError' || name === 'AbortError' || name === 'NotFoundError';
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

export function screenshotName(d) {
  return 'screenshot-' + stamp(d) + '.png';
}

function paintedFrame(video, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; clearTimeout(hard); clearInterval(poll); resolve(); };
    const hard = setTimeout(finish, timeoutMs);
    const poll = setInterval(() => { if (video.videoWidth > 0 && video.currentTime > 0) finish(); }, 60);
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = (_now, meta) => {
        if (video.videoWidth > 0 && meta && meta.mediaTime > 0) { finish(); return; }
        if (!settled) video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
  });
}

function encode(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('The screen frame could not be encoded.')), 'image/png');
  });
}

export async function captureScreenshot() {
  if (!screenshotSupported()) throw new Error('unsupported');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No screen video track was returned.');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-2147483648';
    document.body.appendChild(video);
    await video.play().catch(() => {});
    await paintedFrame(video);
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
    const w = video.videoWidth || settings.width || 0;
    const h = video.videoHeight || settings.height || 0;
    if (!w || !h) throw new Error('The captured frame was empty.');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    const blob = await encode(canvas);
    return new File([blob], screenshotName(), { type: 'image/png' });
  } finally {
    try { video.pause(); } catch { void 0; }
    video.srcObject = null;
    video.remove();
    for (const tr of stream.getTracks()) tr.stop();
  }
}
