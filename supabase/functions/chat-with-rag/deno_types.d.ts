
declare module 'npm:@supabase/supabase-js@2' {
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>
  ): import('@supabase/supabase-js').SupabaseClient;
}

declare module 'supabase' {
  export type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>
  ): SupabaseClient;
}
