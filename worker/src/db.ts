import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

// Use service role key to bypass RLS
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Log connection on load (helps debug "worker never claims jobs" - verify URL matches frontend)
const urlDisplay = supabaseUrl ? supabaseUrl.replace(/^https?:\/\//, '').slice(0, 50) : 'NOT SET';
console.log(`[worker] Supabase URL: ${urlDisplay}... (must match frontend/Vite .env)`);
