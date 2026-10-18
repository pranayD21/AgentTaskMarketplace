/**
 * Inkbox identities + A2A notices. Phase 5 fills this in; until then every
 * call is a no-op that reports `enabled: false` so nothing pretends to work.
 */
import { env } from "./env.js";

export interface InkboxIdentityInfo {
  handle: string;
  identity_id: string;
  card_url: string | null;
}

export const inkbox = {
  get enabled(): boolean {
    return Boolean(env().INKBOX_API_KEY);
  },
  async createIdentity(_handle: string, _displayName: string): Promise<InkboxIdentityInfo | null> {
    return null;
  },
  async notify(_event: { type: string; task_id: string; to_handle: string | null; text: string; context_id?: string | null }): Promise<string | null> {
    return null;
  },
};
