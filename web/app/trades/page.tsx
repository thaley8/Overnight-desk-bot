import type { Metadata } from "next";
import { Suspense } from "react";
import { Trades } from "@/components/features/Trades";

export const metadata: Metadata = { title: "Trade History" };

export default function Page() {
  return (
    <Suspense>
      <Trades />
    </Suspense>
  );
}
