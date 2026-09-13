import { t } from '../i18n.jsx';
import { BRAND_ICON } from '../lib/brand.js';
import { NewChatIcon, Search } from './icons.jsx';

export function contactHref(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'mailto:' + v;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return null;
}

export default function NotFound({ appName, appIcon, path, contact, onHome, onSearch }) {
  const href = contactHref(contact);
  return (
    <div className="notfound" role="region" aria-label={t('Page not found')}>
      <div className="nf-card">
        <img className="nf-mark" src={appIcon || BRAND_ICON} alt="" aria-hidden="true" />
        <div className="nf-code">404</div>
        <h1 className="nf-title">{t('This page does not exist')}</h1>
        <p className="nf-sub">
          {t('Nothing on {app} answers to that address. It may have been renamed, deleted, or never existed.', { app: appName || 'open-quill' })}
        </p>
        {!!path && <div className="nf-path" title={path}>{path}</div>}
        <div className="nf-actions">
          <button className="nf-primary" onClick={onHome}><NewChatIcon /> {t('Start a new chat')}</button>
          <button className="nf-ghost" onClick={onSearch}><Search /> {t('Search your chats')}</button>
        </div>
        {!!contact && (
          <p className="nf-contact">
            {t('Think this is a mistake?')}{' '}
            {href ? <a href={href} rel="noreferrer">{contact}</a> : <span>{contact}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
