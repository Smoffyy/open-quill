import React, { useState } from 'react';
import { toast } from '../toast.js';
import { copyText } from '../clipboard.js';
import { Sparkles, Wrench, Search, Pencil, Code, Bulb, Sliders, Star, Chat } from './icons.jsx';

const ICONS = { sparkles: Sparkles, wrench: Wrench, search: Search, pencil: Pencil, code: Code, bolt: Bulb, wand: Sparkles, bulb: Bulb, filter: Sliders, star: Star, chat: Chat };

function iconFor(name) { return ICONS[name] || null; }

export default function FunctionsBar({ functions = [], input = '', onChange, onSend, model }) {
  const [busy, setBusy] = useState(null);
  const fns = (functions || []).filter(f => (f.location || 'composer') === 'composer');
  if (!fns.length) return null;

  async function run(fn) {
    if (busy) return;
    const api = {
      get input() { return input; },
      setInput: (t) => onChange?.(String(t ?? '')),
      insert: (t) => onChange?.((input ? input + (input.endsWith('\n') ? '' : '\n') : '') + String(t ?? '')),
      send: () => onSend?.(),
      toast: (m, opts) => toast(String(m ?? ''), opts || {}),
      copy: (t) => copyText(String(t ?? '')),
      fetch: (...a) => window.fetch(...a),
      model: model ? { id: model.id, name: model.displayName } : null
    };
    setBusy(fn.id);
    try {
      const runner = new Function('api', `return (async () => {\n${fn.code}\n})();`);
      await runner(api);
    } catch (e) {
      toast('Function "' + fn.label + '" failed: ' + (e?.message || e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fn-bar">
      {fns.map(fn => {
        const Icon = iconFor(fn.icon);
        return (
          <button key={fn.id} type="button" className={'fn-btn' + (busy === fn.id ? ' busy' : '')} onClick={() => run(fn)} disabled={!!busy} title={fn.label}>
            {Icon && <Icon style={{ width: 14 }} />}<span>{fn.label}</span>
          </button>
        );
      })}
    </div>
  );
}
