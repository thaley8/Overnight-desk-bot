"use client";

import { useToast } from "@/components/ui/Toast";

export function useCopy() {
  const toast = useToast();
  return async (text: string, what = "Value") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: `${what} copied` });
    } catch {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: "Your browser blocked clipboard access." });
    }
  };
}

/** Download rows as CSV (client-side only). */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
