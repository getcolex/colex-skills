---
name: demo-recorder
description: Record product demos of the Colex platform using Playwright browser automation. Drives a headless browser through a user-described scenario, capturing annotated screenshots, screencast video with chapters, and documenting bugs found. Generates a click-through interactive HTML demo. Use when user says "record a demo", "demo recording", "capture demo", "product demo", or "/demo-recorder".
---

# Demo Recorder

Record Colex product demos by driving a Playwright browser through a scenario the user describes. Produces clean screenshots, annotated screenshots, video, a click-through HTML demo, a storyboard, and a bug report.

## Prerequisites

```bash
curl -s http://localhost:3342 -o /dev/null -w "%{http_code}"  # Frontend: 200
curl -s http://localhost:6684/server/health -o /dev/null -w "%{http_code}"  # Directus: 200
```
If services are not running, load the `local-dev-env` skill first.

## Setup

```bash
# 1. Ensure playwright is installed
mkdir -p /tmp/colex-demo && cd /tmp/colex-demo
[ -d node_modules/playwright ] || (npm init -y && npm install playwright)

# 2. Kill old driver, start fresh
lsof -ti :9300 | xargs kill -9 2>/dev/null; sleep 1
cp ~/.claude/skills/demo-recorder/references/playwright-driver.js /tmp/colex-demo/
cd /tmp/colex-demo && node playwright-driver.js &
sleep 3 && curl -s http://localhost:9300

# 3. Create output directory
OUT=~/dev/colex-demos/$(date +%d-%m-%Y-%H%M%S)
mkdir -p "$OUT/frames/clean" "$OUT/frames/annotated" "$OUT/video"

# 4. Tell driver about output dir
curl -s -X POST http://localhost:9300 -d '{"action":"set_outdir","path":"'"$OUT"'"}'
```

## Commands

Send JSON via `curl -s -X POST http://localhost:9300 -d '...'`.

### Browser Control

| Action | Payload |
|--------|---------|
| Navigate | `{"action":"goto","url":"http://localhost:3342"}` |
| Click selector | `{"action":"click","selector":"button:has-text(\"Sign in\")"}` |
| Click coords | `{"action":"click","x":640,"y":400}` |
| Fill input | `{"action":"fill","selector":"input[type=\"email\"]","value":"admin@example.com"}` |
| Type text | `{"action":"type","text":"Hello","delay":20}` |
| Press key | `{"action":"key","key":"Enter"}` |
| Wait time | `{"action":"wait","ms":3000}` |
| Wait element | `{"action":"wait","selector":".some-class"}` |
| Read text | `{"action":"text","selector":"body"}` |
| Get URL | `{"action":"url"}` |
| Scroll | `{"action":"scroll","x":640,"y":400,"scroll_direction":"down","scroll_amount":3}` |

### Screenshots

Each screenshot command saves TWO files:
- `frames/clean/{name}.png` — no overlay, for video editing
- `frames/annotated/{name}.png` — caption bar at bottom with step number

```json
{"action":"screenshot","name":"01-login","path":"/path/to/frames","step":1,"caption":"Sign in to Colex"}
```

The caption bar sits at the bottom edge of the viewport as a fixed bar — it never obscures the app UI.

### Video (screencast)

```json
{"action":"screencast_start","videoDir":"/path/to/video"}
{"action":"chapter","title":"Section Name"}
{"action":"screencast_stop"}
```

Video records the clean app — no DOM overlays. Chapter markers and click highlights (via `showActions`) are video-only annotations.

### Auto-Capture

Automatically captures a frame every time the UI changes meaningfully. Runs in the background while you drive the browser — no manual screenshot calls needed. Uses debounced screenshot comparison (change must persist for 2 consecutive polls to be saved, filtering out spinners and animations).

**Auto-capture frames are always clean — no annotations, no caption bars, no step numbers.** The driver strips any leftover caption bar before each auto-capture poll. Only manual `screenshot` commands produce annotated frames.

```json
{"action":"auto_capture_start","dir":"/path/to/auto","interval":500,"threshold":0.05}
{"action":"auto_capture_stop"}
{"action":"auto_capture_pause"}
{"action":"auto_capture_resume"}
{"action":"auto_capture_status"}
```

- `interval` — poll frequency in ms (default 500)
- `threshold` — minimum file size difference ratio to count as a change (default 0.05 = 5%)
- `dir` — where to save frames (default `$OUT/frames/auto`)

Frames are saved as `auto-0001.png`, `auto-0002.png`, etc. These can be stitched into a video with ffmpeg later.

**Recommended workflow:** Start auto-capture at the beginning, drive the browser normally, stop at the end. Also take manual screenshots at key moments for the annotated/clean frame pairs. Auto-capture gives you the full timeline (clean); manual screenshots give you the hero frames (clean + annotated).

### Bounding Boxes

Get element bounding boxes for click-through HTML hotspots:

```json
{"action":"boundingbox","selector":"button:has-text(\"Sign in\")"}
```

Returns `{"ok":true,"box":{"x":448,"y":491,"width":384,"height":36}}`. The `click` command also returns `box` when using a selector.

### Lifecycle

```json
{"action":"set_outdir","path":"/path/to/output"}
{"action":"stop"}
```

## Recording Workflow

### Phase 0: Start Auto-Capture

```
1. Start auto-capture: auto_capture_start (runs in background for the entire session)
2. This captures every visual state change automatically — you get the full timeline
3. Manual screenshots below are for hero frames with annotations
```

### Phase 1: Login

```
1. Start screencast: screencast_start (optional — for video)
2. Navigate to localhost:3342 → redirects to /login
3. Fill email: admin@example.com, password: change_me_admin_password
4. Click "Sign in", wait 3s
5. Chapter: "Login"
6. Screenshot: step 1, "Sign in to Colex"
```

### Phase 2: Drive the Scenario

Follow the user's scenario description. At each key moment:
1. Add a chapter marker for the video
2. Take a screenshot with step number and caption

**Key moments to always capture:**
- Projects page
- Create project modal (if creating)
- Workflow description entered
- AI building the workflow (goals appearing in sidebar)
- Full workspace with checks and tasks visible
- Agent task running (with timer)
- Agent task output (the result)
- Form task waiting for input
- Form task filled in
- Dependency chain (blocked checks showing what they wait for)
- Final rendered output (HTML, table, document)

### Phase 3: Wrap Up

```
1. Stop auto-capture: auto_capture_stop (returns total frame count)
2. Stop screencast if used: screencast_stop
3. Generate storyboard.md (see format below)
4. Generate bugs.md (see format below)
5. Generate click-through HTML from manual screenshots + bounding boxes (see below)
6. Stop driver: stop
```

## Generating the Click-Through HTML

After recording, generate `demo.html` from the annotated frames. Read the template from `references/demo-template.html`, replace the placeholders:

- `%%TITLE%%` → demo title (e.g., "Colex Demo: Enterprise Deal Prep")
- `%%FRAMES_JSON%%` → JSON array of frame objects

Each frame object:
```json
{"src": "frames/annotated/01-login.png", "step": "1", "caption": "Sign in to Colex"}
```

The HTML uses **relative paths** to `frames/annotated/` so it works when opened from the output directory. Read the template, do string replacement, write to `$OUT/demo.html`.

The HTML is self-contained — arrow keys or click to navigate, dots for direct access, captions from annotations.

## Storyboard Format

```markdown
# Demo: [Scenario Name]
Recorded: YYYY-MM-DD

## Frames

| # | File | Caption |
|---|------|---------|
| 1 | 01-login.png | Sign in to Colex |
| 2 | 02-projects.png | Projects dashboard |
...

## Auto-Capture Timeline
- frames/auto/ — N frames captured automatically on visual changes
- Use for stitching into video with ffmpeg or selecting additional hero frames

## Video (if recorded)
- demo-clean.webm — clean recording, no overlays

## Quality Notes
- [Assessment of AI-generated outputs]
- [Any frames that need re-recording]
```

## Bug Tracking

```markdown
# Bugs Found During Demo Recording
Date: YYYY-MM-DD

## Bug N: [Short description]
**Severity:** P0/P1/P2
**Screenshot:** [filename]
**Repro:** [What happened]
**Expected:** [What should happen]
**Recovery:** [How recording continued]
```

## Recovery Strategies

| Failure | Recovery |
|---------|----------|
| Token expired | goto /login, re-login, goto /garden/{id} |
| Task stays Idle | Click retry icon next to task name |
| Sidebar click no effect | goto URL directly: /garden/{projectId} |
| Agent task errors | Screenshot error, log bug, click retry |
| Submit button obscured | Use selector: `button:has-text("Submit")` |
| Page unresponsive | goto current URL again, re-login if needed |

## Cleanup

```bash
curl -s -X POST http://localhost:9300 -d '{"action":"stop"}'
# Or if unresponsive:
lsof -ti :9300 | xargs kill -9
```
