import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import strip from 'strip-comments';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const exts = ['.ts', '.tsx', '.js', '.jsx', '.css'];
const skipDirs = new Set(['node_modules', 'dist', '.git', 'dist_esm']);
const skipPaths = [
  'vite-env.d.ts',
  'deno_types.d.ts',
];

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) walk(full, list);
    } else if (exts.includes(path.extname(e.name)) && !skipPaths.some(p => rel.includes(p))) {
      list.push(full);
    }
  }
  return list;
}

const srcDir = path.join(root, 'src');
const supabaseDir = path.join(root, 'supabase', 'functions');
const workerDir = path.join(root, 'worker', 'src');
const configFiles = [path.join(root, 'vite.config.ts')].filter(f => fs.existsSync(f));

const allFiles = [
  ...walk(srcDir),
  ...walk(supabaseDir),
  ...walk(workerDir),
  ...configFiles,
];

let changed = 0;
for (const file of allFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file);
  let out;
  if (ext === '.css') {
    out = strip(raw, { preserveNewlines: true });
  } else {
    out = strip(raw, { preserveNewlines: true });
  }
  const trimmed = out.trimEnd();
  if (raw !== trimmed) {
    fs.writeFileSync(file, trimmed, 'utf8');
    changed++;
    console.log(path.relative(root, file));
  }
}
console.log(`Done. Updated ${changed} files.`);
