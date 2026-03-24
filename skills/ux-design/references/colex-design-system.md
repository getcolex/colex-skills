# Colex Design System Reference

## Layout

Garden workspace uses Mantine `AppShell` with three columns:
- **Sidebar** (280px): Navigation — goals/checks tree, pipeline controls
- **Main panel** (fluid): Selected check's content — task outputs, config
- **AI Chat aside** (380px): Collapsible right panel, contextual to selected check

## Mantine Components Available

Prefer these over custom HTML:
- Layout: `AppShell`, `Stack`, `Group`, `Box`, `ScrollArea`, `Grid`
- Text: `Text`, `Title`, `Badge`, `Code`
- Input: `TextInput`, `Textarea`, `Select`, `NumberInput`, `Switch`, `Checkbox`
- Feedback: `Alert`, `Loader`, `Skeleton`, `Tooltip`
- Overlay: `Modal`, `Drawer`, `Menu`, `Popover`
- Actions: `Button`, `ActionIcon`, `UnstyledButton`
- Data: `Table`, `Accordion`

## Tailwind Token Classes (from THEMING.md)

Never use hardcoded colors. Use semantic tokens:

| Pattern | Class |
|---------|-------|
| Page background | `bg-background` |
| Card/section background | `bg-surface-secondary` |
| Primary text | `text-foreground` |
| Secondary text | `text-foreground-subdued` |
| Muted text | `text-foreground-muted` |
| Borders | `border-border-muted` |
| Brand actions | `bg-brand`, `hover:bg-brand-hover` |
| Success | `bg-status-success-bg text-status-success` |
| Error | `bg-status-error-bg text-status-error` |
| Warning | `bg-status-warning-bg text-status-warning` |
| Focus | `focus:shadow-focus-brand` |
| Overlay | `bg-overlay` |

## Status Colors (from status-mapping.js)

- done: `#16a34a` (green)
- running: `#3b82f6` (blue)
- retrying: `#f59e0b` (amber)
- blocked: `#d6d3d1` (stone)
- errored: `#dc2626` (red)
- idle: `#94a3b8` (slate)

## Icons

Use `@tabler/icons-react`. Common icons in the codebase:
- `IconDots` (menu trigger), `IconAlertTriangle` (warnings)
- `IconUpload`, `IconDownload`, `IconTrash`, `IconFile`
- `IconCode`, `IconEye`

Size conventions: `size={12}` in compact areas (sidebar), `size={16}` in main content, `size={20}` for prominent actions.

## Existing Patterns

**Sidebar sections:** Uppercase xs text label with `c="dimmed"` and `tt="uppercase"`. Action button right-aligned in same row.

**Task output components:** Each output type has its own component in `frontend/src/components/outputs/`. Props: `{ data, onChange }`. Include `data-testid` on root element.

**Hover-reveal actions:** Use Tailwind `group` + `opacity-0 group-hover:opacity-100` for delete buttons that appear on hover (see OutputFiles pattern).

**Empty states:** Centered dimmed text with `py-4` or `py-8`. Include `data-testid` ending in `-empty`.

**Loading states:** Mantine `Loader` component or `loading` prop on `ActionIcon`/`Button`.
