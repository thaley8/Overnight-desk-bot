import type { Metadata } from "next";
import { Suspense } from "react";
import { Analytics } from "@/components/features/Analytics";

export const metadata: Metadata = { title: "Trading Analytics" };

export default function Page() {
  return (
    <Suspense>
      <Analytics />
    </Suspense>
  );
}
