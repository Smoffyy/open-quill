import { useState } from 'react';
import FileChip from './FileChip.jsx';
import { Download, ChevDown, Folder } from '../icons.jsx';
import { t } from '../../i18n.jsx';
import { baseName, fmtSize } from '../../lib/artifacts.js';

function FileRow({ f, chatId, depth, onOpen, sel, live }) {
  const active = sel === f.path;
  const writing = live && live.path === f.path;
  return (
    <div className={'art-row tree' + (active ? ' active' : '')} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onOpen(f.path)}>
      <FileChip ext={f.ext} />
      <div className="art-rmeta">
        <div className="art-rname">{baseName(f.path)}</div>
        <div className="art-rext">{writing ? <span className="row-writing">{t("writing…")}</span> : <>{(f.ext || 'file').toUpperCase()}{f.v ? ' · v' + f.v : ''}{f.size != null ? ' · ' + fmtSize(f.size) : ''}</>}</div>
      </div>
      {!writing && !!f.v && <a className="art-btn icon dl" href={`/api/chats/${chatId}/download?path=${encodeURIComponent(f.path)}`} onClick={(e) => e.stopPropagation()} title={t("Download")}><Download style={{ width: 15 }} /></a>}
    </div>
  );
}

function TreeFolder({ name, node, depth, chatId, onOpen, sel, live, forceOpen }) {
  const [open, setOpen] = useState(true);
  const isOpen = forceOpen || open;
  return (
    <>
      <div className="art-tree-folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen(o => !o)}>
        <ChevDown className={'tf-chev' + (isOpen ? ' open' : '')} style={{ width: 13 }} />
        <Folder style={{ width: 15 }} /><span className="tf-name">{name}</span>
      </div>
      {isOpen && <TreeChildren node={node} depth={depth + 1} chatId={chatId} onOpen={onOpen} sel={sel} live={live} forceOpen={forceOpen} />}
    </>
  );
}

export default function TreeChildren({ node, depth, chatId, onOpen, sel, live, forceOpen }) {
  const dirs = Object.keys(node.dirs).sort();
  const files = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      {dirs.map(d => <TreeFolder key={d} name={d} node={node.dirs[d]} depth={depth} chatId={chatId} onOpen={onOpen} sel={sel} live={live} forceOpen={forceOpen} />)}
      {files.map(f => <FileRow key={f.path} f={f} chatId={chatId} depth={depth} onOpen={onOpen} sel={sel} live={live} />)}
    </>
  );
}
