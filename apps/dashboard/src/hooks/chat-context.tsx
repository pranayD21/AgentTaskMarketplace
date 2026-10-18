import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Run } from "@/lib/api";
import { conversationOf } from "@/lib/chat";
import { newId, useChat, useLocalSetting } from "./useChat";

export interface Conversation { id: string; title: string; active: boolean }

interface ChatState {
  runs: Run[];
  loaded: boolean;
  refresh: () => Promise<void>;
  conversation: string;
  setConversation: (id: string) => void;
  newChat: () => void;
  conversations: Conversation[];
}

const Ctx = createContext<ChatState | null>(null);

/** Chat history plus the selected conversation, shared by the sidebar and the Buyer window. */
export function ChatProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { runs, loaded, refresh } = useChat(enabled);
  const [conversation, setConversation] = useLocalSetting("atm-conversation", newId());
  const newChat = useCallback(() => setConversation(newId()), [setConversation]);
  const conversations = useMemo<Conversation[]>(() => {
    const seen = new Map<string, Conversation>();
    for (const run of [...runs].reverse()) {
      const id = conversationOf(run);
      const existing = seen.get(id);
      if (!existing) seen.set(id, { id, title: "", active: ["running", "waiting"].includes(run.status) });
      else if (["running", "waiting"].includes(run.status)) existing.active = true;
    }
    for (const run of runs) { const c = seen.get(conversationOf(run)); if (c && !c.title) c.title = run.prompt.replace(/\s+/g, " ").trim().slice(0, 48) || "Untitled"; }
    return [...seen.values()];
  }, [runs]);
  const value = useMemo<ChatState>(() => ({ runs, loaded, refresh, conversation, setConversation, newChat, conversations }),
    [runs, loaded, refresh, conversation, setConversation, newChat, conversations]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
