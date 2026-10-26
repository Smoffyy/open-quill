import { useState } from 'react';
import { Btn, IconBtn, Area, Input, Select, Empty } from '../admin/ui.jsx';
import { Plus, Trash, Retry, Pencil, Stop, ListChecks, Check, X } from '../ui/icons.jsx';
import { t } from '../../i18n.jsx';
import { laneKey } from '../../lib/playground.js';
import Reply from './Reply.jsx';

function Case({ c, index, row, lanes, busy, anyBusy, onPatch, onDrop, onRun, onPrefer, onRequest }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [expect, setExpect] = useState('');
  const compare = lanes.length > 1;
  const cells = lanes.map(l => row?.cells?.[laneKey(l)] || null);
  const save = () => {
    if (prompt.trim()) onPatch({ prompt, expect });
    setEditing(false);
  };

  return (
    <section className={'pg-case' + (busy ? ' running' : '')} aria-label={t('Test {n}', { n: index + 1 })}>
      <header className="pg-case-head">
        <span className="pg-case-n">{index + 1}</span>
        {editing ? (
          <div className="pg-edit grow">
            <Area rows={3} value={prompt} autoFocus aria-label={t('Prompt')} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }} />
            <Input value={expect} placeholder={t('What a good answer looks like (optional)')} aria-label={t('Expected answer')}
              onChange={(e) => setExpect(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }} />
            <div className="cp-acts end">
              <Btn size="sm" onClick={() => setEditing(false)}>{t('Cancel')}</Btn>
              <Btn size="sm" kind="primary" disabled={!prompt.trim()} onClick={save}>{t('Save')}</Btn>
            </div>
          </div>
        ) : (
          <div className="pg-case-text">
            <p>{c.prompt}</p>
            {c.expect && <p className="pg-case-expect"><Check /> {c.expect}</p>}
          </div>
        )}
        {!editing && (
          <div className="pg-case-acts">
            <IconBtn kind="quiet" label={t('Edit test')} disabled={busy} onClick={() => { setPrompt(c.prompt); setExpect(c.expect || ''); setEditing(true); }}><Pencil /></IconBtn>
            <IconBtn kind="quiet" label={t('Delete test')} disabled={busy} onClick={onDrop}><Trash /></IconBtn>
            <Btn size="sm" disabled={anyBusy} onClick={onRun}><Retry /> {row ? t('Run again') : t('Run')}</Btn>
          </div>
        )}
      </header>
      <div className="pg-grid">
        {cells.map((r, i) => (
          <Reply key={lanes[i].id} reply={r} compare={compare} clamp
            preferred={compare && row?.pick === laneKey(lanes[i])}
            onPrefer={compare && r && r.status !== 'run' ? () => onPrefer(laneKey(lanes[i])) : null}
            onRequest={r?.request ? () => onRequest(cells.filter(Boolean), cells.filter(Boolean).indexOf(r)) : null} />
        ))}
      </div>
    </section>
  );
}

export default function Suites({
  suites, suite, rows, lanes, busy, loaded, starter,
  onPick, onCreate, onRename, onDelete, onAddCase, onPatchCase, onDropCase, onRunCase, onRunAll, onStop, onPrefer, onRequest
}) {
  const [naming, setNaming] = useState(null);
  const [draft, setDraft] = useState('');
  const running = busy.size > 0;

  if (loaded && !suites.length) {
    return (
      <div className="pg-scroll">
        <Empty icon={ListChecks} title={t('No test sets yet')}
          actions={<>
            <Btn kind="primary" onClick={() => onCreate(true)}>{t('Start from the starter set')}</Btn>
            <Btn onClick={() => onCreate(false)}><Plus /> {t('Empty set')}</Btn>
          </>}>
          {t('A test set is a list of prompts you run against every column at once, so a release candidate is judged on the same questions every time. Sets are shared with every admin on this server.')}
        </Empty>
        <ul className="pg-starter">{starter.map(p => <li key={p.label}><b>{t(p.label)}</b> {t(p.text)}</li>)}</ul>
      </div>
    );
  }
  if (!suite) return null;

  const commitName = () => { if (naming && draft.trim()) onRename(draft.trim()); setNaming(null); };
  const ran = suite.cases.filter(c => rows?.[c.id]).length;

  return (
    <div className="pg-suite">
      <div className="pg-suite-bar">
        {naming ? (
          <div className="pg-suite-name">
            <Input value={draft} autoFocus aria-label={t('Set name')} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setNaming(null); }} />
            <IconBtn kind="quiet" label={t('Save')} onClick={commitName}><Check /></IconBtn>
            <IconBtn kind="quiet" label={t('Cancel')} onClick={() => setNaming(null)}><X /></IconBtn>
          </div>
        ) : (
          <div className="pg-suite-name">
            <Select label={t('Test set')} value={suite.id} onChange={onPick}
              options={suites.map(s => ({ value: s.id, label: s.name + ' · ' + s.cases.length }))} />
            <IconBtn kind="quiet" label={t('Rename set')} onClick={() => { setDraft(suite.name); setNaming(true); }}><Pencil /></IconBtn>
            <IconBtn kind="quiet" label={t('Delete set')} disabled={running} onClick={onDelete}><Trash /></IconBtn>
            <IconBtn kind="quiet" label={t('New set')} onClick={() => onCreate(false)}><Plus /></IconBtn>
          </div>
        )}
        <span className="cp-spacer" />
        <span className="pg-dim">{t('{done} of {n} run', { done: ran, n: suite.cases.length })}</span>
        {running
          ? <Btn kind="danger" onClick={onStop}><Stop /> {t('Stop')}</Btn>
          : <Btn kind="primary" disabled={!suite.cases.length} onClick={onRunAll}>{t('Run all')}</Btn>}
      </div>
      <div className="pg-scroll">
        <div className="pg-cases">
          {suite.cases.map((c, i) => (
            <Case key={c.id} c={c} index={i} row={rows?.[c.id]} lanes={lanes}
              busy={busy.has('case:' + c.id) || busy.has('suite:' + suite.id)} anyBusy={running}
              onPatch={(p) => onPatchCase(c.id, p)} onDrop={() => onDropCase(c.id)} onRun={() => onRunCase(c.id)}
              onPrefer={(key) => onPrefer(c.id, key)} onRequest={onRequest} />
          ))}
          <AddCase onAdd={onAddCase} first={!suite.cases.length} />
        </div>
      </div>
    </div>
  );
}

function AddCase({ onAdd, first }) {
  const [text, setText] = useState('');
  const add = () => { if (text.trim()) { onAdd(text.trim()); setText(''); } };
  return (
    <div className="pg-add-case">
      <Area rows={2} value={text} aria-label={t('New test prompt')}
        placeholder={first ? t('Write the first prompt for this set') : t('Add another prompt')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }} />
      <Btn size="sm" disabled={!text.trim()} onClick={add}><Plus /> {t('Add test')}</Btn>
    </div>
  );
}