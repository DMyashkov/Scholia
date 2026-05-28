import chalk from 'chalk';

// ─── helpers ────────────────────────────────────────────────────────────────

export function hr(char = '─', width = 72): string {
  return chalk.dim(char.repeat(width));
}

export function dimLabel(s: string): string {
  return chalk.dim(s);
}

export function badge(label: string, color: typeof chalk = chalk.cyan): string {
  return color.bold(`[${label}]`);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ─── message display ─────────────────────────────────────────────────────────

export function printUserMessage(content: string): void {
  console.log('');
  console.log(chalk.bold.blue('You') + chalk.dim(' ──────────────────────────────'));
  console.log(content.trim());
}

export function printAssistantMessage(content: string): void {
  console.log('');
  console.log(chalk.bold.green('Assistant') + chalk.dim(' ─────────────────────────'));
  console.log(content.trim());
  console.log('');
}

export function printSystemLine(msg: string): void {
  console.log(chalk.dim(`  ${msg}`));
}

// ─── thought process / RAG stream display ────────────────────────────────────

export function printPlanSlots(slots: Array<{ name: string; type: string; description?: string; dependsOn?: string; target_item_count?: number }>): void {
  console.log('');
  console.log(chalk.bold.yellow('◈ Plan'));
  for (const s of slots) {
    const dep = s.dependsOn ? chalk.dim(` ← ${s.dependsOn}`) : '';
    const target = s.target_item_count ? chalk.dim(` (target: ${s.target_item_count})`) : '';
    const typeColor = s.type === 'mapping' ? chalk.magenta : s.type === 'list' ? chalk.cyan : chalk.white;
    console.log(`  ${typeColor(`[${s.type}]`)} ${chalk.bold(s.name)}${dep}${target}`);
    if (s.description) {
      console.log(`    ${chalk.dim(s.description)}`);
    }
  }
}

export function printIterationHeader(iter: number, action: string): void {
  const actionLabel = action === 'answer' ? chalk.green('→ answering') :
    action === 'expand_corpus' ? chalk.yellow('→ expand corpus') :
    action === 'retrieve' ? chalk.blue('→ retrieving') :
    chalk.dim(action);
  console.log('');
  console.log(`${chalk.bold.white(`◈ Iter ${iter}`)}  ${actionLabel}`);
}

export interface SubqueryInfo {
  slot: string;
  query: string;
  strategy?: string;
}

export function printSubqueries(subs: SubqueryInfo[]): void {
  if (!subs.length) return;
  console.log(chalk.dim('  Subqueries:'));
  for (const s of subs) {
    const stratLabel = s.strategy === 'broad' ? chalk.yellow('[broad]    ') :
      s.strategy === 'targeted' ? chalk.cyan('[targeted] ') :
      chalk.dim('[?]        ');
    console.log(`    ${stratLabel} ${chalk.dim(s.slot + ':')} ${chalk.white(s.query)}`);
  }
}

export interface ClaimInfo {
  slot: string;
  key?: string;
  value: unknown;
  confidence?: number;
}

export function printClaims(claims: ClaimInfo[], label = 'Claims'): void {
  if (!claims.length) return;
  const bySlot = new Map<string, ClaimInfo[]>();
  for (const c of claims) {
    const list = bySlot.get(c.slot) ?? [];
    list.push(c);
    bySlot.set(c.slot, list);
  }
  const total = claims.length;
  const parts = [...bySlot.entries()].map(([slot, cs]) => `${chalk.bold(slot)}: ${cs.length}`);
  console.log(`  ${chalk.dim(label + ':')} ${total} (${parts.join(', ')})`);

  for (const [slot, cs] of bySlot) {
    for (const c of cs) {
      const val = typeof c.value === 'string' ? c.value.slice(0, 80) :
        c.value != null ? String(c.value).slice(0, 80) : '';
      const keyStr = c.key ? chalk.dim(`[${c.key}] `) : '';
      const confStr = c.confidence != null ? chalk.dim(` (${Math.round(c.confidence * 100)}%)`) : '';
      console.log(`    ${chalk.dim('·')} ${chalk.dim(slot)} ${keyStr}${chalk.white(val)}${confStr}`);
    }
  }
}

export interface SlotFillEntry {
  name: string;
  type: string;
  filled: number;
  target: number | null;
}

export function printSlotFillSummary(summary: SlotFillEntry[]): void {
  if (!summary.length) return;
  const parts = summary.map((s) => {
    const prog = s.target ? `${s.filled}/${s.target}` : `${s.filled}`;
    const color = s.target && s.filled >= s.target ? chalk.green :
      s.filled > 0 ? chalk.yellow :
      chalk.red;
    return `${chalk.dim(s.name)}: ${color(prog)}`;
  });
  console.log(`  ${chalk.dim('Slots:')} ${parts.join('  ')}`);
}

export function printCompleteness(completeness: number): void {
  const p = Math.round(completeness * 100);
  const color = p >= 80 ? chalk.green : p >= 40 ? chalk.yellow : chalk.red;
  console.log(`  ${chalk.dim('Completeness:')} ${color.bold(pct(completeness))}`);
}

export function printQueryGuidance(guidance: string): void {
  console.log('');
  console.log(chalk.dim('  ── Query guidance ──'));
  for (const line of guidance.split('\n').slice(0, 40)) {
    console.log(chalk.dim('  ' + line));
  }
}

export function printDroppedClaims(dropped: Array<{ slot: string; reason: string }>): void {
  if (!dropped.length) return;
  console.log(`  ${chalk.red(`⚠ Dropped ${dropped.length} claim(s):`)}`);
  for (const d of dropped.slice(0, 5)) {
    console.log(`    ${chalk.dim(d.slot + ':')} ${chalk.red(d.reason)}`);
  }
}

export function printStepWhy(why: string | undefined): void {
  if (!why) return;
  console.log(`  ${chalk.dim('Why:')} ${chalk.italic(why)}`);
}

export function printError(msg: string): void {
  console.log('');
  console.log(chalk.red.bold('✗ Error: ') + chalk.red(msg));
}

export function printSuccess(msg: string): void {
  console.log(chalk.green('✓ ') + msg);
}

export function printWarning(msg: string): void {
  console.log(chalk.yellow('⚠ ') + msg);
}

export function printSuggestedPage(page: { url: string; title: string; snippet?: string }): void {
  console.log('');
  console.log(chalk.yellow.bold('↗ Suggested page to add:'));
  console.log(`  ${chalk.cyan(page.title)} — ${chalk.underline(page.url)}`);
  if (page.snippet) console.log(`  ${chalk.dim(page.snippet.slice(0, 120))}`);
}

export function printHardStop(reason: string): void {
  console.log('');
  console.log(chalk.yellow(`⊘ Hard stop: ${reason}`));
}

export function printDoneStats(iter: number, completeness: number | undefined): void {
  const compStr = completeness != null ? `  ${pct(completeness)} completeness` : '';
  console.log('');
  console.log(hr());
  console.log(chalk.green.bold('✓ Done') + chalk.dim(` after ${iter} iteration(s)${compStr}`));
}

export function printConversationHeader(title: string | null, id: string): void {
  console.log('');
  console.log(hr('═'));
  console.log(chalk.bold.white(title ?? chalk.dim('Untitled')));
  console.log(chalk.dim(`id: ${id}`));
  console.log(hr('═'));
}

export function printSourcesList(sources: Array<{ url: string; status?: string }>): void {
  if (!sources.length) {
    console.log(chalk.dim('  (no sources)'));
    return;
  }
  for (const s of sources) {
    const st = s.status ?? 'unknown';
    const statusColor = st === 'ready' || st === 'completed' ? chalk.green :
      st === 'crawling' || st === 'running' || st === 'indexing' ? chalk.yellow :
      chalk.red;
    console.log(`  ${statusColor('●')} ${s.url} ${chalk.dim(`[${st}]`)}`);
  }
}

export function printHelp(): void {
  console.log('');
  console.log(chalk.bold('Commands:'));
  console.log(`  ${chalk.cyan('/help')}                   show this help`);
  console.log(`  ${chalk.cyan('/conversations')}          list recent conversations`);
  console.log(`  ${chalk.cyan('/switch <name or id>')}    switch to a different conversation`);
  console.log(`  ${chalk.cyan('/new <title>')}            create a new conversation`);
  console.log(`  ${chalk.cyan('/sources')}                list sources for current conversation`);
  console.log(`  ${chalk.cyan('/messages')}               show recent messages`);
  console.log(`  ${chalk.cyan('/delete')}                 delete the last exchange (user + assistant)`);
  console.log(`  ${chalk.cyan('/edit <new text>')}        replace last user message and resend`);
  console.log(`  ${chalk.cyan('/debug on|off')}           toggle verbose debug output`);
  console.log(`  ${chalk.cyan('/logout')}                 clear saved session`);
  console.log(`  ${chalk.cyan('/quit')} or Ctrl-C         exit`);
  console.log('');
}
