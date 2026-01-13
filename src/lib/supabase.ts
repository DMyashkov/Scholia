import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://joknhyopvvdsljfjertr.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impva25oeW9wdnZkc2xqZmplcnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY2OTI0MDAsImV4cCI6MjA1MjI2ODQwMH0.placeholder";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
