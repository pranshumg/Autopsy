"use client";

import * as RTooltip from "@radix-ui/react-tooltip";
import { MotionConfig } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { useLab } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  const hydrate = useLab((s) => s.hydrate);
  const loadTargets = useLab((s) => s.loadTargets);
  useEffect(() => {
    hydrate();
    void loadTargets();
  }, [hydrate, loadTargets]);
  return (
    <MotionConfig reducedMotion="user">
      <RTooltip.Provider delayDuration={250} skipDelayDuration={150}>
        {children}
      </RTooltip.Provider>
    </MotionConfig>
  );
}
