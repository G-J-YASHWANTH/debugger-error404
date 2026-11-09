const { createClient } = require('@supabase/supabase-js');

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function ensureSchema() { return true; }

module.exports = { supabaseClient, ensureSchema };
