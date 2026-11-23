"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";
import { IconButton } from "./primitives";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

function useBodyLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

/** Moves focus into the overlay on open and back to the trigger on close. */
function useFocusReturn(open: boolean, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusable = el?.querySelector<HTMLElement>("[data-autofocus], input, button:not([aria-label='Close'])");
    (focusable ?? el)?.focus();
    return () => prev?.focus?.();
  }, [open, ref]);
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useBodyLock(open);
  useFocusReturn(open, ref);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-[#03070f]/70" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full animate-slide-in flex-col border-l border-line-2 bg-bg-2 shadow-pop focus:outline-none"
        style={{ maxWidth: width }}
      >
        <header className="flex items-start gap-3 px-6 py-5 hairline-b">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-fg">{title}</div>
            {subtitle && <div className="mt-1 text-xs text-fg-3">{subtitle}</div>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({ open, onClose, title, children, footer, tone, width = 440 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; tone?: "danger"; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useBodyLock(open);
  useFocusReturn(open, ref);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-[#03070f]/75" onClick={onClose} />
      <div ref={ref} role="alertdialog" aria-modal="true" tabIndex={-1} className={cx("relative w-full animate-fade-in rounded-xl border bg-bg-2 shadow-pop focus:outline-none", tone === "danger" ? "border-neg/30" : "border-line-2")} style={{ maxWidth: width }}>
        {tone === "danger" && <div className="absolute inset-x-0 top-0 h-px rounded-t-xl bg-neg/70" />}
        <div className="px-6 pb-2 pt-5 text-[15px] font-semibold text-fg">{title}</div>
        <div className="px-6 pb-5 text-sm text-fg-2">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-line bg-bg/40 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Anchored popover. Positioned below its trigger, right-aligned. */
export function Popover({ open, onClose, children, className, anchorRef }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; anchorRef: React.RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return (
    <div ref={ref} className={cx("absolute right-0 top-[calc(100%+8px)] z-40 animate-fade-in rounded-lg border border-line-2 bg-elevated shadow-pop", className)}>
      {children}
    </div>
  );
}
