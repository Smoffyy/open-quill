import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import 'highlight.js/styles/github-dark.css';
import './styles/app.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
