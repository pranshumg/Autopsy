"use client";

import { createContext, useContext, ViewTransition, type ReactNode } from "react";
import { create } from "zustand";
import type { InvestigationState } from "@/lib/types";
import { useLab } from "@/lib/store";

export const InvestigationIdContext = createContext<string | null>(null);

/** Current investigation. Lab views only mount once the shell has loaded it. */
export function useCurrent(): InvestigationState {
  const id = useContext(InvestigationIdContext);
  const s = useLab((st) => (id ? st.investigations[id] : undefined));
  if (!s) throw new Error("useCurrent() used outside a loaded investigation");
  return s;
}

export type SelectionKind = "feature" | "target" | "agent" | "hypothesis" | "experiment" | "surrogate" | "report" | "observation" | "task";
export type Selection = { kind: SelectionKind; id: string } | null;

type SelectionState = {
  selection: Selection;
  select: (s: Selection) => void;
  compare: [number | null, number | null];
  setCompare: (c: [number | null, number | null]) => void;
};

export const useSelection = create<SelectionState>((set) => ({
  selection: null,
  select: (selection) => set({ selection }),
  compare: [null, null],
  setCompare: (compare) => set({ compare }),
}));

/** Route-level enter/exit animation for lab views. */
export function LabView({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="lab-in" exit="lab-out" default="none">
      {children}
    </ViewTransition>
  );
}
