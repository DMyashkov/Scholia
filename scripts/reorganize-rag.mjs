#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/myashkov/Documents/Projects/Scholia';
const BASE = 'supabase/functions/chat-with-rag';

// Root files (stay in place, not moved)
const ROOT_FILES = new Set(['index.ts', 'config.ts', 'types.ts', 'utils.ts', 'deno.json', 'deno_types.d.ts']);

const MOVES = {
  'loop.ts':        'loop',
  'run.ts':         'loop',
  'plan.ts':        'loop',
  'actions.ts':     'loop',
  'expand.ts':      'loop',
  'completeness.ts':'loop',

  'retrieve.ts':    'retrieval',
  'embed.ts':       'retrieval',
  'quotes.ts':      'retrieval',
  'evidenceFormat.ts': 'retrieval',

  'finalAnswer.ts': 'answer',
  'finalize.ts':    'answer',
  'chat.ts':        'answer',

  'context.ts':     'context',
  'corpusContext.ts':'context',
  'slotFillState.ts':'context',
  'suggestion.ts':  'context',

  'prompts.ts':     'llm',
  'language.ts':    'llm',
};

// Map: filename (no ext) -> subdir
const NAME_TO_DIR = {};
for (const [file, dir] of Object.entries(MOVES)) {
  NAME_TO_DIR[file.replace('.ts', '')] = dir;
}

// Step 1: create dirs and move files
console.log('Moving files...');
const dirs = [...new Set(Object.values(MOVES))];
for (const dir of dirs) {
  execSync(`mkdir -p ${BASE}/${dir}`, { cwd: ROOT });
}
for (const [file, dir] of Object.entries(MOVES)) {
  const from = `${BASE}/${file}`;
  const to = `${BASE}/${dir}/${file}`;
  try {
    execSync(`git mv ${from} ${to}`, { cwd: ROOT, stdio: 'pipe' });
    console.log(`  ${from} -> ${to}`);
  } catch (e) {
    console.error(`  FAILED: ${from}`, e.stderr?.toString());
  }
}

// Also move .md files to docs if they exist
const mdFiles = ['README_ANALYSIS.md', 'RUN_TS_LINE_BY_LINE.md', 'STRUCTURAL_ISSUES_ANALYSIS.md', 'loop-DIPLOMA-EXPLANATION.md'];
for (const md of mdFiles) {
  try {
    execSync(`git mv ${BASE}/${md} docs/`, { cwd: ROOT, stdio: 'pipe' });
    console.log(`  moved ${md} to docs/`);
  } catch {}
}

// Step 2: update imports in all files under chat-with-rag
console.log('\nUpdating imports...');

function resolveImport(fromFile, importedName) {
  // fromFile: relative to BASE, e.g. 'loop/run.ts' or 'index.ts'
  // importedName: just the name without .ts, e.g. 'retrieve'
  const fromDir = fromFile.includes('/') ? fromFile.split('/')[0] : null; // subdir or null (root)
  const targetDir = NAME_TO_DIR[importedName]; // undefined = root file

  if (!targetDir) {
    // target is a root file (config, types, utils)
    if (!fromDir) return `./${importedName}.ts`; // root -> root
    return `../${importedName}.ts`; // subdir -> root
  }

  if (!fromDir) {
    // from root -> subdir
    return `./${targetDir}/${importedName}.ts`;
  }

  if (fromDir === targetDir) {
    // same dir
    return `./${importedName}.ts`;
  }

  // different subdirs
  return `../${targetDir}/${importedName}.ts`;
}

// Get all .ts files in chat-with-rag (after moves)
const files = execSync(`find ${BASE} -name "*.ts" -not -name "*.d.ts"`, { cwd: ROOT })
  .toString().trim().split('\n').filter(Boolean);

for (const absPath of files) {
  const relPath = absPath.replace(ROOT + '/', '');
  const fileRelToBase = relPath.replace(BASE + '/', ''); // e.g. 'loop/run.ts'
  let content;
  try {
    content = readFileSync(join(ROOT, relPath), 'utf8');
  } catch { continue; }

  const original = content;

  // Replace all relative imports: from './something.ts' or from '../something.ts'
  content = content.replace(
    /from ['"](\.[./]*\/?)([A-Za-z][A-Za-z0-9_]+)\.ts['"]/g,
    (full, prefix, name) => {
      if (!NAME_TO_DIR[name] && !ROOT_FILES.has(name + '.ts')) return full; // unknown, leave
      const newPath = resolveImport(fileRelToBase, name);
      return `from '${newPath}'`;
    }
  );

  if (content !== original) {
    writeFileSync(join(ROOT, relPath), content);
    console.log(`  updated: ${relPath}`);
  }
}

console.log('\nDone.');
