import { useTheme } from '../../lib/theme/store.jsx';
import { fillPlaceholders } from '../../lib/theme/schema.js';

// The one place a builder-authored node reaches the running app. Every type is
// rendered by this switch, so a document can only ever produce markup the app
// already knows how to draw. Nothing here interprets HTML.
function Node({ node, vars }) {
  const text = fillPlaceholders(node.props?.text || '', vars);
  const style = node.style || undefined;
  const common = { 'data-oq-node': node.id, className: 'oq-node oq-node-' + node.type, style };

  switch (node.type) {
    case 'heading':
      return <div {...common}><h3 className="oq-node-heading">{text}</h3></div>;
    case 'text':
      return <div {...common}><p className="oq-node-text">{text}</p></div>;
    case 'badge':
      return <span {...common}><span className="oq-node-badge">{text}</span></span>;
    case 'divider':
      return <div {...common}><hr className="oq-node-divider" /></div>;
    case 'spacer':
      return <div {...common} style={{ ...style, height: node.props?.size || '16px' }} aria-hidden="true" />;
    case 'container':
      return <div {...common}>{text}</div>;
    case 'note':
      return <div {...common}><div className="oq-node-note">{text}</div></div>;
    case 'image': {
      const src = node.props?.src || '';
      // Only same-origin images: everything this app serves comes from here.
      if (!src || /^[a-z]+:/i.test(src)) return null;
      return <div {...common}><img className="oq-node-img" src={src} alt={node.props?.alt || ''} /></div>;
    }
    case 'link': {
      const href = node.props?.href || '';
      const safe = /^(https?:|mailto:|\/)/i.test(href) ? href : '';
      if (!safe) return <div {...common}><span className="oq-node-link">{text}</span></div>;
      return <div {...common}><a className="oq-node-link" href={safe} rel="noreferrer">{text}</a></div>;
    }
    default:
      return null;
  }
}

export default function ThemeSlot({ name }) {
  const ctx = useTheme();
  if (!ctx) return null;
  const nodes = ctx.slotNodes(name);
  if (!nodes.length) return null;
  return (
    <div className="oq-slot" data-oq-slot={name}>
      {nodes.map(n => <Node key={n.id} node={n} vars={ctx.vars} />)}
    </div>
  );
}
