import { useEffect, useState } from "react";
import { Cpu, MessageSquare, Settings2, SquarePen } from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "@/hooks/workspace";
import { ChatProvider, useChatContext } from "@/hooks/chat-context";
import { useLocalSetting } from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import { Brand, BrandMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Sidebar, SidebarFooter, SidebarGroupLabel, SidebarHeader, SidebarNav, SidebarNavItem } from "@/components/ui/sidebar";
import { Onboarding } from "@/views/Onboarding";
import { Account } from "@/views/Account";
import { Buyer } from "@/views/Buyer";
import { Seller } from "@/views/Seller";
import { TaskViewer } from "@/views/TaskViewer";

type View = "buyer" | "seller" | "account";

export function App() {
  if (location.pathname === "/task.html") return <TaskViewer />;
  return <WorkspaceProvider><Gate /></WorkspaceProvider>;
}

function Gate() {
  const { status, setup, error } = useWorkspace();
  const [skipped, setSkipped] = useLocalSetting("atm-skip-onboarding", "");
  const [entered, setEntered] = useState(false);
  useEffect(() => { if (setup.entryComplete) setEntered(true); }, [setup.entryComplete]);
  if (!status) return <Splash error={error} />;
  const showOnboarding = !setup.entryComplete && !(setup.chatLinked && skipped === "1") && !entered;
  if (showOnboarding) return <Onboarding onEnter={() => { setSkipped("1"); setEntered(true); }} />;
  return <ChatProvider enabled={setup.chatLinked}><Shell /></ChatProvider>;
}

function Shell() {
  const { status, setup, error, clearError } = useWorkspace();
  const { conversations, conversation, setConversation, newChat } = useChatContext();
  const [view, setView] = useLocalSetting("atm-tab", "buyer");
  const current = (["buyer", "seller", "account"].includes(view) ? view : "buyer") as View;
  const go = (next: View) => setView(next);
  const openChat = (id: string) => { setConversation(id); go("buyer"); };
  const startChat = () => { newChat(); go("buyer"); };
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar className="hidden md:flex">
        <SidebarHeader><Brand /></SidebarHeader>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarNav>
          <SidebarNavItem active={current === "buyer"} icon={<MessageSquare className="size-4" />} onClick={() => go("buyer")}>Buyer</SidebarNavItem>
          <SidebarNavItem active={current === "seller"} icon={<Cpu className="size-4" />} onClick={() => go("seller")}
            badge={setup.selling ? <i className="block size-1.5 rounded-full bg-success" aria-label="Selling" /> : undefined}>Seller</SidebarNavItem>
        </SidebarNav>
        <SidebarGroupLabel className="flex items-center justify-between pr-2">
          Chats
          <button onClick={startChat} aria-label="New chat" title="New chat" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><SquarePen className="size-3.5" aria-hidden /></button>
        </SidebarGroupLabel>
        <SidebarNav className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2">
          {conversations.length === 0 && <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No chats yet</p>}
          {conversations.slice(0, 40).map((c) => (
            <SidebarNavItem key={c.id} active={current === "buyer" && c.id === conversation} onClick={() => openChat(c.id)} className="h-8 text-[13px] font-normal"
              badge={c.active ? <i className="block size-1.5 rounded-full bg-info animate-pulse" aria-label="Working" /> : undefined}>{c.title}</SidebarNavItem>
          ))}
        </SidebarNav>
        <SidebarFooter>
          <button onClick={() => go("account")} aria-current={current === "account" ? "page" : undefined}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60", current === "account" && "bg-accent")}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold uppercase">{(setup.email || "?").slice(0, 1)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{setup.email || "Not signed in"}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{setup.readyCount} of 5 ready · Account</span>
            </span>
            <Settings2 className="size-3.5 text-muted-foreground" aria-hidden />
          </button>
          <div className="mt-2 flex flex-col gap-1.5 px-2 text-[10.5px] text-muted-foreground">
            <span>Runs on this computer · models stay local</span>
            <Badge tone="warning" className="w-fit px-1.5 py-0 text-[9.5px]">{status?.payments_label ?? "STRIPE TEST MODE"}</Badge>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col">
        <MobileNav current={current} go={go} onNewChat={startChat} />
        {error && (
          <Alert tone="danger" className="mx-6 mt-3"><span className="flex-1">{error}</span><button className="ml-3 text-[12px] underline underline-offset-2" onClick={clearError}>Dismiss</button></Alert>
        )}
        <div className="min-h-0 flex-1">
          {current === "buyer" && <Buyer onOpenAccount={() => go("account")} />}
          {current === "seller" && <Seller onOpenAccount={() => go("account")} />}
          {current === "account" && <div className="scroll-thin h-full overflow-y-auto"><Account /></div>}
        </div>
      </main>
    </div>
  );
}

function MobileNav({ current, go, onNewChat }: { current: View; go: (v: View) => void; onNewChat: () => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-2 md:hidden">
      <BrandMark className="mr-2 size-7" />
      {(["buyer", "seller", "account"] as View[]).map((v) => (
        <button key={v} onClick={() => go(v)} aria-current={current === v ? "page" : undefined}
          className={cn("rounded-md px-2.5 py-1.5 text-[13px] font-medium capitalize", current === v ? "bg-accent" : "text-muted-foreground")}>{v}</button>
      ))}
      <button onClick={onNewChat} aria-label="New chat" className="ml-auto grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"><SquarePen className="size-4" aria-hidden /></button>
    </div>
  );
}

function Splash({ error }: { error?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center animate-fade-up">
        <BrandMark className="size-10" />
        {error ? <Alert tone="danger" className="max-w-md text-left">{error}</Alert>
          : <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><i className="size-1.5 animate-pulse rounded-full bg-muted-foreground" aria-hidden />Connecting to your local dashboard…</p>}
      </div>
    </div>
  );
}
