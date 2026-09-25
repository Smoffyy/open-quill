import { useState, useRef, useEffect } from 'react';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import SettingsNav, { TAB_LABELS } from './SettingsNav.jsx';
import GeneralTab from './GeneralTab.jsx';
import InterfaceTab from './InterfaceTab.jsx';
import ChatTab from './ChatTab.jsx';
import SecurityTab from './SecurityTab.jsx';
import UsageTab from './UsageTab.jsx';
import MemoryTab from './MemoryTab.jsx';
import VersionTab from './VersionTab.jsx';
import KeybindsPanel from './KeybindsPanel.jsx';
import SkillsSection from './SkillsSection.jsx';
import UserMcpSection from './UserMcpSection.jsx';
import { t } from '../../i18n.jsx';
import { useSettingsDraft } from '../../lib/settingsdraft.js';

const FLUSH_TABS = new Set(['skills', 'mcp']);

function findRow(body, text) {
  const want = text.trim().toLowerCase();
  const rows = [...body.querySelectorAll('.set-row, .field, .me-section-h')];
  const labelOf = (el) => (el.matches('.me-section-h') ? el : el.querySelector('.set-row-title, label'));
  const said = (el) => (labelOf(el)?.textContent || '').trim().toLowerCase();
  return rows.find(el => said(el) === want) || rows.find(el => said(el).startsWith(want)) || null;
}

export default function SettingsModal({ user, cfg, modelId, initialTab, browseSkills = false, onClose, onUpdated, onDeleted, onExportChats, onImportChats, onTrySkill, onChangelog }) {
  const [tab, setTab] = useState(initialTab || 'general');
  const [reveal, setReveal] = useState(null);
  const [browse, setBrowse] = useState(browseSkills);
  const bodyRef = useRef(null);
  const draft = useSettingsDraft(user, onUpdated);
  const { prefs, setPref } = draft;

  const pick = (id, hit) => {
    setBrowse(false);
    setTab(id);
    setReveal(hit ? { text: hit, at: Date.now() } : null);
  };

  useEffect(() => {
    if (!reveal) return undefined;
    const frame = requestAnimationFrame(() => {
      const row = bodyRef.current && findRow(bodyRef.current, reveal.text);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.classList.remove('set-flash');
      void row.offsetWidth;
      row.classList.add('set-flash');
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  let content = null;
  if (tab === 'general') content = <GeneralTab user={user} draft={draft} onExportChats={onExportChats} onImportChats={onImportChats} onDeleted={onDeleted} />;
  else if (tab === 'interface') content = <InterfaceTab prefs={prefs} setPref={setPref} cfg={cfg} />;
  else if (tab === 'chat') content = <ChatTab prefs={prefs} setPref={setPref} cfg={cfg} />;
  else if (tab === 'security') content = <SecurityTab user={user} onUpdated={onUpdated} />;
  else if (tab === 'keybinds') content = <KeybindsPanel prefs={prefs} setPref={setPref} />;
  else if (tab === 'memory') content = <MemoryTab user={user} prefs={prefs} setPref={setPref} modelId={modelId} onUpdated={onUpdated} />;
  else if (tab === 'usage') content = <UsageTab />;
  else if (tab === 'version') content = <VersionTab cfg={cfg} onChangelog={onChangelog} />;
  else if (tab === 'skills') content = <SkillsSection browse={browse} onTrySkill={(sk) => { onTrySkill?.(sk); onClose(); }} />;
  else if (tab === 'mcp') content = <UserMcpSection />;

  const flush = FLUSH_TABS.has(tab);
  return (
    <Dialog className="modal" label={t('Settings')} onClose={onClose} focusSelf>
      <SettingsNav tab={tab} cfg={cfg} onPick={pick} />
      <div className="modal-main">
        {flush ? content : (
          <>
            <div className="modal-head"><h2 className="modal-title">{t(TAB_LABELS[tab] || 'Settings')}</h2></div>
            <div className="modal-body" ref={bodyRef} key={tab}>{content}</div>
          </>
        )}
      </div>
      <CloseButton className="ring" onClick={onClose} />
    </Dialog>
  );
}
