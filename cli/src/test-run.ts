/**
 * Non-interactive test: log in, find posadachen-material conversation,
 * delete any existing "торене" / "22 varieties" message, run fresh query, dump full debug output.
 */
import { createClient } from '@supabase/supabase-js';
import { FUNCTIONS_URL } from './auth.js';
import {
  listConversations,
  listMessages,
  listSources,
  listCrawlJobsForSources,
  insertUserMessage,
  deleteMessagesFrom,
} from './db.js';
import chalk from 'chalk';

const SUPABASE_URL = 'https://joknhyopvvdsljfjertr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EqkyCysITrfzWU-L-3EkwQ_ONDzMlaV';
const EMAIL = 'damemyashkov@gmail.com';
const PASSWORD = 'Damedame7505#';
const TEST_QUERY = "for each of the 22 varieties agrico (картофени семена) give me \"торене\" info";

function hr(char = '─', w = 80) { return char.repeat(w); }

async function main() {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  console.log(chalk.bold('\n── Auth ──────────────────────────────────────────'));
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (authErr || !authData.session) {
    console.error(chalk.red('Login failed:'), authErr?.message);
    process.exit(1);
  }
  const token = authData.session.access_token;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  console.log(chalk.green('✓ Logged in as'), authData.user?.email);

  // ── 2. Find conversation ──────────────────────────────────────────────────
  console.log(chalk.bold('\n── Conversations ─────────────────────────────────'));
  const convs = await listConversations(client, 20);
  let conv = convs.find(c =>
    c.title?.toLowerCase().includes('posadachen') ||
    c.title?.toLowerCase().includes('картоф') ||
    c.title?.toLowerCase().includes('agrico') ||
    c.title?.toLowerCase().includes('торен')
  ) ?? convs[0] ?? null;

  if (!conv) { console.error(chalk.red('No conversations found')); process.exit(1); }

  console.log(`Found conversation: ${chalk.bold(conv.title ?? 'Untitled')} (${conv.id})`);

  // ── 3. List sources ───────────────────────────────────────────────────────
  console.log(chalk.bold('\n── Sources ───────────────────────────────────────'));
  const sources = await listSources(client, conv.id);
  const crawlJobs = await listCrawlJobsForSources(client, sources.map(s => s.id));
  const jobBySourceId = new Map(crawlJobs.map(j => [j.source_id, j]));
  for (const s of sources) {
    const job = jobBySourceId.get(s.id);
    const status = job?.status ?? 'unknown';
    const indexed = job?.indexed_count != null ? ` (${job.indexed_count} indexed)` : '';
    const c = status === 'completed' ? chalk.green : status === 'running' || status === 'indexing' ? chalk.yellow : chalk.red;
    console.log(`  ${c('●')} ${s.initial_url} [${status}${indexed}]`);
  }

  // ── 4. List recent messages & find/delete existing торене message ─────────
  console.log(chalk.bold('\n── Messages (last 10) ────────────────────────────'));
  const messages = await listMessages(client, conv.id, 50);
  const recent = messages.slice(-10);
  for (const m of recent) {
    const role = m.role === 'user' ? chalk.blue('user') : chalk.green('asst');
    console.log(`  [${role}] ${m.content.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  // Find the last user message that matches the test query theme
  const matchingMsg = [...messages].reverse().find(m =>
    m.role === 'user' && (
      m.content.toLowerCase().includes('торен') ||
      m.content.toLowerCase().includes('varieties') ||
      m.content.toLowerCase().includes('сорт')
    )
  );

  if (matchingMsg) {
    console.log(chalk.bold('\n── Deleting existing matching message ────────────'));
    console.log(`  Deleting from: ${chalk.dim(matchingMsg.id)} — "${matchingMsg.content.slice(0, 80)}"`);
    await deleteMessagesFrom(client, conv.id, matchingMsg.id);
    console.log(chalk.green('  ✓ Deleted'));
  } else {
    console.log(chalk.dim('\n  (no existing matching message found, sending fresh)'));
  }

  // ── 5. Insert user message ────────────────────────────────────────────────
  console.log(chalk.bold('\n── Sending query ─────────────────────────────────'));
  console.log(chalk.dim(`  "${TEST_QUERY}"`));
  const userMsg = await insertUserMessage(client, conv.id, TEST_QUERY);
  console.log(chalk.green(`  ✓ User message inserted: ${userMsg.id}`));

  // ── 6. Call RAG stream with full debug dump ───────────────────────────────
  console.log(chalk.bold('\n── RAG stream ────────────────────────────────────'));

  const res = await fetch(`${FUNCTIONS_URL}/chat-with-rag`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      conversationId: conv.id,
      userMessage: TEST_QUERY,
      rootMessageId: userMsg.id,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const b = await res.json() as Record<string,unknown>; detail = String(b.error ?? b.message ?? detail); } catch {}
    console.error(chalk.red('HTTP error:'), detail);
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let lineN = 0;
  let planPrinted = false;

  // We keep a local copy of the latest thoughtProcess to print diffs
  let lastStepIter = -1;

  const processLine = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    lineN++;

    let event: Record<string, unknown>;
    try { event = JSON.parse(trimmed); }
    catch { console.log(chalk.red(`  [!] unparseable line ${lineN}: ${trimmed.slice(0, 100)}`)); return; }

    if (event.ping) return; // heartbeat

    if (event.error) {
      console.log(chalk.red.bold(`\n✗ ERROR: ${event.error}`));
      return;
    }

    // ── Plan ────────────────────────────────────────────────────────
    if (event.plan) {
      const plan = event.plan as { slots?: unknown[] };
      console.log(chalk.bold.yellow(`\n◈ PLAN — ${plan.slots?.length ?? 0} slot(s)`));
      console.log(JSON.stringify(plan, null, 2));
    }

    // ── ThoughtProcess stream ─────────────────────────────────────
    if (event.thoughtProcess) {
      const tp = event.thoughtProcess as {
        slots?: Array<{ name: string; type: string; description?: string; dependsOn?: string; target_item_count?: number }>;
        steps?: Array<{
          iter: number; action?: string; why?: string;
          subqueries?: Array<{ slot: string; query: string; strategy?: string }>;
          claims?: Array<{ slot: string; key?: string; value: unknown; confidence?: number; chunkIds?: string[] }>;
          completeness?: number;
          slotSnapshot?: Array<{ name: string; type: string; filled: number; target: number | null }>;
          queryGuidance?: string;
          droppedClaims?: Array<{ slot: string; reason: string; value?: unknown; key?: string }>;
          droppedSubqueries?: Array<{ slot: string; query: string; reason: string }>;
          nextAction?: string;
          extractDebug?: unknown;
          listSlotState?: Record<string, unknown>;
        }>;
        slotFillSummary?: Array<{ name: string; type: string; filled: number; target: number | null }>;
        completeness?: number;
        hardStopReason?: string;
        partialAnswerNote?: string;
        expandCorpusReason?: string;
        clarifyQuestions?: string[];
      };

      // Slots — print once
      if (!planPrinted && tp.slots?.length) {
        planPrinted = true;
        console.log(chalk.bold.yellow(`\n◈ SLOTS (${tp.slots.length})`));
        for (const s of tp.slots) {
          const dep = s.dependsOn ? ` ← ${s.dependsOn}` : '';
          const tgt = s.target_item_count ? ` (target=${s.target_item_count})` : '';
          console.log(`  [${s.type}] ${chalk.bold(s.name)}${dep}${tgt}`);
          if (s.description) console.log(`    ${chalk.dim(s.description)}`);
        }
      }

      // Steps — print each new one
      for (const step of (tp.steps ?? [])) {
        if (step.iter <= lastStepIter) continue;
        lastStepIter = step.iter;

        console.log(chalk.bold(`\n◈ STEP ${step.iter} — action=${step.action ?? '?'} next=${step.nextAction ?? '?'}`));
        if (step.why) console.log(`  why: ${chalk.italic(step.why)}`);

        // Subqueries
        if (step.subqueries?.length) {
          console.log(chalk.dim(`  subqueries (${step.subqueries.length}):`));
          for (const sq of step.subqueries) {
            const strat = sq.strategy ? chalk.yellow(`[${sq.strategy}]`) : chalk.dim('[?]');
            console.log(`    ${strat} ${chalk.dim(sq.slot + ':')} ${sq.query}`);
          }
        }

        // Claims
        if (step.claims?.length) {
          const bySlot: Record<string, number> = {};
          for (const c of step.claims) bySlot[c.slot] = (bySlot[c.slot] ?? 0) + 1;
          const summary = Object.entries(bySlot).map(([k,v]) => `${k}:${v}`).join(' ');
          console.log(`  claims: ${step.claims.length} total (${summary})`);
          // Print all claims for full audit
          for (const c of step.claims) {
            const keyStr = c.key ? chalk.dim(`[key:${c.key}] `) : '';
            const valStr = typeof c.value === 'string' ? c.value.slice(0, 100) : JSON.stringify(c.value)?.slice(0, 100);
            const conf = c.confidence != null ? chalk.dim(` ${Math.round(c.confidence * 100)}%`) : '';
            console.log(`    · ${chalk.dim(c.slot)} ${keyStr}${valStr}${conf}`);
          }
        } else {
          console.log(chalk.red('  claims: NONE'));
        }

        // Completeness
        if (step.completeness != null) {
          const p = Math.round(step.completeness * 100);
          const col = p >= 80 ? chalk.green : p >= 40 ? chalk.yellow : chalk.red;
          console.log(`  completeness: ${col.bold(p + '%')}`);
        }

        // Slot snapshot
        if (step.slotSnapshot?.length) {
          console.log(chalk.dim('  slot state:'));
          for (const ss of step.slotSnapshot) {
            const tgt = ss.target != null ? `/${ss.target}` : '';
            const col = ss.target && ss.filled >= ss.target ? chalk.green : ss.filled > 0 ? chalk.yellow : chalk.red;
            console.log(`    ${ss.name} (${ss.type}): ${col(ss.filled + tgt)}`);
          }
        }

        // Query guidance (debug — full text)
        if (step.queryGuidance) {
          console.log(chalk.dim('\n  ── Query guidance ──'));
          for (const line of step.queryGuidance.split('\n')) {
            console.log(chalk.dim('  ' + line));
          }
        }

        // Dropped claims
        if (step.droppedClaims?.length) {
          console.log(chalk.red(`  ⚠ dropped claims (${step.droppedClaims.length}):`));
          for (const d of step.droppedClaims) {
            const valStr = d.value != null ? ` value="${JSON.stringify(d.value)?.slice(0, 60)}"` : '';
            const keyStr = d.key ? ` key="${d.key}"` : '';
            console.log(`    ${chalk.red(d.slot)}${keyStr}${valStr} → ${chalk.dim(d.reason)}`);
          }
        }

        // Dropped subqueries
        if (step.droppedSubqueries?.length) {
          console.log(chalk.yellow(`  ⚠ dropped subqueries (${step.droppedSubqueries.length}):`));
          for (const d of step.droppedSubqueries.slice(0, 10)) {
            console.log(`    ${chalk.dim(d.slot)}: "${d.query}" → ${d.reason}`);
          }
        }

        // List slot state debug
        if (step.listSlotState && Object.keys(step.listSlotState).length) {
          console.log(chalk.dim('  list slot debug:'));
          for (const [name, info] of Object.entries(step.listSlotState)) {
            console.log(`    ${name}: ${JSON.stringify(info)}`);
          }
        }

        // Extract debug
        if (step.extractDebug) {
          console.log(chalk.dim('  extract debug:'), JSON.stringify(step.extractDebug)?.slice(0, 200));
        }
      }

      // Hard stop
      if (tp.hardStopReason) {
        console.log(chalk.yellow.bold(`\n⊘ HARD STOP: ${tp.hardStopReason}`));
      }
      if (tp.partialAnswerNote) {
        console.log(chalk.yellow(`  partial: ${tp.partialAnswerNote}`));
      }
      if (tp.slotFillSummary) {
        console.log(chalk.dim('\n  final slot fill:'));
        for (const s of tp.slotFillSummary) {
          const tgt = s.target != null ? `/${s.target}` : '';
          const col = s.target && s.filled >= (s.target) ? chalk.green : s.filled > 0 ? chalk.yellow : chalk.red;
          console.log(`    ${s.name} (${s.type}): ${col(s.filled + tgt)}`);
        }
      }
    }

    // ── Step progress (lightweight emit) ──────────────────────────────
    if (event.step != null && !event.thoughtProcess && !event.done) {
      // already handled via thoughtProcess above, skip
    }

    // ── Done ──────────────────────────────────────────────────────────
    if (event.done) {
      const done = event as {
        done: boolean;
        message?: { id: string; content: string; role: string };
        suggestedPage?: { url: string; title: string; snippet?: string };
        thoughtProcess?: { completeness?: number; iterationCount?: number; hardStopReason?: string };
        quotes?: Array<{ chunkId: string; sourceId: string; text?: string; url?: string }>;
      };

      if (done.suggestedPage) {
        console.log(chalk.yellow.bold(`\n↗ SUGGESTED PAGE: ${done.suggestedPage.url}`));
        if (done.suggestedPage.snippet) console.log(`  ${done.suggestedPage.snippet.slice(0, 150)}`);
      }

      const iterCount = done.thoughtProcess?.iterationCount ?? lastStepIter;
      const comp = done.thoughtProcess?.completeness;
      const compStr = comp != null ? ` — ${Math.round(comp * 100)}% complete` : '';
      console.log(chalk.green.bold(`\n✓ DONE after ${iterCount} iteration(s)${compStr}`));

      if (done.quotes?.length) {
        console.log(chalk.dim(`  ${done.quotes.length} quote(s) saved`));
      }

      console.log('\n' + hr());
      console.log(chalk.bold.white('FINAL ANSWER:'));
      console.log(hr());
      if (done.message?.content) {
        console.log(done.message.content);
      } else {
        console.log(chalk.red('(no message in done event)'));
      }
    }
  };

  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }
  if (buffer.trim()) processLine(buffer);

  console.log('\n' + hr('─', 80));
  console.log(chalk.dim(`Total NDJSON lines processed: ${lineN}`));
}

main().catch(e => { console.error(chalk.red('Fatal:'), e); process.exit(1); });
