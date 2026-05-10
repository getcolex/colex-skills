#!/usr/bin/env node
/**
 * find-free-port.mjs — given a starting port, walks upward until it finds one
 * that's not in use. Used by ui-check cold-start so a worktree's dev server
 * never silently lands on a port held by a different worktree (the
 * port-collision-blindness bug logged in LEARNINGS.md).
 *
 * Usage:
 *   node find-free-port.mjs <starting-port> [--max-tries <n>]
 *
 * Stdout: the chosen port number (or empty + non-zero exit if none found).
 *
 * Exit codes:
 *   0  found and printed a free port
 *   1  starting port could not be parsed
 *   2  exhausted --max-tries without finding a free port
 */
import { createServer } from 'node:net';

function usage() {
  console.error('Usage: find-free-port.mjs <starting-port> [--max-tries <n>]');
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();
const start = Number(argv[0]);
if (!Number.isFinite(start) || start <= 0 || start > 65535) usage();
const maxIdx = argv.indexOf('--max-tries');
const maxTries = maxIdx !== -1 && argv[maxIdx + 1] ? Number(argv[maxIdx + 1]) : 50;

// Bind to 0.0.0.0 so we detect ports already in use by servers bound to
// any interface (e.g. Next dev which listens on 0.0.0.0 by default). Binding
// to 127.0.0.1 would let two listeners coexist on different interfaces and
// silently report "free" for an already-in-use port.
function checkPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

let port = start;
for (let i = 0; i < maxTries; i++, port++) {
  if (await checkPort(port)) {
    console.log(port);
    process.exit(0);
  }
}
console.error(`No free port found in range ${start}-${port - 1}`);
process.exit(2);
