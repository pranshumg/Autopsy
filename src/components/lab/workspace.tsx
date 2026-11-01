"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { PanelBottom, PanelLeft, PanelRight, Play } from "lucide-react";
import type { InvestigationState } from "@/lib/types";
import { useLab } from "@/lib/store";
import { CredentialField, useCredentialPrompt } from "@/components/target-bits";
import { cn } from "@/lib/format";
import { Button, Kbd, Segmented, Tip } from "@/components/ui";
import { InvestigationCanvas } from "./canvas";
import { Console } from "./console";
import { Explorer } from "./explorer";
import { Inspector } from "./inspector";

export function useMediaQuery(q: string, serverValue = true) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => serverValue,
  );
}

function Handle({ vertical }: { vertical?: boolean }) {
  return (
    <Separator
      className={cn(
        "group relative flex items-center justify-center bg-line outline-none transition-colors hover:bg-signal/40 data-[separator=active]:bg-signal focus-visible:bg-signal",
        vertical ? "h-px" : "w-px",
      )}
    >
      <span className={cn("absolute z-10", vertical ? "inset-x-0 -inset-y-1.5" : "inset-y-0 -inset-x-1.5")} />
    </Separator>
  );
}

export function Workspace({ inv }: { inv: InvestigationState }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  return desktop ? <DesktopWorkspace inv={inv} /> : <CompactWorkspace inv={inv} />;
}

function DesktopWorkspace({ inv }: { inv: InvestigationState }) {
  const left = useRef<PanelImperativeHandle | null>(null);
  const right = useRef<PanelImperativeHandle | null>(null);
  const bottom = useRef<PanelImperativeHandle | null>(null);
  const [collapsed, setCollapsed] = useState({ left: false, right: false, bottom: false });

  const toggle = (which: "left" | "right" | "bottom") => {
    const p = { left, right, bottom }[which].current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [role=slider]")) return;
      if (e.key === "[") toggle("left");
      else if (e.key === "]") toggle("right");
      else if (e.key === "\\") toggle("bottom");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sync = (which: "left" | "right" | "bottom") => (size: { inPixels: number }) => {
    const isCollapsed = size.inPixels < 1;
    setCollapsed((c) => (c[which] === isCollapsed ? c : { ...c, [which]: isCollapsed }));
  };

  return (
    <div className="relative h-full">
      <Group orientation="horizontal" className="h-full">
        <Panel panelRef={left} id="left" defaultSize="19" minSize={220} maxSize="34" collapsible collapsedSize={0} onResize={sync("left")}>
          <div className="h-full border-r border-transparent bg-ink-950">
            <Explorer inv={inv} />
          </div>
        </Panel>
        <Handle />
        <Panel id="center" minSize="30">
          <Group orientation="vertical" className="h-full">
            <Panel id="canvas" minSize="25">
              <div className="relative h-full">
                <InvestigationCanvas inv={inv} />
                <CanvasToolbar inv={inv} collapsed={collapsed} toggle={toggle} />
                {inv.status === "idle" && <LaunchOverlay inv={inv} />}
              </div>
            </Panel>
            <Handle vertical />
            <Panel panelRef={bottom} id="console" defaultSize="30" minSize={120} collapsible collapsedSize={0} onResize={sync("bottom")}>
              <Console inv={inv} onCollapse={() => toggle("bottom")} />
            </Panel>
          </Group>
        </Panel>
        <Handle />
        <Panel panelRef={right} id="right" defaultSize="23" minSize={280} maxSize="40" collapsible collapsedSize={0} onResize={sync("right")}>
          <div className="h-full bg-ink-950">
            <Inspector inv={inv} />
          </div>
        </Panel>
      </Group>
    </div>
  );
}

function CanvasToolbar({ collapsed, toggle }: { inv: InvestigationState; collapsed: { left: boolean; right: boolean; bottom: boolean }; toggle: (w: "left" | "right" | "bottom") => void }) {
  const btn = (on: boolean) => cn("flex h-7 w-7 items-center justify-center rounded transition-colors", on ? "text-fg-2 hover:text-fg" : "bg-signal/10 text-signal");
  return (
    <div className="glass absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-md p-0.5">
      <Tip content={<span className="flex items-center gap-2">Explorer panel <Kbd>[</Kbd></span>}>
        <button type="button" aria-label="Toggle explorer panel" aria-pressed={!collapsed.left} className={btn(!collapsed.left)} onClick={() => toggle("left")}>
          <PanelLeft size={14} />
        </button>
      </Tip>
      <Tip content={<span className="flex items-center gap-2">Console <Kbd>\</Kbd></span>}>
        <button type="button" aria-label="Toggle console panel" aria-pressed={!collapsed.bottom} className={btn(!collapsed.bottom)} onClick={() => toggle("bottom")}>
          <PanelBottom size={14} />
        </button>
      </Tip>
      <Tip content={<span className="flex items-center gap-2">Inspector <Kbd>]</Kbd></span>}>
        <button type="button" aria-label="Toggle inspector panel" aria-pressed={!collapsed.right} className={btn(!collapsed.right)} onClick={() => toggle("right")}>
          <PanelRight size={14} />
        </button>
      </Tip>
    </div>
  );
}

function LaunchOverlay({ inv }: { inv: InvestigationState }) {
  const start = useLab((s) => s.start);
  const setPace = useLab((s) => s.setPace);
  const { show: askKey, missing: missingKey } = useCredentialPrompt(inv.target);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/60 backdrop-blur-[2px]">
      <div className="glass corner-ticks w-[min(440px,92%)] rounded-xl p-6 text-center">
        <div className="label-mono">Ready to investigate</div>
        <div className="mt-2 font-serif text-3xl italic text-fg">{inv.target.name}</div>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-2">
          Four agents will probe this black box with up to <span className="text-fg">{inv.budget.limit.toLocaleString()} queries</span>, test every hypothesis they form, and publish only the patterns the evidence supports.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Segmented
            label="Investigation pace"
            value={inv.pace}
            onChange={(p) => setPace(inv.id, p)}
            options={[
              { value: "cinematic", label: "Cinematic" },
              { value: "standard", label: "Standard" },
              { value: "instant", label: "Max" },
            ]}
          />
        </div>
        {askKey && (
          <div className="mt-4 text-left">
            <CredentialField target={inv.target} compact />
          </div>
        )}
        <Button variant="primary" size="lg" className="mt-5" onClick={() => start(inv.id)} autoFocus disabled={missingKey}>
          <Play size={14} fill="currentColor" /> Launch investigation
        </Button>
      </div>
    </div>
  );
}

function CompactWorkspace({ inv }: { inv: InvestigationState }) {
  const [tab, setTab] = useState<"inspector" | "explorer" | "console">("inspector");
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="relative h-[58vh] min-h-[360px] shrink-0 border-b border-line">
        <InvestigationCanvas inv={inv} />
        {inv.status === "idle" && <LaunchOverlay inv={inv} />}
      </div>
      <div className="sticky top-0 z-10 border-b border-line bg-ink-950 p-2">
        <Segmented
          label="Panel"
          value={tab}
          onChange={setTab}
          options={[
            { value: "inspector", label: "Findings" },
            { value: "explorer", label: "Experiments" },
            { value: "console", label: "Terminal" },
          ]}
        />
      </div>
      <div className="min-h-[50vh]">
        {tab === "inspector" && <Inspector inv={inv} />}
        {tab === "explorer" && <Explorer inv={inv} />}
        {tab === "console" && (
          <div className="h-[60vh]">
            <Console inv={inv} />
          </div>
        )}
      </div>
    </div>
  );
}
