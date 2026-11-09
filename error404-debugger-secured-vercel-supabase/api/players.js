const crypto = require('crypto');
const { supabaseClient } = require('../lib/db');
const { validSession } = require('../lib/auth');

const PUBLIC_FIELDS = 'id,name,type,solved,pts,time,status';
const ORGANIZER_FIELDS = 'id,name,type,members,solved,pts,time,violations,help,qi,status,log,ts';
const EVENT_RE = /^[a-z][a-z0-9_]{0,39}$/;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients; authorization is still required below.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function safeInt(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
function cleanLog(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-10).map(x => ({
    t: safeInt(x && x.t, 0, 9999999999999, Date.now()),
    w: String(x && x.w || 'Warning').slice(0, 120),
    q: safeInt(x && x.q, 0, 7, 0)
  }));
}
function cleanDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  let json;
  try { json = JSON.stringify(value); } catch { return {}; }
  if (json.length > 6000) return { truncated: true };
  return JSON.parse(json);
}
function normalizeNew(p, tokenHash) {
  return {
    id: String(p.id), name: String(p.name).trim().slice(0, 100),
    type: p.type === 'team' ? 'team' : 'solo',
    members: String(p.members || '').slice(0, 500),
    solved: 0, pts: 0, time: 0, violations: 0, help: 0, qi: 0,
    status: 'playing', log: [], ts: Date.now(), participant_token_hash: tokenHash
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const sb = supabaseClient();
    const organizer = validSession(req);

    if (req.method === 'GET') {
      const fields = organizer ? ORGANIZER_FIELDS : PUBLIC_FIELDS;
      const { data, error } = await sb.from('participants').select(fields)
        .order('solved', { ascending: false }).order('time', { ascending: true }).order('name', { ascending: true });
      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin request blocked' });

    const p = req.body || {};
    if (!p.id || !p.name || String(p.name).trim().length > 100) {
      return res.status(400).json({ error: 'A participant id and name (up to 100 characters) are required' });
    }
    const id = String(p.id).slice(0, 80);

    // Organizer roster creation is permitted only with the HttpOnly organizer session.
    if (organizer) {
      const row = {
        id, name: String(p.name).trim().slice(0, 100),
        type: p.type === 'team' ? 'team' : 'solo',
        members: String(p.members || '').slice(0, 500),
        solved: 0, pts: 0, time: 0, violations: 0, help: 0, qi: 0,
        status: 'added_by_organizer', log: [], ts: Date.now(), participant_token_hash: null
      };
      const { data, error } = await sb.from('participants').insert(row).select(ORGANIZER_FIELDS).single();
      if (error) throw error;
      const details = { source: 'organizer' };
      const { error: activityError } = await sb.from('activities').insert({ participant_id: id, event_type: 'organizer_added', question: 0, timestamp: Date.now(), details });
      if (activityError) console.error('Could not write organizer activity:', activityError);
      return res.status(201).json({ ok: true, player: data });
    }

    // First participant save creates a random capability token. All later writes
    // must present that token; knowing another participant's public id is not enough.
    const { data: existing, error: lookupError } = await sb.from('participants')
      .select('id,name,type,members,solved,pts,time,violations,help,qi,status,log,ts,participant_token_hash')
      .eq('id', id).maybeSingle();
    if (lookupError) throw lookupError;

    let player, issuedToken = null;
    if (!existing) {
      if (p.eventType !== 'participant_started') {
        return res.status(401).json({ error: 'Start a new participant session before submitting progress' });
      }
      issuedToken = crypto.randomBytes(32).toString('base64url');
      const row = normalizeNew(p, hashToken(issuedToken));
      const { data, error } = await sb.from('participants').insert(row).select(ORGANIZER_FIELDS).single();
      if (error) throw error;
      player = data;
    } else {
      const supplied = String(req.headers['x-participant-token'] || '');
      if (!existing.participant_token_hash || !supplied ||
          !crypto.timingSafeEqual(Buffer.from(hashToken(supplied)), Buffer.from(existing.participant_token_hash))) {
        return res.status(401).json({ error: 'Participant session token is missing or invalid. Return to the lobby and rejoin.' });
      }
      const eventType = String(p.eventType || 'state');
      if (!EVENT_RE.test(eventType)) return res.status(400).json({ error: 'Invalid activity type' });
      const incomingLog = cleanLog(p.log);
      const row = {
        solved: safeInt(p.solved, existing.solved, 7, existing.solved),
        pts: safeInt(p.pts, existing.pts, 1200, existing.pts),
        time: safeInt(p.time, existing.time, 2147483647, existing.time),
        violations: safeInt(p.violations, existing.violations, 10000, existing.violations),
        help: safeInt(p.help, existing.help, 10000, existing.help),
        qi: safeInt(p.qi, existing.qi, 7, existing.qi),
        status: ['playing', 'finished'].includes(p.status) ? p.status : existing.status,
        log: incomingLog.length ? incomingLog : (existing.log || []),
        ts: Date.now()
      };
      const { data, error } = await sb.from('participants').update(row).eq('id', id)
        .eq('participant_token_hash', hashToken(supplied)).select(ORGANIZER_FIELDS).single();
      if (error) throw error;
      player = data;
    }

    const details = cleanDetails(p.details);
    const q = Number.isFinite(Number(details.question)) ? safeInt(details.question, 0, 7, 0) : safeInt(p.qi, 0, 7, 0);
    const eventType = String(p.eventType || 'state').slice(0, 40);
    const { error: activityError } = await sb.from('activities').insert({ participant_id: id, event_type: eventType, question: q, timestamp: Date.now(), details });
    if (activityError) console.error('Could not write participant activity:', activityError);

    const response = { ok: true, player };
    if (issuedToken) response.participantToken = issuedToken;
    return res.status(200).json(response);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
