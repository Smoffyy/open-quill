export const MEMBER = 'member';
export const ADMIN = 'admin';

export const PERMISSIONS = [
  { id: 'chats.create', tier: MEMBER, category: 'chats' },
  { id: 'chats.edit', tier: MEMBER, category: 'chats' },
  { id: 'chats.delete', tier: MEMBER, category: 'chats' },
  { id: 'chats.export', tier: MEMBER, category: 'chats' },
  { id: 'chats.incognito', tier: MEMBER, category: 'chats' },
  { id: 'chats.inspect', tier: MEMBER, category: 'chats' },
  { id: 'chats.advanced', tier: MEMBER, category: 'chats', baseline: false },
  { id: 'chats.share', tier: MEMBER, category: 'chats' },
  { id: 'models.unavailable', tier: MEMBER, category: 'chats', baseline: false },
  { id: 'code.use', tier: MEMBER, category: 'workspace' },
  { id: 'projects.create', tier: MEMBER, category: 'workspace' },
  { id: 'projects.share', tier: MEMBER, category: 'workspace' },
  { id: 'uploads.create', tier: MEMBER, category: 'workspace' },
  { id: 'tasks.schedule', tier: MEMBER, category: 'workspace' },
  { id: 'skills.create', tier: MEMBER, category: 'workspace' },
  { id: 'skills.share', tier: MEMBER, category: 'workspace' },
  { id: 'mcp.connect', tier: MEMBER, category: 'tools' },
  { id: 'tools.web_search', tier: MEMBER, category: 'tools' },
  { id: 'tools.mcp', tier: MEMBER, category: 'tools' },
  { id: 'tools.memory', tier: MEMBER, category: 'tools' },
  { id: 'tools.chat_search', tier: MEMBER, category: 'tools' },
  { id: 'tools.reference_files', tier: MEMBER, category: 'tools' },
  { id: 'tools.consult', tier: MEMBER, category: 'tools' },
  { id: 'voice.dictation', tier: MEMBER, category: 'voice' },
  { id: 'voice.call', tier: MEMBER, category: 'voice' },
  { id: 'account.delete', tier: MEMBER, category: 'account' },
  { id: 'admin.panel', tier: ADMIN, category: 'admin' },
  { id: 'admin.models', tier: ADMIN, category: 'admin' },
  { id: 'admin.providers', tier: ADMIN, category: 'admin' },
  { id: 'admin.tools', tier: ADMIN, category: 'admin' },
  { id: 'admin.interface', tier: ADMIN, category: 'admin' },
  { id: 'admin.policy', tier: ADMIN, category: 'admin' },
  { id: 'admin.quality', tier: ADMIN, category: 'admin' },
  { id: 'admin.usage', tier: ADMIN, category: 'admin' },
  { id: 'admin.audit', tier: ADMIN, category: 'admin' },
  { id: 'admin.storage', tier: ADMIN, category: 'admin' },
  { id: 'admin.publish', tier: ADMIN, category: 'admin' },
  { id: 'admin.users', tier: ADMIN, category: 'admin' },
  { id: 'admin.groups', tier: ADMIN, category: 'admin' }
];

const BY_ID = new Map(PERMISSIONS.map(p => [p.id, p]));

export const PERMISSION_IDS = PERMISSIONS.map(p => p.id);
export const MEMBER_PERMISSIONS = PERMISSIONS.filter(p => p.tier === MEMBER).map(p => p.id);
export const ADMIN_PERMISSIONS = PERMISSIONS.filter(p => p.tier === ADMIN).map(p => p.id);
export const DEFAULT_USER_BASELINE = PERMISSIONS.filter(p => p.tier === MEMBER && p.baseline !== false).map(p => p.id);

export const isPermission = (id) => BY_ID.has(id);
export const tierOf = (id) => BY_ID.get(id)?.tier || null;

export function cleanPermissions(list, tier = null) {
  const wanted = new Set(Array.isArray(list) ? list.filter(id => typeof id === 'string') : []);
  return PERMISSIONS.filter(p => wanted.has(p.id) && (!tier || p.tier === tier)).map(p => p.id);
}