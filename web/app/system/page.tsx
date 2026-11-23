import type { Metadata } from "next";
import { Suspense } from "react";
import { SystemHealth } from "@/components/features/SystemHealth";

export const metadata: Metadata = { title: "System Health" };

export default function Page() {
  return (
    <Suspense>
      <SystemHealth />
    </Suspense>
  );
}
