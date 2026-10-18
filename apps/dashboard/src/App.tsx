import { useEffect, useState } from "react";
import { Cpu, MessageSquare, Settings2 } from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "@/hooks/workspace";
import { useLocalSetting } from "@/hooks/useChat";
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
  return <WorkspaceProvider><Shell /></WorkspaceProvider>;
}

function Shell() {
  const { status, setup, error, clearError } = useWorkspace();
  const [view, setView] = useLocalSetting("atm-tab", "buyer");
  const [skipped, setSkipped] = useLocalSetting("atm-skip-onboarding", "");
  const [entered, setEntered] = useState(false);
  useEffect(() => { if (setup.entryComplete) setEntered(true); }, [setup.entryComplete]);

  if (!status) return <Splash error={error} />;
  const showOnboarding = !setup.entryComplete && !(setup.chatLinked && skipped === "1") && !entered;
  if (showOnboarding) return <Onboarding onEnter={() => { setSkipped("1"); setEntered(true); }} />;

  const current = (["buyer", "seller", "account"].includes(view) ? view : "buyer") as View;
  const go = (next: View) => setView(next);
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
        <SidebarFooter>
          <button onClick={() => go("account")} aria-current={current === "account" ? "page" : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60 ${current === "account" ? "bg-accent" : ""}`}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold uppercase">{(setup.email || "?").slice(0, 1)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{setup.email || "Not signed in"}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{setup.readyCount} of 5 ready · Account</span>
            </span>
            <Settings2 className="size-3.5 text-muted-foreground" aria-hidden />
          </button>
          <div className="mt-2 flex flex-col gap-1.5 px-2 text-[10.5px] text-muted-foreground">
            <span>Runs on this computer · models stay local</span>
            <Badge tone="warning" className="w-fit px-1.5 py-0 text-[9.5px]">{status.payments_label ?? "STRIPE TEST MODE"}</Badge>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col">
        <MobileNav current={current} go={go} />
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

function MobileNav({ current, go }: { current: View; go: (v: View) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-2 md:hidden">
      <BrandMark className="mr-2 size-7" />
      {(["buyer", "seller", "account"] as View[]).map((v) => (
        <button key={v} onClick={() => go(v)} aria-current={current === v ? "page" : undefined}
          className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium capitalize ${current === v ? "bg-accent" : "text-muted-foreground"}`}>{v}</button>
      ))}
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
