---
name: ux-design
description: Systematic UX design process for Colex platform features. Use when adding UI to the Garden workspace, creating new output components, modifying the sidebar/main panel/AI chat layout, or when the user says "design the UX", "where should this go", "wireframe this", or needs to decide how to surface new functionality. Runs a 7-step process with user feedback between each step. Assumes Mantine + Tailwind + Colex design system.
---

# UX Design Process

Run steps 0–6 in order. Present each step's output and wait for user feedback before proceeding. One step per message.

## Before Starting

Read the current page/component layout by exploring the relevant files. Use the Explore agent or read components directly. Do not guess the layout from memory.

Check [colex-design-system.md](references/colex-design-system.md) for available Mantine components, Tailwind tokens, icon conventions, and existing patterns.

## Step 0: Map Current IA + Object Inventory

**Map the layout** of the page(s) affected. Read the JSX to understand:
- What panels/sections exist and their dimensions
- What's in each section, in order from top to bottom
- What interactive elements exist (buttons, menus, toggles)

**Inventory the objects** (nouns) involved in the feature:
- What data objects are being added or changed?
- What existing objects do they relate to?
- What are the CRUD operations on each object?

Present as: ASCII layout diagram + object list with relationships.

## Step 1: Surface Audit

List EVERY place in the UI where the user currently interacts with related objects. Not just where the new feature should go — every existing touchpoint.

Include:
- Pages (which routes)
- Panels (sidebar, main, chat)
- Components (which task card sections, config areas, dropdowns)
- Flows (onboarding wizard, save-as-template, task execution)

Present as: numbered list grouped by page/panel.

## Step 2: Narrow to Change Surfaces + Information Per Surface

For each surface from Step 1, decide: **change needed** or **no change**.

For surfaces that need changes, list what information to show. For each piece of information, state why the user needs it.

Also state what NOT to show — information that seems relevant but would add noise. Explain why it's excluded.

Present as: table per surface with columns: Information | Why shown | Why NOT shown (for excluded items).

## Step 3: Priority Per Surface by State

For each change surface, list every state it can be in. For each state, rank the information from Step 2 by importance.

States to consider:
- Empty (no data yet)
- Loading (operation in progress)
- Has data (normal state)
- Error (operation failed)
- Editing (user modifying)
- Disabled (not available in current phase/context)

Present as: table per surface with columns: State | #1 Priority | #2 Priority | ... | Notes.

## Step 4: Representation

For each change surface, propose how to render each piece of information. Check constraints:

1. **Does a Mantine component exist for this?** Prefer existing components over custom HTML.
2. **Does the codebase already have a similar pattern?** Match it. Check `references/colex-design-system.md`.
3. **Does it fit the visual hierarchy?** Primary actions use `bg-brand`. Secondary use `border-border-muted`. Tertiary are text-only.
4. **Does it respect the space budget?** Sidebar is 280px — compact elements only. Main panel is fluid — can be generous.

Present as: prose description per surface with specific component names and Tailwind classes.

## Step 5: Wireframes

Draw ASCII wireframes for each change surface. Show:
- Layout structure (boxes, alignment)
- Content hierarchy (what's bigger/bolder)
- Key states (default + most important alternate state)

Format:
```
┌──────────────────────────┐
│  SECTION HEADER      [+] │
│  item 1              [x] │
│  item 2              [x] │
└──────────────────────────┘
```

Use `│ ├ └ ─ ┌ ┐ ┘ ┤ ┬ ┴ ┼` for box drawing.

If the feature warrants it, ask: "Should I include interaction notes (hover states, click behavior, animations)?" Let the user decide.

## Step 6: Plan Check

Search `docs/plans/` for existing implementation plans related to this feature. If found:
- List which plan files are affected
- State what sections need updating (new tasks, changed file list, revised component names)
- Ask whether to update them now or defer

If no related plans exist, note that an implementation plan will be needed and suggest using the `superpowers:writing-plans` skill.

## Output

Save the final UX spec (all steps consolidated) to `docs/ux/YYYY-MM-DD-<feature-name>.md`.
