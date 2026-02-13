import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.SUPABASE_URL || "https://joknhyopvvdsljfjertr.supabase.co";
// Publishable key (client-safe); same as legacy "anon" key. Never use service_role/secret in the browser.
const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
