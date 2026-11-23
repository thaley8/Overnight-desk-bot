"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";

type ToastTone = "info" | "success" | "warning" | "critical";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = nextId++;
      setItems((s) => [...s.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "critical" ? 7000 : 4500);
    },
    [dismiss],
  );
  const icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: XCircle };
  const color = { info: "text-accent-2", success: "text-pos", warning: "text-warn", critical: "text-neg" };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} className="pointer-events-auto flex animate-slide-in items-start gap-3 rounded-lg border border-line-2 bg-elevated px-4 py-3 shadow-pop">
              <Icon className={cx("mt-0.5 size-4 shrink-0", color[t.tone])} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-fg">{t.title}</div>
                {t.detail && <div className="mt-0.5 text-xs text-fg-3">{t.detail}</div>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-fg-3 hover:text-fg">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
