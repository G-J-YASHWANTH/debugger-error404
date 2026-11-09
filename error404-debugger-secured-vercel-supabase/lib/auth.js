const crypto = require('crypto');

const COOKIE = 'debugger_admin';

function secret() {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured');
  return process.env.SESSION_SECRET;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ role: 'organizer', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function validSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='));
  if (!match) return false;
  try {
    const token = decodeURIComponent(match.slice(COOKIE.length + 1));
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = sign(payload);
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'organizer' && data.exp > Date.now();
  } catch { return false; }
}

function setSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(createSession())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

function requireOrganizer(req, res) {
  if (!validSession(req)) {
    res.status(401).json({ ok: false, error: 'Organizer authentication required' });
    return false;
  }
  return true;
}

module.exports = { COOKIE, setSession, clearSession, validSession, requireOrganizer };
