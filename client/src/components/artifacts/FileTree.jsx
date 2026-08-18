import { FileText, Download, ChevDown, Folder } from '../icons.jsx';
import { t } from '../../i18n.jsx';
import { baseName, extOf, fmtSize, countFiles, EXT_COLOR } from '../../lib/artifacts.js';

// One card per file, the same paper-thumbnail shape the panel has always used.
// `sub` is passed in rather than computed here because the tree already spends a
// row on the folder and repeating it under every file is noise, while the flat
// and filtered lists have no other place to put it.
export function FileCard({ f, chatId, sub, writing, pending, active, onOpen }) {
  const ext = extOf(f.path);
  const tint = EXT_COLOR[ext] || null;
  const state = writing ? t('Writing…') : pending ? t('Saving…') : null;
  return (
    <div className={'art-card' + (writing || pending ? ' writing' : '') + (active ? ' on' : '')}
      role="button" tabIndex={0}
      onClick={() => onOpen(f.path)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(f.path); } }}
      title={f.path}>
      <div className="art-thumbcol">
        <div className="art-thumb" style={tint ? { color: tint } : undefined}>
          <FileText />
          <span className="art-thumb-ext">{(ext || 'file').toUpperCase().slice(0, 4)}</span>
        </div>
      </div>
      <div className="art-card-body">
        <div className="art-card-title">{baseName(f.path)}</div>
        <div className="art-card-sub">{state || sub}</div>
      </div>
      {!writing && !pending && (
        <a className="art-card-dl" href={`/api/chats/${chatId}/file?path=${encodeURIComponent(f.path)}&download=1`}
          onClick={e => e.stopPropagation()} title={t("Download")}><Download style={{ width: 16 }} /></a>
      )}
    </div>
  );
}

function metaSub(f) {
  return [extOf(f.path).toUpperCase() || 'FILE', f.size != null ? fmtSize(f.size) : '', f.v > 1 ? 'v' + f.v : '']
    .filter(Boolean).join(' · ');
}

function FolderRow({ node, open, onToggle }) {
  const n = countFiles(node);
  return (
    <button className={'art-folder' + (open ? ' open' : '')} onClick={() => onToggle(node.path)} aria-expanded={open} title={node.path}>
      <ChevDown className={'af-chev' + (open ? ' open' : '')} style={{ width: 14 }} />
      <Folder style={{ width: 16 }} className="af-icon" />
      <span className="af-name">{node.name}</span>
      <span className="af-count">{n}</span>
    </button>
  );
}

function Node({ node, chatId, closed, onToggle, onOpen, sel, live, pending }) {
  return (
    <>
      {[...node.dirs.values()].map(d => {
        const open = !closed.has(d.path);
        return (
          <div className="art-tree-group" key={d.path}>
            <FolderRow node={d} open={open} onToggle={onToggle} />
            {open && (
              <div className="art-tree-kids">
                <Node node={d} chatId={chatId} closed={closed} onToggle={onToggle} onOpen={onOpen}
                  sel={sel} live={live} pending={pending} />
              </div>
            )}
          </div>
        );
      })}
      {node.files.map(f => (
        <FileCard key={f.path} f={f} chatId={chatId} sub={metaSub(f)}
          writing={!!live && live.path === f.path}
          pending={!!pending && f.path in pending}
          active={sel === f.path} onOpen={onOpen} />
      ))}
    </>
  );
}

export default function FileTree({ tree, chatId, closed, onToggle, onOpen, sel, live, pending }) {
  return (
    <div className="art-tree">
      <Node node={tree} chatId={chatId} closed={closed} onToggle={onToggle} onOpen={onOpen}
        sel={sel} live={live} pending={pending} />
    </div>
  );
}
