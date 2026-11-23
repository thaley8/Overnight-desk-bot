import type { Metadata } from "next";
import { Suspense } from "react";
import { ApiMonitor } from "@/components/features/ApiMonitor";

export const metadata: Metadata = { title: "API Monitoring" };

export default function Page() {
  return (
    <Suspense>
      <ApiMonitor />
    </Suspense>
  );
}
