import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildTree, collapseRuns } from '../lib/threadmeta.js';
import { useFocusTrap } from '../lib/focus.js';
import { X, Fork } from './icons.jsx';
import { t } from '../i18n.jsx';

const RUN_HEAD = 2;
const RUN_TAIL = 2;
const RUN_FOLD = 6;

function Node({ node, active, onSelect }) {
  const cls = ['bt-node', 'r-' + node.role];
  if (node.onPath) cls.push('on-path');
  if (node.id === active) cls.push('is-leaf');
  const who = node.role === 'user' ? t('You') : (node.modelName || t('Assistant'));
  const action = node.onPath ? t('Jump to this message') : t('Switch to this branch');
  return (
    <button
      type="button"
      className={cls.join(' ')}
      onClick={() => onSelect(node)}
      aria-current={node.onPath ? 'true' : undefined}
      title={(node.preview || who) + ' (' + action + ')'}
    >
      <span className="bt-dot" aria-hidden="true" />
      <span className="bt-who">{who}</span>
      <span className="bt-text">{node.preview || t('(empty)')}</span>
    </button>
  );
}

function Run({ nodes, active, onSelect }) {
  const [open, setOpen] = useState(false);
  const folded = nodes.length > RUN_FOLD && !open;
  const shown = folded ? [...nodes.slice(0, RUN_HEAD), null, ...nodes.slice(nodes.length - RUN_TAIL)] : nodes;
  const hidden = nodes.length - RUN_HEAD - RUN_TAIL;
  return (
    <div className="bt-run">
      {shown.map((n, i) => n
        ? <Node key={n.id} node={n} active={active} onSelect={onSelect} />
        : <button key="fold" type="button" className="bt-fold" onClick={() => setOpen(true)}>{t('{n} more turns', { n: hidden })}</button>
      )}
    </div>
  );
}

function Segment({ node, active, onSelect, depth }) {
  const { run, forks } = useMemo(() => collapseRuns(node), [node]);
  return (
    <div className="bt-seg">
      <Run nodes={run} active={active} onSelect={onSelect} />
      {forks.length > 0 && (
        <div className="bt-split" data-depth={depth}>
          {forks.map((f, i) => (
            <div className={'bt-branch' + (f.onPath ? ' on-path' : '')} key={f.id}>
              <div className="bt-branch-tag">{t('Version {n}', { n: i + 1 })}</div>
              <Segment node={f} active={active} onSelect={onSelect} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BranchTree({ chatId, onSelect, onJump, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose);

  useEffect(() => {
    let live = true;
    api.get('/api/chats/' + chatId + '/tree')
      .then(d => { if (live) setData(d); })
      .catch(() => { if (live) setErr(t('Could not load the branch map.')); });
    return () => { live = false; };
  }, [chatId]);

  const roots = useMemo(() => (data ? buildTree(data.nodes) : []), [data]);
  const branchCount = useMemo(() => {
    if (!data) return 0;
    const kids = new Map();
    for (const n of data.nodes) {
      const k = n.parentId || '_root';
      kids.set(k, (kids.get(k) || 0) + 1);
    }
    let splits = 0;
    for (const v of kids.values()) if (v > 1) splits++;
    return splits;
  }, [data]);

  function pick(node) {
    onClose();
    if (node.onPath) onJump?.(node.id);
    else onSelect(node.id);
  }

  return (
    <div className="overlay bt-overlay" onMouseDown={(e) => e.target.classList.contains('bt-overlay') && onClose()}>
      <div className="bt-modal" ref={boxRef} role="dialog" aria-modal="true" aria-label={t('Branch map')}>
        <div className="bt-head">
          <div className="bt-title"><Fork style={{ width: 16 }} /> {t('Branch map')}</div>
          {data && (
            <div className="bt-sub">
              {branchCount > 0
                ? t('{n} branch points, {m} messages', { n: branchCount, m: data.nodes.length })
                : t('{m} messages, no branches yet', { m: data.nodes.length })}
            </div>
          )}
          <button type="button" className="bt-x" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X style={{ width: 15 }} /></button>
        </div>
        <div className="bt-body">
          {err && <div className="bt-empty">{err}</div>}
          {!err && !data && <div className="bt-empty">{t('Loading…')}</div>}
          {data && !roots.length && <div className="bt-empty">{t('Nothing here yet.')}</div>}
          {roots.map(r => <Segment key={r.id} node={r} active={data.activeLeaf} onSelect={pick} depth={0} />)}
        </div>
        <div className="bt-foot">{t('Messages on the current path jump you there. Anything else switches the conversation to that branch.')}</div>
      </div>
    </div>
  );
}
