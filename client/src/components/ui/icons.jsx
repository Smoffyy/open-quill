const I = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p} />;
const Dot = (p) => <circle fill="currentColor" stroke="none" {...p} />;
const Page = 'M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z';
const Fold = 'M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19';
const Thumb = 'M7 10.5v10H4.5A1.5 1.5 0 0 1 3 19v-7a1.5 1.5 0 0 1 1.5-1.5zM7 10.5l3.6-6.8a1.6 1.6 0 0 1 2.9.9V9h5.2a2 2 0 0 1 2 2.4l-1.4 7.2a2.4 2.4 0 0 1-2.4 1.9H7';
const SpeakerBody = 'M11.5 4L6.5 8.5h-3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h3l5 4.5z';
const Eyelid = 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z';
export const Plus = (p) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const Minus = (p) => <I {...p}><path d="M5 12h14" /></I>;
export const Link = (p) => <I {...p}><rect x="2.5" y="9.5" width="11" height="5" rx="2.5" transform="rotate(-45 12 12)" /><rect x="10.5" y="9.5" width="11" height="5" rx="2.5" transform="rotate(-45 12 12)" /><path d="M9.7 12h4.6" /></I>;
export const Unlink = (p) => <I {...p}><rect x="1.5" y="9.5" width="8.5" height="5" rx="2.5" transform="rotate(-45 12 12)" /><rect x="14" y="9.5" width="8.5" height="5" rx="2.5" transform="rotate(-45 12 12)" /></I>;
export const Columns = (p) => <I {...p}><rect x="3.5" y="4" width="7" height="16" rx="2" /><rect x="13.5" y="4" width="7" height="16" rx="2" /></I>;
export const Calendar = (p) => <I {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></I>;
export const Chat = (p) => <I {...p}>
  <g transform="translate(0 .6)">
    <path className="ic-b1" d="M3.5 11a6.5 6.5 0 1 1 3.4 5.7L3.5 17.5l.9-3.2A6.5 6.5 0 0 1 3.5 11z" />
    <path className="ic-b2" d="M13.96 5.59A6 6 0 0 1 20.2 14.5L21 18.3l-3.95-1.16A6 6 0 0 1 12.46 16.94" />
  </g>
</I>;
export const NewChatIcon = Plus;
export const Search = (p) => <I {...p}><g className="ic-lens"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5l5 5" /></g></I>;
export const Globe = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></I>;
export const Panel = (p) => <I {...p}><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M9 4.5v15" /></I>;
export const Menu = (p) => <I {...p}><path d="M4 7h16M4 12h16M4 17h16" /></I>;
export const Mic = (p) => <I {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></I>;
export const Wave = (p) => <I {...p}><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" /></I>;
export const Up = (p) => <I {...p}><path d="M12 19V5M6 11l6-6 6 6" /></I>;
export const Enter = (p) => <I {...p}><path d="M19.5 5.5v5a3.5 3.5 0 0 1-3.5 3.5H4.5M9 9.5L4.5 14 9 18.5" /></I>;
export const Stop = (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" /></svg>;
export const Copy = (p) => <I {...p}><rect x="3.5" y="3.5" width="11.5" height="11.5" rx="2.5" /><path d="M15 9h3a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5h-6.5A2.5 2.5 0 0 1 9 18v-3" /></I>;
export const ThumbUp = (p) => <I {...p}><path d={Thumb} /></I>;
export const ThumbDown = (p) => <I {...p}><path d={Thumb} transform="rotate(180 12 12)" /></I>;
export const Retry = (p) => <I {...p}><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.6M20.5 4v4.5H16" /></I>;
export const Check = (p) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>;
export const CheckCircle = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M8.2 12.4l2.6 2.6 5-5.2" /></I>;
export const Chevron = (p) => <I {...p}><path d="M9 6l6 6-6 6" /></I>;
export const ChevDown = (p) => <I {...p}><path d="M6 9l6 6 6-6" /></I>;
export const Down = (p) => <I {...p}><path d="M12 5v14M6 13l6 6 6-6" /></I>;
export const Gear = (p) => <I {...p}><path d="M19.016 10.38 20.889 10.592A9 9 0 0 1 20.889 13.408L19.016 13.62A7.2 7.2 0 0 1 18.106 15.815L19.281 17.29A9 9 0 0 1 17.29 19.281L15.815 18.106A7.2 7.2 0 0 1 13.62 19.016L13.408 20.889A9 9 0 0 1 10.592 20.889L10.38 19.016A7.2 7.2 0 0 1 8.185 18.106L6.71 19.281A9 9 0 0 1 4.719 17.29L5.894 15.815A7.2 7.2 0 0 1 4.984 13.62L3.111 13.408A9 9 0 0 1 3.111 10.592L4.984 10.38A7.2 7.2 0 0 1 5.894 8.185L4.719 6.71A9 9 0 0 1 6.71 4.719L8.185 5.894A7.2 7.2 0 0 1 10.38 4.984L10.592 3.111A9 9 0 0 1 13.408 3.111L13.62 4.984A7.2 7.2 0 0 1 15.815 5.894L17.29 4.719A9 9 0 0 1 19.281 6.71L18.106 8.185A7.2 7.2 0 0 1 19.016 10.38Z" /><circle cx="12" cy="12" r="3" /></I>;
export const Shield = (p) => <I {...p}><path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5C7.5 19.3 4.5 16 4.5 11.5V6z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></I>;
export const Flask = (p) => <I {...p}><path d="M10 3.5v6L4.8 18.3A2 2 0 0 0 6.5 21.5h11a2 2 0 0 0 1.7-3.2L14 9.5v-6M9 3.5h6M7.5 15.5h9" /></I>;
export const Logout = (p) => <I {...p}><path d="M9.5 4.5H6A2.5 2.5 0 0 0 3.5 7v10A2.5 2.5 0 0 0 6 19.5h3.5M15 8l4 4-4 4M19 12H9.5" /></I>;
export const Trash = (p) => <I {...p}><path d="M5.5 7.5l1 11.2a2 2 0 0 0 1.8 1.8h7a2 2 0 0 0 1.8-1.8l1-11.2zM4 7.5h16M9.5 7.5V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5v2M10 11.5v5M14 11.5v5" /></I>;
export const Dots = (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><circle cx="5.5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18.5" cy="12" r="1.5" /></svg>;
export const DotsV = (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><circle cx="12" cy="5.5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="18.5" r="1.5" /></svg>;
export const Cube = (p) => <I {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" /></I>;
export const Clock = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><line className="ic-hand-h" x1="12" y1="12" x2="15.2" y2="14" /><line className="ic-hand-m" x1="12" y1="12" x2="12" y2="7" /></I>;
export const Sliders = (p) => <I {...p}><path d="M4 8h1.5M10.5 8H20M4 16h9.5M18.5 16H20" /><circle cx="8" cy="8" r="2.5" /><circle cx="16" cy="16" r="2.5" /></I>;
export const Keyboard = (p) => <I {...p}><rect x="2.5" y="6" width="19" height="12" rx="3" /><path d="M8 14.5h8" /><Dot cx="6.5" cy="10" r="1.1" /><Dot cx="10" cy="10" r="1.1" /><Dot cx="14" cy="10" r="1.1" /><Dot cx="17.5" cy="10" r="1.1" /></I>;
export const Heart = (p) => <I {...p}><path d="M12 20.5C5.5 16 3 12.8 3 9.3 3 6.7 5 4.8 7.4 4.8c1.8 0 3.4 1 4.6 2.7 1.2-1.7 2.8-2.7 4.6-2.7C19 4.8 21 6.7 21 9.3c0 3.5-2.5 6.7-9 11.2z" /></I>;
export const FileText = (p) => <I {...p}><path d={Page} /><path d={Fold} /><path d="M8.5 12.5h7M8.5 16h5" /></I>;
export const Sun = (p) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></I>;
export const Users = (p) => <I {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5zM15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4a5.5 5.5 0 0 1 3.5 5.1v.5" /></I>;
export const Star = (p) => <I {...p}><path d="M12 3.2L14.6 8.8L20.7 9.5L16.2 13.7L17.4 19.7L12 16.7L6.6 19.7L7.8 13.7L3.3 9.5L9.4 8.8Z" /></I>;
export const Sparkles = (p) => <I {...p}><path d="M11 3.5c.6 4.2 2 5.9 6.5 6.5-4.5.6-5.9 2.3-6.5 6.5-.6-4.2-2-5.9-6.5-6.5C9 9.4 10.4 7.7 11 3.5zM18.5 15v4.5M16.3 17.3h4.4" /></I>;
export const Paper = (p) => <I {...p}><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h3" /></I>;
export const Download = (p) => <I {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></I>;
export const Refresh = (p) => <I {...p}><path d="M20 10a8 8 0 0 0-14.4-2.5M4 4v4.5h4.5" /><path d="M20 10a8 8 0 0 0-14.4-2.5M4 4v4.5h4.5" transform="rotate(180 12 12)" /></I>;
export const Fork = (p) => <I {...p}><circle cx="6" cy="5.5" r="2.2" /><circle cx="18" cy="5.5" r="2.2" /><circle cx="12" cy="18.5" r="2.2" /><path d="M6 7.7v1.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.7M12 12v4.3" /></I>;
export const Pin = (p) => <I {...p}><path d="M8.5 3.5h7l-.9 5.4 3.4 3.4V14h-12v-1.7l3.4-3.4zM12 14.3V21" /></I>;
export const Wrench = (p) => <I {...p}><path d="M14.5 4.2a4.7 4.7 0 0 0-3.8 6.3L3.6 17.6a2 2 0 0 0 2.8 2.8l7.1-7.1a4.7 4.7 0 0 0 6.3-3.8l-3 3-2.6-.7-.7-2.6z" /></I>;
const FolderBack = 'M3 18V7a2 2 0 0 1 2-2h4l2.5 3H19a2 2 0 0 1 2 2v4';
const FolderShut = 'M11.5 8H19a2 2 0 0 1 2 2L21 18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2l0-11a2 2 0 0 1 2-2h4l2.5 3';
const FolderAjar = 'M12 13.2H20.2a1.3 1.3 0 0 1 1.25 1.7L19.7 19.3a.9.9 0 0 1-.7.7H5a2 2 0 0 1-2-2l1.7-3.3a2 2 0 0 1 1.9-1.5h5.4l0 0';
export const Folder = ({ open, ...p }) => {
  const d = open ? FolderAjar : FolderShut;
  return <I {...p}><path d={FolderBack} /><path className="ic-fo-front" d={d} style={{ d: `path("${d}")` }} /></I>;
};
export const FolderOpen = (p) => <Folder {...p} open />;
export const Pencil = (p) => <I {...p}><path d="M4 20l1-4.2L16.3 4.5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19zM14.5 6.5l3 3" /></I>;
export const Compact = (p) => <I {...p}><path d="M12 3.5v5M9.5 6.5L12 9l2.5-2.5M12 20.5v-5M9.5 17.5L12 15l2.5 2.5M4 12h16" /></I>;
export const Ghost = (p) => <I {...p}><path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-1.8L14.3 20 12 18.2 9.7 20 7.3 18.2z" /><Dot cx="9.5" cy="11" r="1.1" /><Dot cx="14.5" cy="11" r="1.1" /></I>;
export const ImageIcon = (p) => <I {...p}><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M3.5 17l5-5 4 4 3-3 5 5" /></I>;
export const Brain = (p) => <I {...p}><path d="M9 20.5v-2.6A7.4 7.4 0 1 1 18.7 10.6l1.7 3.1a.8.8 0 0 1-.7 1.2h-1.4v2.4a1.8 1.8 0 0 1-1.8 1.8H14v1.4z" /><g strokeWidth="1.5"><path d="M9.6 13.2l2.2-3.6 2.8 3.4" /><circle cx="9.6" cy="13.2" r=".9" /><circle cx="11.8" cy="9.6" r=".9" /><circle cx="14.6" cy="13" r=".9" /></g></I>;
export const Calculator = (p) => <I {...p}><rect x="5" y="3" width="14" height="18" rx="3" /><rect x="8" y="6" width="8" height="3.5" rx="1" /><Dot cx="9" cy="13.5" r="1.1" /><Dot cx="12" cy="13.5" r="1.1" /><Dot cx="15" cy="13.5" r="1.1" /><Dot cx="9" cy="17" r="1.1" /><Dot cx="12" cy="17" r="1.1" /><Dot cx="15" cy="17" r="1.1" /></I>;
export const ListChecks = (p) => <I {...p}><path d="M4 6.5l1.5 1.5L8 5M4 15l1.5 1.5L8 13.5M11.5 7h9M11.5 15.5h9" /></I>;
export const Info = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><Dot cx="12" cy="7.9" r="1.1" /></I>;
export const Alert = (p) => <I {...p}><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 9.5v4.5" /><Dot cx="12" cy="17.2" r="1.1" /></I>;
export const TextIcon = (p) => <I {...p}><path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" /></I>;
export const Bulb = (p) => <I {...p}><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V17h5.2v-1.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM9.8 20.2h4.4" /></I>;
export const Code = (p) => <I {...p}><path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5.5l-3 13" /></I>;
export const Terminal = (p) => <I {...p}><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M7.5 10l3 2.5-3 2.5M13 15h3.5" /></I>;
export const Coffee = (p) => <I {...p}><path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 9.5h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5v2M12.5 3.5v2" /></I>;
export const Graduation = (p) => <I {...p}><path d="M12 4.5L2.5 9.5 12 14.5l9.5-5zM6 12v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3V12M21.5 9.5v5" /></I>;
export const Upload = (p) => <I {...p}><path d="M12 16V5M7 9.5l5-5 5 5M5 20h14" /></I>;
export const Send = (p) => <I {...p}><path d="M20.5 3.5L3.5 10l6.5 2.7 2.7 6.5zM10 12.7l4.5-4.5" /></I>;
export const Box = (p) => <I {...p}>
  <path className="ic-lid" d="M6.5 3h11" />
  <path d="M5 6.5h14M3.5 10h17l-1.6 9.3a2 2 0 0 1-2 1.7H7.1a2 2 0 0 1-2-1.7z" />
</I>;
export const X = (p) => <I {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></I>;
export const Wand = (p) => <I {...p}><path d="M4.5 19.5L14 10" /><path d="M17 2.5c.4 2.6 1.3 3.7 4 4-2.7.3-3.6 1.4-4 4-.4-2.6-1.3-3.7-4-4 2.7-.3 3.6-1.4 4-4z" /></I>;
export const Plug = (p) => <I {...p}><path d="M7 9h10v3.5a5 5 0 0 1-10 0zM9.5 3.5V9M14.5 3.5V9M12 17.5V21" /></I>;
export const Gauge = (p) => <I {...p}><path d="M4 17a8.5 8.5 0 1 1 16 0M12 14.2l4-5" /><circle cx="12" cy="14.2" r="1.5" /></I>;
export const Steer = (p) => <I {...p}><path d="M12 3.5L19 20.5l-7-4-7 4z" /></I>;
export const Eye = (p) => <I {...p}><path d={Eyelid} /><circle cx="12" cy="12" r="3" /></I>;
export const EyeOff = (p) => <I {...p}><path d="M3 12s3.5-6.5 9-6.5c1.2 0 2.3.3 3.3.8M21 12s-3.5 6.5-9 6.5c-1.2 0-2.3-.3-3.3-.8M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" /></I>;
export const ModelDocs = (p) => <I {...p}>
  <path className="ic-page-l" d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5" />
  <path className="ic-page-r" d="M12 6.5C14 5 17 4.5 20 5v13c-3-.5-6 0-8 1.5" />
  <path className="ic-page-turn" d="M12 6.5C14 5 17 4.5 20 5v13c-3-.5-6 0-8 1.5" />
  <path d="M12 6.5v13" />
</I>;
export const Expand = (p) => <I {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></I>;
export const Collapse = (p) => <I {...p}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></I>;
export const CodeTag = (p) => <I {...p}><path className="ic-b1" d="M8.5 7.5L4 12l4.5 4.5" /><path className="ic-b2" d="M15.5 7.5L20 12l-4.5 4.5" /><path d="M13.5 5.5l-3 13" /></I>;
export const SkillIcon = (p) => <I {...p}><path d="M13 3L5.5 13.5H11L10 21l8.5-11H13z" /></I>;
export const Artifact = (p) => <I {...p}><circle className="ic-a1" cx="7.5" cy="15.9" r="4" /><g transform="translate(10.25 9.15) rotate(-15)"><path className="ic-a2" d="M-5 0a5 5 0 0 1 10 0z" /></g><rect className="ic-a3" x="13" y="10.4" width="7.5" height="9.5" rx="2" /></I>;
export const Briefcase = (p) => <I {...p}><g className="ic-case"><rect x="3" y="7.5" width="18" height="12.5" rx="3" /><path d="M3 13h18" /></g><path className="ic-handle" d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" /></I>;
export const Palette = (p) => <I {...p}><path className="ic-pal" d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.6-1.4-1.9-1.4-3.2 0-1 .8-1.7 1.9-1.7H17a3.5 3.5 0 0 0 3.5-3.6C20.2 6.6 16.5 3.5 12 3.5z" /><Dot className="ic-dot1" cx="7.8" cy="11.5" r="1.1" /><Dot className="ic-dot2" cx="9.6" cy="7.6" r="1.1" /><Dot className="ic-dot3" cx="14.4" cy="7.6" r="1.1" /></I>;
export const Screenshot = (p) => <I {...p}><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><circle cx="12" cy="12" r="3" /></I>;
export const Telescope = (p) => <I {...p}><rect x="3" y="9" width="15" height="6" rx="2" transform="rotate(-18 10.5 12)" /><path d="M12 15.5l-3 5.5M12 15.5l3 5.5" /></I>;
export const ArrowOut = (p) => <I {...p}><path d="M9 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V15M14 4h6v6M20 4l-9 9" /></I>;
export const Laptop = (p) => <I {...p}><rect x="5" y="5" width="14" height="10" rx="2" /><path d="M2.5 18.5h19" /></I>;
export const PanelRight = (p) => <I {...p}><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M15 4.5v15" /></I>;
export const FilePlus = (p) => <I {...p}><path d={Page} /><path d={Fold} /><path d="M12 11.5v6M9 14.5h6" /></I>;
export const QuickTask = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M13 7l-4 6h3l-1 4 4-6h-3z" /></I>;
export const Speaker = (p) => <I {...p}><path d={SpeakerBody} /><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12" /></I>;
export const SpeakerOff = (p) => <I {...p}><path d={SpeakerBody} /><path d="M16 9.5l5.5 5M21.5 9.5l-5.5 5" /></I>;
export const ArchiveIcon = (p) => <I {...p}><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M4.5 9h15v9a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 18zM10 13h4" /></I>;
export const Tag = (p) => <I {...p}><path d="M3.5 4.5v6.2c0 .5.2 1 .6 1.4l8 8a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8l-8-8a2 2 0 0 0-1.4-.6H5.5a2 2 0 0 0-2 2z" /><Dot cx="8" cy="8.5" r="1.3" /></I>;
export const Bell = (p) => <I {...p}><path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21.5h4" /></I>;