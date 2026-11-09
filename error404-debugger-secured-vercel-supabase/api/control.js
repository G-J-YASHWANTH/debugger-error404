const { supabaseClient } = require('../lib/db');
const { validSession } = require('../lib/auth');

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const sb = supabaseClient();
    if (req.method === 'GET') {
      const { data, error } = await sb.from('game_control').select('id,question_index,phase,action,action_at,revision,updated_at').eq('id', 1).maybeSingle();
      if (error) throw error;
      return res.status(200).json(data || { id: 1, question_index: 0, phase: 'lobby', action: 'init', action_at: 0, revision: 0 });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin request blocked' });
    if (!validSession(req)) return res.status(401).json({ error: 'Organizer authentication required' });

    const body = req.body || {};
    const question = Number(body.question_index);
    const phases = ['lobby', 'question', 'leaderboard', 'paused', 'finished'];
    const actions = ['init', 'next', 'leaderboard', 'pause_toggle', 'finish', 'update'];
    if (!Number.isInteger(question) || question < 0 || question > 7) return res.status(400).json({ error: 'Question index must be between 0 and 7' });
    if (!phases.includes(body.phase)) return res.status(400).json({ error: 'Invalid game phase' });
    if (!actions.includes(body.action)) return res.status(400).json({ error: 'Invalid game action' });

    const { data: current, error: readError } = await sb.from('game_control').select('revision').eq('id', 1).maybeSingle();
    if (readError) throw readError;
    const row = {
      id: 1,
      question_index: question,
      phase: body.phase,
      action: body.action,
      action_at: Date.now(),
      revision: (Number(current && current.revision) || 0) + 1,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await sb.from('game_control').upsert(row, { onConflict: 'id' }).select().single();
    if (error) throw error;
    return res.status(200).json(data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
