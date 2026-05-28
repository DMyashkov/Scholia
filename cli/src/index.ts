#!/usr/bin/env node
import * as readline from 'readline';
import chalk from 'chalk';
import { getOrCreateSession, clearSavedSession } from './auth.js';
import {
  listConversations,
  listMessages,
  listSources,
  insertUserMessage,
  deleteMessagesFrom,
  getConversationByName,
  getConversation,
  createConversation,
  type Conversation,
  type Message,
} from './db.js';
import { callRagStream } from './rag.js';
import {
  printUserMessage,
  printAssistantMessage,
  printConversationHeader,
  printSourcesList,
  printHelp,
  printError,
  printSuccess,
  printWarning,
  printSystemLine,
  hr,
} from './display.js';
import type { SupabaseClient, Session } from '@supabase/supabase-js';

// ─── State ───────────────────────────────────────────────────────────────────

let client!: SupabaseClient;
let session!: Session;
let activeConversation: Conversation | null = null;
let debugMode = false;

// ─── Conversation helpers ────────────────────────────────────────────────────

async function printCurrentConversation(): Promise<void> {
  if (!activeConversation) {
    console.log(chalk.dim('  (no active conversation)'));
    return;
  }
  printConversationHeader(activeConversation.title, activeConversation.id);

  const sources = await listSources(client, activeConversation.id);
  console.log(chalk.bold('Sources:'));
  printSourcesList(sources.map(s => ({ url: s.initial_url })));
}

async function showRecentMessages(n = 8): Promise<Message[]> {
  if (!activeConversation) return [];
  const all = await listMessages(client, activeConversation.id, 50);
  const recent = all.slice(-n);
  console.log('');
  console.log(chalk.dim(`  Last ${recent.length} message(s):`));
  for (const m of recent) {
    if (m.role === 'user') {
      printUserMessage(m.content);
    } else {
      printAssistantMessage(m.content);
    }
  }
  return all;
}

// ─── Command handlers ────────────────────────────────────────────────────────

async function handleConversations(): Promise<void> {
  const convs = await listConversations(client, 15);
  console.log('');
  console.log(chalk.bold('Recent conversations:'));
  convs.forEach((c, i) => {
    const active = activeConversation?.id === c.id ? chalk.green(' ← current') : '';
    const ts = new Date(c.updated_at).toLocaleString();
    console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.white(c.title ?? chalk.italic('Untitled'))}${active}`);
    console.log(`     ${chalk.dim(ts)}  ${chalk.dim(c.id)}`);
  });
}

async function handleSwitch(nameOrId: string): Promise<void> {
  if (!nameOrId) { printWarning('Usage: /switch <name or id>'); return; }
  let conv = await getConversation(client, nameOrId);
  if (!conv) conv = await getConversationByName(client, nameOrId);
  if (!conv) { printError(`No conversation found matching "${nameOrId}"`); return; }
  activeConversation = conv;
  await printCurrentConversation();
  await showRecentMessages(4);
}

async function handleNew(title: string): Promise<void> {
  const t = title.trim() || 'New conversation';
  activeConversation = await createConversation(client, t);
  printSuccess(`Created conversation: "${activeConversation.title}"`);
  console.log(chalk.dim(`  id: ${activeConversation.id}`));
}

async function handleDelete(): Promise<void> {
  if (!activeConversation) { printWarning('No active conversation.'); return; }
  const messages = await listMessages(client, activeConversation.id);
  // Find the last user message
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) { printWarning('No user messages to delete.'); return; }
  await deleteMessagesFrom(client, activeConversation.id, lastUser.id);
  printSuccess('Deleted last exchange.');
}

async function handleEdit(newText: string): Promise<void> {
  if (!activeConversation) { printWarning('No active conversation.'); return; }
  if (!newText.trim()) { printWarning('Usage: /edit <new message text>'); return; }
  const messages = await listMessages(client, activeConversation.id);
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) { printWarning('No user messages to edit.'); return; }
  await deleteMessagesFrom(client, activeConversation.id, lastUser.id);
  printSuccess('Deleted old exchange, resending…');
  await handleSend(newText);
}

async function handleSend(content: string): Promise<void> {
  if (!activeConversation) {
    printWarning('No active conversation. Use /new <title> or /switch <name>.');
    return;
  }

  const sources = await listSources(client, activeConversation.id);
  if (sources.length === 0) {
    printWarning('This conversation has no sources. Add a source via the web UI first.');
    return;
  }

  printUserMessage(content);

  // Insert user message
  let userMsg;
  try {
    userMsg = await insertUserMessage(client, activeConversation.id, content);
  } catch (e) {
    printError(`Failed to save message: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // Call the RAG edge function
  const finalAnswer = await callRagStream({
    conversationId: activeConversation.id,
    userMessageId: userMsg.id,
    userMessage: content,
    accessToken: session.access_token,
    debug: debugMode,
  });

  if (finalAnswer) {
    printAssistantMessage(finalAnswer);
  }
}

// ─── REPL ────────────────────────────────────────────────────────────────────

async function runRepl(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: chalk.cyan('› '),
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }

    try {
      if (input === '/quit' || input === '/exit' || input === '/q') {
        console.log(chalk.dim('Bye.'));
        process.exit(0);
      } else if (input === '/help') {
        printHelp();
      } else if (input === '/conversations' || input === '/convs') {
        await handleConversations();
      } else if (input.startsWith('/switch ')) {
        await handleSwitch(input.slice(8).trim());
      } else if (input.startsWith('/new ')) {
        await handleNew(input.slice(5).trim());
      } else if (input === '/sources') {
        if (!activeConversation) { printWarning('No active conversation.'); }
        else {
          const sources = await listSources(client, activeConversation.id);
          printSourcesList(sources.map(s => ({ url: s.initial_url })));
        }
      } else if (input === '/messages' || input === '/msgs') {
        await showRecentMessages(8);
      } else if (input === '/delete' || input === '/del') {
        await handleDelete();
      } else if (input.startsWith('/edit ')) {
        await handleEdit(input.slice(6).trim());
      } else if (input.startsWith('/debug')) {
        const arg = input.split(' ')[1];
        debugMode = arg === 'off' ? false : arg === 'on' ? true : !debugMode;
        console.log(chalk.dim(`Debug mode: ${debugMode ? 'on' : 'off'}`));
      } else if (input === '/logout') {
        clearSavedSession();
        printSuccess('Session cleared. Restart to log in again.');
        process.exit(0);
      } else if (input.startsWith('/')) {
        printWarning(`Unknown command: ${input}. Type /help for available commands.`);
      } else {
        // Regular message
        await handleSend(input);
      }
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
    }

    rl.prompt();
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function promptCredentials(): Promise<{ email: string; password: string }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, resolve));

  console.log(chalk.bold('\nScholia CLI — log in to continue'));
  const email = await question(chalk.dim('Email: '));
  // Hide password input
  process.stdout.write(chalk.dim('Password: '));
  const password = await new Promise<string>((resolve) => {
    const chars: string[] = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (key: string) => {
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (key === '') {
        process.exit();
      } else if (key === '') {
        chars.pop();
      } else {
        chars.push(key);
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });

  rl.close();
  return { email, password };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  console.log(chalk.bold.white('Scholia CLI'));
  console.log(chalk.dim('Type /help for commands, /quit to exit'));
  console.log('');

  // Auth
  try {
    ({ session, client } = await getOrCreateSession(promptCredentials));
    const { data: { user } } = await client.auth.getUser();
    printSuccess(`Logged in as ${chalk.bold(user?.email ?? 'unknown')}`);
  } catch (e) {
    printError(`Auth failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Pick initial conversation
  const nameArg = args.find(a => !a.startsWith('-'));
  const convs = await listConversations(client, 20);

  if (nameArg) {
    // Try by id or name from arg
    let conv = await getConversation(client, nameArg);
    if (!conv) conv = await getConversationByName(client, nameArg);
    if (conv) {
      activeConversation = conv;
    } else {
      printWarning(`No conversation matching "${nameArg}", loading most recent.`);
    }
  }

  if (!activeConversation && convs.length > 0) {
    activeConversation = convs[0]!;
  }

  if (activeConversation) {
    await printCurrentConversation();
    await showRecentMessages(4);
  } else {
    console.log(chalk.dim('No conversations yet. Use /new <title> to create one.'));
  }

  console.log('');
  console.log(hr());
  console.log(chalk.dim('Send a message or type a command. /help for list.'));

  await runRepl();
}

main().catch(e => {
  console.error(chalk.red('Fatal error:'), e);
  process.exit(1);
});
