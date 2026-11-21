import crypto from 'crypto';
import { db, closeDb } from '../db.js';
import { hash } from '../auth.js';
import { removeFactors } from '../lib/identity/mfa.js';
import { logAudit } from '../lib/audit.js';

const at = process.argv.indexOf('--email');
const email = at > 0 ? String(process.argv[at + 1] || '').trim().toLowerCase() : '';
if (!email) {
  console.error('Usage: npm run auth:recover -- --email <address>');
  process.exit(1);
}

const user = db.users.byEmail(email);
if (!user) {
  console.error(`No account uses ${email}.`);
  closeDb();
  process.exit(1);
}

const temporary = crypto.randomBytes(12).toString('base64url');
removeFactors(user.id);
db.users.update(user.id, { password_hash: await hash(temporary) });
db.sessions.removeWhere('user_id', user.id);
logAudit({}, 'user.recover', { type: 'user', id: user.id, meta: { email, via: 'console' } });
closeDb();

console.log(`Two-factor was removed and every session ended for ${email}.`);
console.log(`Temporary password: ${temporary}`);
console.log('Sign in with it, then change it under Settings, Security.');