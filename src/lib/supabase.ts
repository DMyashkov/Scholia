import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.SUPABASE_URL || "https://joknhyopvvdsljfjertr.supabase.co";

const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV";

if (import.meta.env.DEV) {
  const host = supabaseUrl?.replace(/^https?:\/\//, '').split('/')[0] || '?';
  const hasKey = !!supabasePublishableKey && supabasePublishableKey.length > 20;
  console.log('[Scholia] Frontend Supabase:', host, hasKey ? '✓' : '⚠ missing/invalid SUPABASE_PUBLISHABLE_KEY—check root .env');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);