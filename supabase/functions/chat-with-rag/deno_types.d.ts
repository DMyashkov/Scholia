/* Type declarations for Deno/Supabase Edge Functions - silences IDE errors when Deno extension is not used */

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

declare module 'npm:@supabase/supabase-js@2' {
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>
  ): import('@supabase/supabase-js').SupabaseClient;
}

// Import-map alias from deno.json: "supabase": "npm:@supabase/supabase-js@2"
declare module 'supabase' {
  export type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>
  ): SupabaseClient;
}
