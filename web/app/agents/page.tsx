import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentsOverview } from "@/components/features/Agents";

export const metadata: Metadata = { title: "AI Agents" };

export default function Page() {
  return (
    <Suspense>
      <AgentsOverview />
    </Suspense>
  );
}
