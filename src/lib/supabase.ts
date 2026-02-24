import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.SUPABASE_URL || "https://joknhyopvvdsljfjertr.supabase.co";

const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);