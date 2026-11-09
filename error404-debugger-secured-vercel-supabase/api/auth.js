const crypto = require('crypto');
const { setSession, clearSession, validSession } = require('../lib/auth');

const attempts = new Map();
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
function passwordMatches(input, expected) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json({ authenticated: validSession(req) });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin request blocked' });
    const action = req.body && req.body.action;
    if (action === 'logout') { clearSession(res); return res.status(200).json({ ok: true }); }
    if (action !== 'login') return res.status(400).json({ error: 'Invalid action' });
    if (!process.env.ORGANIZER_PASSWORD) return res.status(500).json({ error: 'ORGANIZER_PASSWORD is not configured' });

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const entry = attempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 10 * 60 * 1000; }
    if (entry.count >= 10) return res.status(429).json({ error: 'Too many login attempts. Try again in 10 minutes.' });
    if (!passwordMatches(req.body.password, process.env.ORGANIZER_PASSWORD)) {
      entry.count += 1; attempts.set(ip, entry);
      return res.status(401).json({ error: 'Invalid organizer password' });
    }
    attempts.delete(ip);
    setSession(res);
    return res.status(200).json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: e.message }); }
};
