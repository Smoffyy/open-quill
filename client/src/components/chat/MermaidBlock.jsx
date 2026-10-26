import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import CodeBlock from './CodeBlock.jsx';
import { SegSlide } from '../ui/controls.jsx';
import { isDarkMode, renderMermaid, subscribeThemeMode } from '../../lib/mermaid.js';
import { t } from '../../i18n.jsx';

const RENDER_DELAY = 400;

function MermaidBlock({ code }) {
  const dark = useSyncExternalStore(subscribeThemeMode, isDarkMode, () => true);
  const blockRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState('diagram');

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      const font = blockRef.current ? getComputedStyle(blockRef.current).fontFamily : undefined;
      renderMermaid(code, dark, font)
        .then(out => { if (alive) { setSvg(out); setFailed(false); } })
        .catch(() => { if (alive) setFailed(true); });
    }, RENDER_DELAY);
    return () => { alive = false; clearTimeout(timer); };
  }, [code, dark]);

  const showDiagram = view === 'diagram' && svg;
  return (
    <div className="diagram-block" ref={blockRef}>
      <div className="diagram-bar">
        <span className="diagram-label">{t('Diagram')}</span>
        {failed && <span className="diagram-note">{svg ? t('Showing the last version that could be drawn.') : t('This diagram could not be drawn.')}</span>}
        {svg && (
          <SegSlide label={t('View')} className="diagram-view" value={showDiagram ? 'diagram' : 'code'} onPick={setView}
            options={[{ v: 'diagram', label: t('Diagram') }, { v: 'code', label: t('Code') }]} />
        )}
      </div>
      {showDiagram
        ? <div className="diagram-svg" role="img" aria-label={t('Mermaid diagram')} dangerouslySetInnerHTML={{ __html: svg }} />
        : <CodeBlock lang="mermaid" code={code} />}
    </div>
  );
}

export default React.memo(MermaidBlock);