/**
 * localStorage primitives for the Assistant's "skip-all" preference.
 *
 * When skip-all is on, the Assistant auto-approves every gate that would
 * otherwise require an explicit user click: the plan-proposal gate, the
 * destructive set_flow gate, and the validated-component/document gate. The
 * preference persists across sessions because it is a UX habit, not a
 * per-conversation choice — once a power user opts in, they stay opted in
 * until they toggle off.
 *
 * Both helpers are defensive: localStorage can throw in private browsing
 * mode or when sandbox restrictions apply, and a corrupted value must not
 * silently re-enable a destructive behavior.
 */

const STORAGE_KEY = "langflow-assistant-skip-all";
// Turning skip-all off removes STORAGE_KEY, so "off" and "never chose" look the
// same there. This marker tells them apart: only a user who never chose follows
// the deployment default (assistant_auto_apply_default).
const EXPLICIT_KEY = "langflow-assistant-skip-all-set";
const ENABLED_VALUE = "true";

export function readSkipAll(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === ENABLED_VALUE;
  } catch {
    return false;
  }
}

export function writeSkipAll(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, ENABLED_VALUE);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable (private browsing). Skip-all just
    // won't survive the reload — the user can re-toggle.
  }
}

export function hasExplicitSkipAll(): boolean {
  try {
    return (
      localStorage.getItem(EXPLICIT_KEY) === ENABLED_VALUE ||
      // Users who turned it on before the marker existed did choose.
      localStorage.getItem(STORAGE_KEY) === ENABLED_VALUE
    );
  } catch {
    return false;
  }
}

export function markSkipAllExplicit(): void {
  try {
    localStorage.setItem(EXPLICIT_KEY, ENABLED_VALUE);
  } catch {
    // see writeSkipAll
  }
}
