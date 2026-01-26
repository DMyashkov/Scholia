import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://joknhyopvvdsljfjertr.supabase.co";
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
