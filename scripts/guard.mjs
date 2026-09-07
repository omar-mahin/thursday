/**
 * Guards that make PLAN.md section 1 enforceable instead of aspirational.
 *
 *  1. No network API can appear anywhere in src/.  "We don't send much" is a
 *     promise; "the code cannot send anything" is a property.
 *  2. The content script may never read a form value (PLAN.md section 7).
 *     One file is allowed to, under a condition the guard checks: see
 *     OWNS_ITS_INPUTS below.
 *
 * Guard 3 (manifest shape) lives in tests/unit/manifest.test.ts.
 * Guard 4 (zero requests at runtime) lives in tests/e2e/network.spec.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /\bimportScripts\s*\(/,
  /\bnavigator\.serviceWorker\b/,
  /chrome\.runtime\.connectNative\b/,
  /\bWebTransport\b/,
];

const VALUE_READ = /\.value\b/;

/**
 * The one content-script file allowed to read `.value`, and why that is still
 * a proof rather than a hole.
 *
 * The rule exists so no code path can read what somebody typed into a page. The
 * comment composer is a form of Thursday's own -- a textarea and a name field
 * it creates itself, inside its own shadow root -- and there is no way to read
 * a textarea's current text except `.value`.
 *
 * So the exemption comes with a condition the guard enforces: this file may not
 * obtain a page element at all. No querySelector, no elementFromPoint, no
 * getElementsBy*. Every element it touches came from its own createElement, so
 * a `.value` read in it cannot be reading the page even by accident. That is a
 * stronger statement than "we looked and it seemed fine", and it fails loudly
 * the moment somebody adds a lookup.
 */
const OWNS_ITS_INPUTS = 'src/content/annotate/composer.ts';
const PAGE_LOOKUPS = [
  /\bquerySelector(All)?\s*\(/,
  /\bgetElementsBy\w+\s*\(/,
  /\belementFromPoint\s*\(/,
  /\belementsFromPoint\s*\(/,
  /\bdocument\.forms\b/,
  /\bclosest\s*\(/,
];

/**
 * Lines that begin as a comment are prose, not code. Only a leading marker
 * counts, so a trailing comment can never be used to hide a real call.
 */
const COMMENT_LINE = /^\s*(\/\/|\/?\*|\*\/)/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const violations = [];

/**
 * A backtick inside a CSS template literal.
 *
 * The stylesheets are written as tagged-free template literals, and their
 * comments are prose -- so referring to `background` the way prose does ends
 * the literal and turns the rest of the file into a syntax error. TypeScript
 * does report it, but only as "expected a semicolon" pointing at a sentence,
 * and a suppressed build then leaves a half-written dist behind that looks
 * like a broken environment rather than a typo. This says what it actually is.
 *
 * It has cost an afternoon twice. Ten lines is cheaper.
 */
const CSS_LITERAL = /export const (\w*CSS) = `([\s\S]*?)`;/g;

for (const file of walk('src')) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(CSS_LITERAL)) {
    if (!match[2].includes('`')) continue;
    const line = source.slice(0, match.index + match[2].indexOf('`')).split('\n').length;
    violations.push(
      `${file}:${line}  backtick inside the ${match[1]} template literal -- it ends the string; write the word plainly instead`,
    );
  }
}

for (const file of walk('src')) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const inContent = relative('src', file).startsWith('content');
  const ownsItsInputs = relative('.', file).split('\\').join('/') === OWNS_ITS_INPUTS;
  lines.forEach((line, index) => {
    const at = `${file}:${index + 1}`;
    // A line may opt out only with an explicit, reviewable marker.
    if (line.includes('guard-allow')) return;
    if (COMMENT_LINE.test(line)) return;
    for (const pattern of NETWORK_PATTERNS) {
      if (pattern.test(line)) violations.push(`${at}  network API: ${pattern.source}\n    ${line.trim()}`);
    }
    if (inContent && !ownsItsInputs && VALUE_READ.test(line)) {
      violations.push(`${at}  content script reads .value (see PLAN.md section 7)\n    ${line.trim()}`);
    }
    if (ownsItsInputs) {
      for (const pattern of PAGE_LOOKUPS) {
        if (pattern.test(line)) {
          violations.push(
            `${at}  ${OWNS_ITS_INPUTS} may not look up a page element -- its .value exemption ` +
              `depends on every element in it coming from its own createElement\n    ${line.trim()}`,
          );
        }
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`\nGuard failed with ${violations.length} violation(s):\n`);
  for (const violation of violations) console.error(`  ${violation}\n`);
  process.exit(1);
}

console.log(
  'guard: no network APIs in src/, no form-value reads in src/content/ (composer owns its own inputs and looks nothing up), no backticks inside CSS literals',
);
