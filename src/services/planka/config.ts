/**
 * Planka integration config, read once from Vite env vars.
 * Copy .env.example → .env and fill in values; missing values simply
 * disable the integration (the app is fully local-first without it).
 */

export interface PlankaConfig {
  /** Base URL without trailing slash, e.g. https://planka.example.com */
  baseUrl: string;
  /** API token created in Planka (个人设置 → API 令牌) */
  token: string;
  /** Board to sync with. Optional: needed for pull/push, not for the probe. */
  boardId?: string;
  /** List that receives pushed tasks. Optional: defaults to the board's first list. */
  listId?: string;
}

export function plankaConfig(): PlankaConfig | null {
  const baseUrl = String(import.meta.env.VITE_PLANKA_URL ?? '').replace(/\/+$/, '');
  const token = String(import.meta.env.VITE_PLANKA_TOKEN ?? '');
  if (!baseUrl || !token) return null;
  return {
    baseUrl,
    token,
    boardId: String(import.meta.env.VITE_PLANKA_BOARD_ID ?? '') || undefined,
    listId: String(import.meta.env.VITE_PLANKA_LIST_ID ?? '') || undefined,
  };
}

export const plankaEnabled = (): boolean => plankaConfig() !== null;
