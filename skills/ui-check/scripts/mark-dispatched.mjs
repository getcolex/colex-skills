#!/usr/bin/env node
/**
 * Append/update `<!-- dispatched: <sha> -->` on a bullet line in
 * docs/figma-divergences.md. Run after a fix-agent commits.
 *
 * Usage:
 *   node mark-dispatched.mjs <doc-path> <bullet-id> <commit-sha>
 *
 * Replaces any existing dispatched comment for that bullet and preserves
 * the existing note comment (if any).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , docPathArg, bulletId, sha] = process.argv;
if (!docPathArg || !bulletId || !sha) {
  console.error('Usage: mark-dispatched.mjs <doc> <bullet-id> <commit-sha>');
  process.exit(2);
}

const docPath = resolve(docPathArg);
const md = readFileSync(docPath, 'utf8');

// Bullet line shape, robust against multiple HTML comments at end-of-line.
const safeId = bulletId.replace('.', '\\.');
const lineRe = new RegExp(`^(- \\[[ x\\-~?r]\\] \\*\\*${safeId}\\*\\* )(.+)$`, 'm');
const m = md.match(lineRe);
if (!m) {
  console.error(`Bullet ${bulletId} not found in ${docPath}`);
  process.exit(1);
}

const prefix = m[1];
let body = m[2];
// Strip any prior dispatched marker; keep note comment intact.
body = body.replace(/\s*<!--\s*dispatched:[\s\S]*?-->\s*/g, ' ').trim();
const newLine = `${prefix}${body}  <!-- dispatched: ${sha} -->`;
const updated = md.replace(lineRe, newLine);
if (updated === md) {
  console.error(`No change for ${bulletId} (already at ${sha}?)`);
  process.exit(0);
}
writeFileSync(docPath, updated);
console.log(`Marked ${bulletId} dispatched at ${sha.slice(0, 7)}`);
