import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.SUPABASE_URL || "https://joknhyopvvdsljfjertr.supabase.co";
// Publishable key (client-safe); same as legacy "anon" key. Never use service_role/secret in the browser.
const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV";

if (import.meta.env.DEV) {
  const host = supabaseUrl?.replace(/^https?:\/\//, '').split('/')[0] || '?';
  console.log('[Scholia] Frontend Supabase:', host, '(worker must match—check worker/.env)');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
