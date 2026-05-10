#!/usr/bin/env node
/**
 * agent-browser.mjs — Playwright CLI helper for ui-check fix-agents.
 *
 * Lets a fix-agent capture a screenshot, dump computed styles, or read
 * outerHTML of a CSS selector against a live URL. Each invocation
 * launches headless Chromium, waits for fonts.ready, performs the action,
 * and exits. No persistent state.
 *
 * Usage:
 *   node agent-browser.mjs screenshot --url <url> --selector <css> --out <path>
 *   node agent-browser.mjs style      --url <url> --selector <css> [--props default|all]
 *   node agent-browser.mjs dom        --url <url> --selector <css>
 *
 * Optional flags (any command):
 *   --click <css>       click this selector before measuring/screenshotting
 *                       (use to open a modal, expand a popover, etc.)
 *   --wait-for <css>    wait until this selector is visible after navigation
 *                       (and after --click if both are given)
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime/playwright error
 *   2 — bad arguments
 *
 * Imports playwright by name; the script assumes the cwd is inside a
 * project that has playwright as a dependency (true for any project
 * using uiMatch). If you need to run it from elsewhere, set
 * NODE_PATH to point at the project's node_modules.
 */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        args[a.slice(2)] = argv[++i];
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (!cmd || !['screenshot', 'style', 'dom'].includes(cmd)) {
  console.error('Usage: agent-browser.mjs <screenshot|style|dom> --url <url> --selector <css> [...]');
  process.exit(2);
}
if (!args.url || !args.selector) {
  console.error(`Missing required --url or --selector for ${cmd}`);
  process.exit(2);
}
if (cmd === 'screenshot' && !args.out) {
  console.error('Missing required --out for screenshot');
  process.exit(2);
}

let chromium;
try {
  // ES module bare-specifier resolution ignores NODE_PATH in Node v18+.
  // Resolve playwright via NODE_PATH env var (absolute path) if set,
  // otherwise fall back to bare 'playwright' (works when cwd has node_modules).
  const nodePath = process.env.NODE_PATH;
  const playwrightSpecifier = nodePath
    ? new URL('playwright/index.js', `file://${nodePath.split(':')[0]}/`).href
    : 'playwright';
  const pw = await import(playwrightSpecifier);
  // CJS-wrapped imports expose named exports on `.default`; native ESM exposes them directly.
  ({ chromium } = pw.chromium ? pw : (pw.default ?? pw));
} catch (e) {
  console.error(`Could not load playwright: ${e.message}`);
  console.error('Run from a project root that has playwright in node_modules, or set NODE_PATH.');
  process.exit(1);
}

// Parse --viewport=WxH (default 1440x900). Tolerates either form
// `--viewport=402x844` or `--viewport 402x844` since parseArgs handles both.
function parseViewport(s) {
  const m = String(s).match(/^(\d+)x(\d+)$/i);
  if (!m) return { width: 1440, height: 900 };
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}
const viewport = parseViewport(args.viewport ?? '1440x900');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();

try {
  const resp = await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (resp && !resp.ok()) {
    console.error(`agent-browser: ${args.url} returned ${resp.status()} ${resp.statusText()}`);
    await browser.close();
    process.exit(1);
  }
  await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10_000 }).catch(() => {});

  // Optional: click an element first (e.g. open a modal) before measuring.
  if (args.click) {
    const clickLoc = page.locator(args.click).first();
    await clickLoc.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
      throw new Error(`--click selector "${args.click}" not visible`);
    });
    await clickLoc.click();
  }

  // Optional: wait for a marker selector to appear (e.g. modal dialog).
  if (args['wait-for']) {
    await page.locator(args['wait-for']).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
      throw new Error(`--wait-for selector "${args['wait-for']}" never appeared`);
    });
  }

  const loc = page.locator(args.selector);
  const matchCount = await loc.count();
  if (matchCount === 0) {
    console.error(`agent-browser: selector "${args.selector}" matched 0 elements`);
    await browser.close();
    process.exit(1);
  }
  if (matchCount > 1) {
    console.error(`agent-browser: selector "${args.selector}" matched ${matchCount} elements; using the first`);
  }
  const first = loc.first();
  await first.waitFor({ state: 'visible', timeout: 10_000 });

  if (cmd === 'screenshot') {
    await first.screenshot({ path: args.out });
    console.log(`wrote ${args.out}`);
  } else if (cmd === 'style') {
    const propsMode = args.props ?? 'default';
    const result = await first.evaluate((el, mode) => {
      const cs = getComputedStyle(el);
      const out = {};
      const defaults = [
        'width', 'height', 'display', 'position',
        'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform',
        'color', 'background-color', 'border', 'border-radius',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'opacity',
      ];
      const props = mode === 'all' ? Array.from(cs) : defaults;
      for (const p of props) out[p] = cs.getPropertyValue(p);
      const rect = el.getBoundingClientRect();
      out.__rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      return out;
    }, propsMode);
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'dom') {
    const html = await first.evaluate((el) => el.outerHTML);
    console.log(html);
  }
  await browser.close();
  process.exit(0);
} catch (err) {
  console.error(`agent-browser ${cmd} failed: ${err.message}`);
  await browser.close().catch(() => {});
  process.exit(1);
}
