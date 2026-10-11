import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { subscribeFilePreview, previewKind, uploadFileOf } from '../../lib/filepreview.js';
import { extLabel } from '../../lib/files.js';
import { fmtSize } from '../../lib/artifacts.js';
import { t } from '../../i18n.jsx';
import Markdown from '../chat/Markdown.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { SegSlide } from '../ui/controls.jsx';
import { Download, Eye, FileText } from '../ui/icons.jsx';
import { Skel, SkelLines } from '../ui/Skeleton.jsx';

function useUploadText(file, on) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!on || !file) return;
    let cancelled = false;
    setState(null);
    api.get('/api/uploads/' + encodeURIComponent(file) + '/text')
      .then(d => { if (!cancelled) setState(d); })
      .catch(() => { if (!cancelled) setState({ text: null, failed: true }); });
    return () => { cancelled = true; };
  }, [file, on]);
  return state;
}

function usePdfBlob(url, on) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!on || !url) return;
    let cancelled = false;
    let made = null;
    setSrc(null);
    setFailed(false);
    fetch(url, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(buf => {
        if (cancelled) return;
        made = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        setSrc(made);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [url, on]);
  return { src, failed };
}

function TextBody({ data, markdown }) {
  if (data == null) return <Skel when><SkelLines count={14} /></Skel>;
  if (data.text == null) return <Empty />;
  return (
    <>
      {data.truncated && <p className="fp-note">{t('Showing the beginning of this file. Download it to see everything.')}</p>}
      {markdown
        ? <div className="fp-doc"><Markdown>{data.text}</Markdown></div>
        : <pre className="fp-text">{data.text}</pre>}
    </>
  );
}

function Empty() {
  return (
    <div className="fp-empty">
      <FileText />
      <p>{t('No preview is available for this file.')}</p>
    </div>
  );
}

function PreviewBody({ file, kind, mode }) {
  const name = uploadFileOf(file.url);
  const wantsText = kind === 'text' || kind === 'markdown' || (kind === 'pdf' && mode === 'text');
  const data = useUploadText(name, wantsText);
  const pdf = usePdfBlob(file.url, kind === 'pdf' && mode !== 'text');
  if (kind === 'image') return <div className="fp-media"><img src={file.url} alt={file.name} /></div>;
  if (kind === 'audio') return <div className="fp-media"><audio src={file.url} controls preload="metadata" /></div>;
  if (kind === 'video') return <div className="fp-media"><video src={file.url} controls preload="metadata" /></div>;
  if (kind === 'pdf' && mode !== 'text') {
    if (pdf.failed) return <Empty />;
    if (!pdf.src) return <Skel when><SkelLines count={14} /></Skel>;
    return <iframe className="fp-frame" src={pdf.src} data-tip={file.name} aria-label={file.name} />;
  }
  return <TextBody data={data} markdown={kind === 'markdown'} />;
}

export default function FilePreview() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('doc');
  useEffect(() => subscribeFilePreview((f) => { setMode('doc'); setFile(f); }), []);
  if (!file) return null;
  const close = () => setFile(null);
  const kind = previewKind(file.name, file.type);
  const meta = [extLabel(file.name), file.size != null ? fmtSize(file.size) : ''].filter(Boolean).join(' · ');
  return (
    <Dialog className={'modal fp-modal' + (kind === 'pdf' && mode !== 'text' ? ' fp-full' : '')} label={file.name} onClose={close} focusSelf>
      <div className="modal-main">
        <div className="modal-head fp-head">
          <div className="fp-title">
            <h2 className="modal-title" data-tip={file.name}>{file.name}</h2>
            {meta && <span className="fp-meta">{meta}</span>}
          </div>
          {kind === 'pdf' && (
            <SegSlide value={mode} label={t('View')} className="compact" onPick={setMode}
              options={[
                { v: 'doc', label: <Eye style={{ width: 15 }} />, title: t('Document') },
                { v: 'text', label: <FileText style={{ width: 15 }} />, title: t('Extracted text') }
              ]} />
          )}
          <a className="btn ghost sm fp-download" href={file.url} download={file.name}>
            <Download style={{ width: 15 }} />{t('Download')}
          </a>
        </div>
        <div className="modal-body fp-body">
          <PreviewBody key={file.url + ':' + mode} file={file} kind={kind} mode={mode} />
        </div>
      </div>
      <CloseButton onClick={close} />
    </Dialog>
  );
}