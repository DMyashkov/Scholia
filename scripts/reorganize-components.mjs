#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/myashkov/Documents/Projects/Scholia';

// Map: filename -> subdirectory
const MOVES = {
  'ChatArea.tsx':           'chat',
  'ChatInput.tsx':          'chat',
  'ChatMessage.tsx':        'chat',
  'CopyMessageButton.tsx':  'chat',
  'ThoughtProcessView.tsx': 'chat',
  'WelcomeScreen.tsx':      'chat',

  'CitedPages.tsx':         'citations',
  'KnowledgeTrail.tsx':     'citations',
  'QuoteCard.tsx':          'citations',

  'CrawlDebugPanel.tsx':    'crawl',
  'CrawlStats.tsx':         'crawl',
  'EncodingProgressBar.tsx':'crawl',
  'SidebarCrawlPanel.tsx':  'crawl',

  'GuestModeRequiredModal.tsx': 'layout',
  'NavLink.tsx':            'layout',
  'SettingsSheet.tsx':      'layout',
  'Sidebar.tsx':            'layout',
  'UserMenu.tsx':           'layout',

  'AddSourceModal.tsx':     'sources',
  'InheritSourceDialog.tsx':'sources',
  'RecrawlConfirmModal.tsx':'sources',
  'SourceDataLoader.tsx':   'sources',
  'SourceDrawer.tsx':       'sources',
  'SourcePreviewDrawer.tsx':'sources',
  'SourceWithData.tsx':     'sources',
  'SourcesBar.tsx':         'sources',

  'DatabaseTest.tsx':       'debug',
};

// Build reverse map: componentName -> subdir
const COMPONENT_TO_DIR = {};
for (const [file, dir] of Object.entries(MOVES)) {
  const name = file.replace('.tsx', '');
  COMPONENT_TO_DIR[name] = dir;
}

// Step 1: create directories and git mv files
console.log('Moving files...');
const dirs = [...new Set(Object.values(MOVES))];
for (const dir of dirs) {
  execSync(`mkdir -p src/components/${dir}`, { cwd: ROOT });
}
for (const [file, dir] of Object.entries(MOVES)) {
  const from = `src/components/${file}`;
  const to = `src/components/${dir}/${file}`;
  try {
    execSync(`git mv ${from} ${to}`, { cwd: ROOT, stdio: 'pipe' });
    console.log(`  ${from} -> ${to}`);
  } catch (e) {
    console.error(`  FAILED: ${from}`, e.stderr?.toString());
  }
}

// Step 2: update imports in all .ts/.tsx files under src/
console.log('\nUpdating imports...');

function getAllFiles(dir) {
  const result = [];
  const entries = execSync(`find ${dir} -name "*.tsx" -o -name "*.ts"`, { cwd: ROOT })
    .toString().trim().split('\n').filter(Boolean);
  return entries;
}

const files = getAllFiles('src');

for (const relPath of files) {
  const absPath = join(ROOT, relPath);
  let content;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch { continue; }

  const original = content;

  // Determine which subdir this file lives in (if any)
  const match = relPath.match(/^src\/components\/(\w+)\//);
  const fileSubdir = match ? match[1] : null;

  // Replace @/components/ComponentName imports
  content = content.replace(
    /from ['"]@\/components\/([A-Z][A-Za-z]+)['"]/g,
    (full, name) => {
      const targetDir = COMPONENT_TO_DIR[name];
      if (!targetDir) return full;
      return `from '@/components/${targetDir}/${name}'`;
    }
  );

  // Replace relative ./ComponentName imports
  content = content.replace(
    /from ['"]\.\/([A-Z][A-Za-z]+)['"]/g,
    (full, name) => {
      const targetDir = COMPONENT_TO_DIR[name];
      if (!targetDir) return full;
      if (!fileSubdir) {
        // File is directly in components/ (shouldn't happen after moves, but just in case)
        return `from './${targetDir}/${name}'`;
      }
      if (fileSubdir === targetDir) {
        return `from './${name}'`; // same dir, no change needed
      }
      return `from '../${targetDir}/${name}'`;
    }
  );

  if (content !== original) {
    writeFileSync(absPath, content);
    console.log(`  updated: ${relPath}`);
  }
}

console.log('\nDone. Run: npx tsc --noEmit to verify.');
