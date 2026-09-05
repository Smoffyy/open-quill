import { Search } from './icons.jsx';
import Tip from './Tip.jsx';
import { t } from '../i18n.jsx';

export function LibraryTabs({ value, onChange, tabs }) {
  return (
    <div className="lib-tabs" role="tablist">
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id}
          className={'lib-tab' + (value === tab.id ? ' on' : '')}
          onClick={() => onChange && onChange(tab.id)}>{tab.label}</button>
      ))}
    </div>
  );
}

export function LibraryEmpty({ icon, line, children }) {
  return (
    <div className="lib-empty">
      {icon && <div className="lib-empty-art" aria-hidden="true">{icon}</div>}
      {line && <p className="lib-empty-line">{line}</p>}
      {children}
    </div>
  );
}

export default function LibraryPage({ title, subtitle, onSearch, actions, tabs, tabValue, onTab, children }) {
  return (
    <div className="lib-page">
      <div className="lib-col">
        <div className="lib-head">
          <div className="lib-headings">
            <h1 className="lib-title">{title}</h1>
            {subtitle && <p className="lib-sub">{subtitle}</p>}
          </div>
          <div className="lib-actions">
            {onSearch && (
              <Tip label={t('Search')}>
                <button className="lib-icon-btn" onClick={onSearch} aria-label={t('Search')}><Search /></button>
              </Tip>
            )}
            {actions}
          </div>
        </div>
        {tabs && <LibraryTabs value={tabValue} onChange={onTab} tabs={tabs} />}
        <div className="lib-body">{children}</div>
      </div>
    </div>
  );
}
