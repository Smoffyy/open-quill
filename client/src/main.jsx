import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import 'highlight.js/styles/github-dark.css';
import './styles/app.css';
import App from './App.jsx';
import { useI18n } from './i18n.jsx';

function Root() {
  const { lang } = useI18n();
  return <App key={lang} />;
}

createRoot(document.getElementById('root')).render(<Root />);
