#!/usr/bin/env node
/**
 * Tiny localhost server backing docs/verify.html. Two endpoints:
 *
 *   POST /api/state   { id: "9B.2", state: "approved" }
 *      → rewrites the matching `- [ ]` line in docs/figma-divergences.md
 *        to `- [x]` (approved), `- [-]` (wont_fix), `- [r]` (retry),
 *        `- [?]` (tbd), or `- [ ]` (open) and saves the file.
 *
 *   POST /api/agent-summary { id: "9D.4", summary: "..." }
 *      → adds/updates a `<!-- agent-summary: ... -->` HTML comment on the
 *        bullet line. Empty summary removes the comment. Used by fix-agents
 *        when a bullet body lacks code references and they infer intent
 *        from images.
 *
 *   GET  /api/counts
 *      → returns { open, approved, wont_fix, retry, tbd, partial } from current md.
 *
 * Static: serves docs/verify.html at /, plus uimatch-results/* images.
 *
 *   PORT=4567 node scripts/verify-server.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const REPO = process.cwd();
const DIV_DOC = join(REPO, 'docs/figma-divergences.md');
const PORT = Number(process.env.PORT ?? 4567);

const STATE_TO_CHAR = { open: ' ', approved: 'x', wont_fix: '-', retry: 'r', tbd: '?', partial: '~' };
const CHAR_TO_STATE = { ' ': 'open', x: 'approved', '-': 'wont_fix', r: 'retry', '?': 'tbd', '~': 'partial' };

function readBullets() {
  const md = readFileSync(DIV_DOC, 'utf8');
  const sec9 = md.split(/^## 9\./m)[1] || '';
  const counts = { open: 0, approved: 0, wont_fix: 0, retry: 0, tbd: 0, partial: 0 };
  for (const m of sec9.matchAll(/^- \[([ x\-~?r])\] \*\*(9[A-D]\.\d+)\*\*/gm)) {
    const state = CHAR_TO_STATE[m[1]] ?? 'open';
    counts[state]++;
  }
  return counts;
}

function updateBulletState(id, newState) {
  if (!STATE_TO_CHAR[newState]) throw new Error(`unknown state: ${newState}`);
  const newChar = STATE_TO_CHAR[newState];
  const md = readFileSync(DIV_DOC, 'utf8');
  // Find the line with this id and rewrite the state char.
  const re = new RegExp(`^- \\[[ x\\-~?r]\\] \\*\\*${id.replace('.', '\\.')}\\*\\*`, 'm');
  if (!re.test(md)) throw new Error(`bullet ${id} not found in ${DIV_DOC}`);
  const updated = md.replace(re, `- [${newChar}] **${id}**`);
  if (updated === md) throw new Error(`replace produced no change for ${id}`);
  writeFileSync(DIV_DOC, updated);
}

// Notes are persisted as a trailing HTML comment on the bullet line:
//   - [?] **9D.4** body text  <!-- note: free-text from the textarea -->
// Empty notes remove the comment entirely.
function updateBulletNote(id, note) {
  const md = readFileSync(DIV_DOC, 'utf8');
  const safeId = id.replace('.', '\\.');
  // Capture the whole bullet line for this id.
  const lineRe = new RegExp(`^(- \\[[ x\\-~?r]\\] \\*\\*${safeId}\\*\\* )(.+)$`, 'm');
  const m = md.match(lineRe);
  if (!m) throw new Error(`bullet ${id} not found in ${DIV_DOC}`);
  const prefix = m[1];
  let body = m[2];
  // Strip any existing note comment (regardless of position on the line —
  // notes may sit before agent-summary or dispatched markers).
  body = body.replace(/\s*<!--\s*note:[\s\S]*?-->\s*/g, '').trimEnd();
  const trimmedNote = (note ?? '').trim();
  // Sanitize note: collapse newlines into a single space (keeps the
  // bullet on one line so the markdown structure isn't disturbed) and
  // forbid the closing `-->` sequence.
  const safeNote = trimmedNote.replace(/-->/g, '--&gt;').replace(/\s+/g, ' ');
  const newLine = safeNote ? `${prefix}${body}  <!-- note: ${safeNote} -->` : `${prefix}${body}`;
  const updated = md.replace(lineRe, newLine);
  if (updated === md) throw new Error(`replace produced no change for ${id}`);
  writeFileSync(DIV_DOC, updated);
}

// Agent summaries are persisted as a trailing HTML comment, parallel to
// note/dispatched. Empty summaries remove the comment.
function updateBulletAgentSummary(id, summary) {
  const md = readFileSync(DIV_DOC, 'utf8');
  const safeId = id.replace('.', '\\.');
  const lineRe = new RegExp(`^(- \\[[ x\\-~?r]\\] \\*\\*${safeId}\\*\\* )(.+)$`, 'm');
  const m = md.match(lineRe);
  if (!m) throw new Error(`bullet ${id} not found in ${DIV_DOC}`);
  const prefix = m[1];
  let body = m[2];
  // Strip any existing trailing agent-summary comment (anywhere in the line tail).
  body = body.replace(/\s*<!--\s*agent-summary:[\s\S]*?-->\s*/g, '').trimEnd();
  const trimmedSummary = (summary ?? '').trim();
  // Sanitize: collapse newlines into spaces and forbid the closing `-->` sequence.
  const safeSummary = trimmedSummary.replace(/-->/g, '--&gt;').replace(/\s+/g, ' ');
  const newLine = safeSummary ? `${prefix}${body}  <!-- agent-summary: ${safeSummary} -->` : `${prefix}${body}`;
  const updated = md.replace(lineRe, newLine);
  if (updated === md && trimmedSummary) throw new Error(`replace produced no change for ${id}`);
  writeFileSync(DIV_DOC, updated);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serveFile(res, path) {
  if (!existsSync(path)) {
    res.writeHead(404).end(`not found: ${path}`);
    return;
  }
  const buf = readFileSync(path);
  const mime = MIME[extname(path)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/state') {
      let body = '';
      req.on('data', (c) => (body += c));
      await new Promise((r) => req.on('end', r));
      const { id, state } = JSON.parse(body);
      updateBulletState(id, state);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, state }));
      console.log(`[state] ${id} → ${state}`);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/note') {
      let body = '';
      req.on('data', (c) => (body += c));
      await new Promise((r) => req.on('end', r));
      const { id, note } = JSON.parse(body);
      updateBulletNote(id, note);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, length: (note ?? '').length }));
      console.log(`[note] ${id} (${(note ?? '').length} chars)`);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/agent-summary') {
      let body = '';
      req.on('data', (c) => (body += c));
      await new Promise((r) => req.on('end', r));
      const { id, summary } = JSON.parse(body);
      updateBulletAgentSummary(id, summary);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, length: (summary ?? '').length }));
      console.log(`[agent-summary] ${id} (${(summary ?? '').length} chars)`);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/counts') {
      const counts = readBullets();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(counts));
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveFile(res, join(REPO, 'docs/verify.html'));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/uimatch-results/')) {
      // ../uimatch-results/<frame>/<file>
      serveFile(res, join(REPO, url.pathname));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/uimatch-results-fixed/')) {
      // ../uimatch-results-fixed/<frame>/<file>
      serveFile(res, join(REPO, url.pathname));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/docs/')) {
      serveFile(res, join(REPO, url.pathname));
      return;
    }

    res.writeHead(404).end('not found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message ?? String(err) }));
    console.error('[error]', err);
  }
});

server.listen(PORT, () => {
  console.log(`verify server: http://localhost:${PORT}/`);
  console.log(`watching: ${DIV_DOC}`);
});
