/**
 * Playwright HTTP server for driving demo recordings.
 * Accepts JSON commands via POST to localhost:9300.
 *
 * Usage: cd /tmp/colex-demo && npm install playwright && node playwright-driver.js
 * Requires: playwright package installed in working directory
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

let page, context, browser;
let screenshotCounter = 0;
let outDir = '/tmp/colex-demo'; // default, overridden by set_outdir
const PORT = 9300;

// Auto-capture state
let autoCapture = null; // { interval, threshold, timer, lastBuf, frameCount, dir, paused }

async function init() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  page = await context.newPage();
  console.log('Browser ready');
}

// Inject a caption bar at the very bottom of the viewport (fixed position).
// Does NOT obscure the app UI — sits below the content area.
async function injectCaption(step, text) {
  await page.evaluate(({ step, text }) => {
    // Remove any existing caption
    document.querySelectorAll('.demo-caption-bar').forEach(el => el.remove());

    const bar = document.createElement('div');
    bar.className = 'demo-caption-bar';
    Object.assign(bar.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '99999',
      background: '#1a1a1a', color: '#fff',
      padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '12px',
      fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
      fontSize: '15px', lineHeight: '1.3',
      borderTop: '2px solid #333', pointerEvents: 'none',
    });

    const badge = document.createElement('span');
    Object.assign(badge.style, {
      background: '#e74c3c', color: '#fff', borderRadius: '4px',
      padding: '2px 8px', fontSize: '12px', fontWeight: '700',
      flexShrink: '0', letterSpacing: '0.5px',
    });
    badge.textContent = step;

    const label = document.createElement('span');
    label.textContent = text;

    bar.appendChild(badge);
    bar.appendChild(label);
    document.body.appendChild(bar);
  }, { step, text });
}

async function clearCaption() {
  await page.evaluate(() => {
    document.querySelectorAll('.demo-caption-bar').forEach(el => el.remove());
  });
}

// Auto-capture: polls screenshots, keeps frames that differ from previous.
// Uses double-check debounce: a change must persist for 2 consecutive polls
// to be captured (filters spinners/animations).
function startAutoCapture(dir, intervalMs, threshold) {
  if (autoCapture) stopAutoCapture();
  fs.mkdirSync(dir, { recursive: true });

  const state = {
    dir,
    threshold,
    frameCount: 0,
    lastBuf: null,       // last saved frame's buffer
    pendingBuf: null,    // candidate that differed once, needs confirmation
    paused: false,
    capturing: false,    // prevent overlapping captures
  };

  state.timer = setInterval(async () => {
    if (state.paused || state.capturing) return;
    state.capturing = true;
    try {
      await clearCaption(); // don't capture annotation bars
      await page.screencast.hideOverlays().catch(() => {}); // don't capture chapter overlays
      const buf = await page.screenshot();
      const size = buf.length;

      if (!state.lastBuf) {
        // First frame — always save
        state.frameCount++;
        const name = `auto-${String(state.frameCount).padStart(4, '0')}.png`;
        fs.writeFileSync(path.join(dir, name), buf);
        state.lastBuf = buf;
        state.pendingBuf = null;
        return;
      }

      // Compare by file size difference ratio
      const lastSize = state.lastBuf.length;
      const diff = Math.abs(size - lastSize) / Math.max(size, lastSize);

      if (diff < threshold) {
        // No meaningful change — reset pending
        state.pendingBuf = null;
        return;
      }

      if (!state.pendingBuf) {
        // First time seeing this change — mark as pending, wait for confirmation
        state.pendingBuf = buf;
        return;
      }

      // Pending exists — check if current still differs from last saved
      // (confirming the change persisted across 2 polls)
      const pendingDiff = Math.abs(size - state.pendingBuf.length) / Math.max(size, state.pendingBuf.length);
      if (pendingDiff < threshold) {
        // Current matches pending — change is stable, save it
        state.frameCount++;
        const name = `auto-${String(state.frameCount).padStart(4, '0')}.png`;
        fs.writeFileSync(path.join(dir, name), buf);
        state.lastBuf = buf;
        state.pendingBuf = null;
      } else {
        // Changed again — update pending, wait for next confirmation
        state.pendingBuf = buf;
      }
    } catch (e) {
      // Ignore screenshot errors during auto-capture (page might be navigating)
    } finally {
      state.capturing = false;
    }
  }, intervalMs);

  autoCapture = state;
  return state;
}

function stopAutoCapture() {
  if (!autoCapture) return { frameCount: 0 };
  clearInterval(autoCapture.timer);
  const count = autoCapture.frameCount;
  autoCapture = null;
  return { frameCount: count };
}

async function handleCommand(cmd) {
  try {
    switch (cmd.action) {
      // Navigation
      case 'goto':
        await page.goto(cmd.url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
        return { ok: true, url: page.url() };

      // Interaction — returns bounding box of clicked element when using selector
      case 'click': {
        let box = null;
        if (cmd.selector) {
          const locator = page.locator(cmd.selector).first();
          box = await locator.boundingBox().catch(() => null);
          await locator.click({ timeout: cmd.timeout || 5000 });
        } else if (cmd.x != null && cmd.y != null) {
          box = { x: cmd.x - 20, y: cmd.y - 20, width: 40, height: 40 };
          await page.mouse.click(cmd.x, cmd.y);
        }
        return { ok: true, box };
      }
      case 'fill':
        await page.fill(cmd.selector, cmd.value);
        return { ok: true };
      case 'boundingbox': {
        const loc = page.locator(cmd.selector).first();
        const bb = await loc.boundingBox().catch(() => null);
        return { ok: true, box: bb };
      }
      case 'type':
        await page.keyboard.type(cmd.text, { delay: cmd.delay || 0 });
        return { ok: true };
      case 'key':
        await page.keyboard.press(cmd.key);
        return { ok: true };
      case 'scroll':
        if (cmd.scroll_direction === 'up') await page.mouse.wheel(0, -(cmd.scroll_amount || 3) * 100);
        else if (cmd.scroll_direction === 'down') await page.mouse.wheel(0, (cmd.scroll_amount || 3) * 100);
        else if (cmd.scroll_direction === 'left') await page.mouse.wheel(-(cmd.scroll_amount || 3) * 100, 0);
        else if (cmd.scroll_direction === 'right') await page.mouse.wheel((cmd.scroll_amount || 3) * 100, 0);
        else await page.mouse.wheel(0, cmd.delta || 300);
        return { ok: true };

      // Waiting
      case 'wait':
        if (cmd.selector) await page.waitForSelector(cmd.selector, { timeout: cmd.timeout || 30000 });
        else await page.waitForTimeout(cmd.ms || 1000);
        return { ok: true };

      // Reading
      case 'text':
        return { text: await page.textContent(cmd.selector || 'body') };
      case 'url':
        return { url: page.url() };

      // Screenshot — takes TWO: clean + annotated
      // cmd: { name, path, step, caption }
      // Saves: path/clean/name.png and path/annotated/name.png
      case 'screenshot': {
        screenshotCounter++;
        const name = cmd.name || `step-${String(screenshotCounter).padStart(3, '0')}`;
        const base = cmd.path || `${outDir}/frames`;
        const cleanDir = path.join(base, 'clean');
        const annotatedDir = path.join(base, 'annotated');
        fs.mkdirSync(cleanDir, { recursive: true });
        fs.mkdirSync(annotatedDir, { recursive: true });

        // 1. Clean screenshot (no overlay)
        await clearCaption();
        const cleanPath = path.join(cleanDir, `${name}.png`);
        await page.screenshot({ path: cleanPath });

        // 2. Annotated screenshot (with caption bar)
        const step = cmd.step || screenshotCounter;
        const caption = cmd.caption || cmd.text || name.replace(/-/g, ' ');
        await injectCaption(step, caption);
        const annotatedPath = path.join(annotatedDir, `${name}.png`);
        await page.screenshot({ path: annotatedPath });
        await clearCaption();

        return { clean: cleanPath, annotated: annotatedPath, counter: screenshotCounter };
      }

      // Screencast recording — clean video, no DOM overlays
      // Uses screencast API overlays (chapters, action highlights) which are video-only
      case 'screencast_start': {
        const videoDir = cmd.videoDir || `${outDir}/video`;
        fs.mkdirSync(videoDir, { recursive: true });
        const cleanPath = path.join(videoDir, 'demo-clean.webm');
        const annotatedPath = path.join(videoDir, 'demo-annotated.webm');
        // Start clean recording
        await page.screencast.start({ path: cleanPath });
        // Store annotated path for later — we'll record a second pass or use chapters
        // For now, chapters go into the clean video (they're unobtrusive title cards)
        await page.screencast.showActions();
        return { ok: true, clean: cleanPath, annotated: annotatedPath };
      }
      case 'screencast_stop':
        await page.screencast.stop();
        return { ok: true };
      case 'chapter':
        await page.screencast.showChapter(cmd.title);
        return { ok: true };
      case 'overlay':
        await page.screencast.showOverlay(cmd.html);
        return { ok: true };
      case 'show_actions':
        await page.screencast.showActions();
        return { ok: true };
      case 'hide_overlays':
        await page.screencast.hideOverlays();
        return { ok: true };

      // Set output directory
      case 'set_outdir':
        outDir = cmd.path;
        return { ok: true, outDir };

      // Auto-capture: polls for visual changes, saves frames that persist
      // cmd: { interval: 500, threshold: 0.05, dir: "/path/to/auto" }
      case 'auto_capture_start': {
        const dir = cmd.dir || `${outDir}/frames/auto`;
        const interval = cmd.interval || 500;
        const threshold = cmd.threshold || 0.05;
        startAutoCapture(dir, interval, threshold);
        return { ok: true, dir, interval, threshold };
      }
      case 'auto_capture_stop': {
        const result = stopAutoCapture();
        return { ok: true, ...result };
      }
      case 'auto_capture_pause':
        if (autoCapture) autoCapture.paused = true;
        return { ok: true, paused: true };
      case 'auto_capture_resume':
        if (autoCapture) autoCapture.paused = false;
        return { ok: true, paused: false };
      case 'auto_capture_status':
        return {
          ok: true,
          running: !!autoCapture,
          frameCount: autoCapture?.frameCount || 0,
          paused: autoCapture?.paused || false,
        };

      // Lifecycle
      case 'stop':
        stopAutoCapture();
        await page.screencast.stop().catch(() => {});
        await context.close();
        await browser.close();
        process.exit(0);

      default:
        return { error: `Unknown action: ${cmd.action}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const result = await handleCommand(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Playwright demo driver running');
  }
});

init().then(() => {
  server.listen(PORT, () => console.log(`Demo driver on :${PORT}`));
});
