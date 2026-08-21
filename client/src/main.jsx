import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import 'highlight.js/styles/github-dark.css';
import { ensureCommon } from './lib/hljs.js';
import { ensureKatex } from './lib/mathjs.js';
import './styles/app.css';
import App from './App.jsx';
import { getLang, loadLang, useI18n } from './i18n.jsx';
import { applyUserFont } from './prefs.js';

applyUserFont();

function Root() {
  const { lang } = useI18n();
  return <App key={lang} />;
}

loadLang(getLang()).then(() => {
  createRoot(document.getElementById('root')).render(<Root />);
});

const idlePreload = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : ((cb) => setTimeout(cb, 1200));
idlePreload(() => { ensureCommon(); });
idlePreload(() => { ensureKatex(); });
