import { Bulb, Pencil, Code, Coffee, Graduation, Sparkles, Search, Chat, FileText, Star } from './components/icons.jsx';

export const QP_ICONS = {
  none: null,
  bulb: Bulb,
  pencil: Pencil,
  code: Code,
  coffee: Coffee,
  learn: Graduation,
  sparkles: Sparkles,
  search: Search,
  chat: Chat,
  file: FileText,
  star: Star
};

export const QP_ICON_LIST = ['none', 'bulb', 'pencil', 'code', 'coffee', 'learn', 'sparkles', 'search', 'chat', 'file', 'star'];

export function QpIcon({ name, ...rest }) {
  const Ic = QP_ICONS[name];
  if (!Ic) return null;
  return <Ic {...rest} />;
}
