import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SUPABASE_URL = 'https://joknhyopvvdsljfjertr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV';

const SESSION_DIR = join(homedir(), '.scholia-cli');
const SESSION_FILE = join(SESSION_DIR, 'session.json');

export function makeClient(accessToken?: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    auth: { persistSession: false },
  });
}

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

function loadSavedSession(): Session | null {
  try {
    const raw = readFileSync(SESSION_FILE, 'utf-8');
    const s = JSON.parse(raw) as Session;
    // Check token hasn't expired
    if (s?.expires_at && s.expires_at * 1000 > Date.now()) return s;
  } catch {
    // no saved session
  }
  return null;
}

function saveSession(session: Session): void {
  try {
    mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  } catch {
    // ignore write errors
  }
}

export function clearSavedSession(): void {
  try {
    writeFileSync(SESSION_FILE, '{}');
  } catch {
    // ignore
  }
}

export async function getOrCreateSession(
  promptCreds: () => Promise<{ email: string; password: string }>,
): Promise<{ session: Session; client: SupabaseClient }> {
  const saved = loadSavedSession();
  if (saved) {
    const client = makeClient(saved.access_token);
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      return { session: saved, client };
    }
  }

  const { email, password } = await promptCreds();
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Login failed: ${error?.message ?? 'no session returned'}`);
  }
  saveSession(data.session);
  const client = makeClient(data.session.access_token);
  return { session: data.session, client };
}
