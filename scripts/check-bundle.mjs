/**
 * What ships, and what must not.
 *
 * Two jobs, both about the artifact rather than the source:
 *
 *  1. Nothing unexpected is in dist/. A stray source map, a leftover fixture or
 *     a `.env` in an unpacked extension is readable by anyone who installs it,
 *     and "we meant to delete that" is not a defence.
 *  2. Size budgets. React is the only dependency, and the point of the budget
 *     is that adding a second one has to be a decision rather than an
 *     accident -- a 2MB audit tool is a slower panel and a bigger review.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';

/** Files the extension is allowed to ship, as exact names or patterns. */
const ALLOWED = [
  /^manifest\.json$/,
  /^(popup|sidepanel|options)\.html$/,
  /^content\.js$/,
  /^service-worker\.js$/,
  /^icons\/icon(16|32|48|128)\.png$/,
  /^assets\/[A-Za-z0-9_.-]+\.(js|css)$/,
];

/** Never shippable, whatever else is true. */
const FORBIDDEN = [
  { pattern: /\.map$/, why: 'a source map exposes the whole source tree' },
  { pattern: /\.(ts|tsx)$/, why: 'TypeScript source has no business in a build' },
  { pattern: /^\./, why: 'dotfiles are almost always a mistake here' },
  { pattern: /\.(zip|tgz|log)$/, why: 'build leftovers' },
];

/** Per-file budgets, in kilobytes. */
const BUDGETS = [
  { pattern: /^content\.js$/, kb: 60, note: 'injected into every audited page' },
  { pattern: /^service-worker\.js$/, kb: 20, note: 'a router, nothing more' },
  { pattern: /^assets\/vendor\.js$/, kb: 240, note: 'React and React DOM' },
  { pattern: /^assets\/sidepanel\.js$/, kb: 200, note: 'the panel, the rules, both report writers and the PDF font metrics' },
];

const TOTAL_BUDGET_KB = 700;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

let files;
try {
  files = walk(DIST).map((path) => ({
    name: relative(DIST, path).split('\\').join('/'),
    bytes: statSync(path).size,
    path,
  }));
} catch {
  console.error(`\n${DIST}/ is missing. Run "npm run build" first.\n`);
  process.exit(1);
}

const problems = [];

for (const file of files) {
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(file.name)) problems.push(`${file.name} must not ship: ${rule.why}`);
  }
  if (!ALLOWED.some((pattern) => pattern.test(file.name))) {
    problems.push(`${file.name} is not in the allowed file list (scripts/check-bundle.mjs)`);
  }
  for (const budget of BUDGETS) {
    if (!budget.pattern.test(file.name)) continue;
    const kb = file.bytes / 1024;
    if (kb > budget.kb) {
      problems.push(
        `${file.name} is ${kb.toFixed(0)}KB, over its ${budget.kb}KB budget (${budget.note})`,
      );
    }
  }
}

// Every declared budget must match something, or it is quietly checking nothing.
for (const budget of BUDGETS) {
  if (!files.some((file) => budget.pattern.test(file.name))) {
    problems.push(`no file matches the budget for ${budget.pattern.source} -- was it renamed?`);
  }
}

const totalKb = files.reduce((sum, file) => sum + file.bytes, 0) / 1024;
if (totalKb > TOTAL_BUDGET_KB) {
  problems.push(`the whole build is ${totalKb.toFixed(0)}KB, over its ${TOTAL_BUDGET_KB}KB budget`);
}

/**
 * The zero-network claim, checked against the shipped bytes.
 *
 * `npm run guard` proves *our* source names no network API. This proves the
 * artifact does not either -- dependencies included, after bundling and
 * minification. Minification renames a great deal; it does not rename these,
 * because they are platform identifiers. None of them appears in the current
 * build, React and React DOM included, so the list can stay strict.
 */
const NETWORK_TOKENS = [
  'fetch(',
  'XMLHttpRequest',
  'sendBeacon',
  'WebSocket(',
  'EventSource(',
  'importScripts(',
  'connectNative',
];
for (const file of files.filter((item) => item.name.endsWith('.js'))) {
  const text = readFileSync(file.path, 'utf8');
  for (const token of NETWORK_TOKENS) {
    if (text.includes(token)) problems.push(`${file.name} contains ${token} in the shipped bundle`);
  }
}

if (problems.length > 0) {
  console.error(`\nBundle check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(
  `bundle: ${files.length} files, ${totalKb.toFixed(0)}KB total (budget ${TOTAL_BUDGET_KB}KB), nothing unexpected`,
);
