/**
 * Shared Tailwind class strings for the assistant panel's action buttons.
 * Keeps cards visually consistent: changing a dimension or hover colour here
 * updates every card at once, instead of drifting across copies of the
 * same string.
 *
 *  - GHOST_PRIMARY_BUTTON   — the affirmative action on a card. Examples:
 *    Continue (component ready), Approve (component), Apply (prompt).
 *  - GHOST_SECONDARY_BUTTON — neutral secondary actions. Examples:
 *    View Code, Copy, Undo, Test again.
 *
 * Every assistant card (component, prompt, test result) uses this single
 * ghost/emerald pattern so the affirmative/secondary actions read
 * identically across the panel.
 */

export const GHOST_PRIMARY_BUTTON =
  "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent-emerald-foreground transition-colors hover:bg-accent-emerald-foreground/10";

export const GHOST_SECONDARY_BUTTON =
  "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
