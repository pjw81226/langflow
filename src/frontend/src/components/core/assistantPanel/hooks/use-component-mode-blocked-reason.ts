import useAuthStore from "@/stores/authStore";
import { useUtilityStore } from "@/stores/utilityStore";

/**
 * Why the Component mode cannot be used on this server, as the translation key
 * of the explanation, or null when it can. The backend refuses component turns
 * in the same two cases, so the switch says so up front instead.
 */
export function useComponentModeBlockedReason(): string | null {
  const allowCustomComponents = useUtilityStore(
    (state) => state.allowCustomComponents,
  );
  const adminOnly = useUtilityStore((state) => state.customComponentAdminOnly);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  if (!allowCustomComponents) return "assistant.mode.componentDisabled";
  if (adminOnly && !isAdmin) return "assistant.mode.componentAdminOnly";
  return null;
}
