import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.SUPABASE_URL || "";
const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY || "";

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY environment variables",
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
