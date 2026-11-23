import type { Metadata } from "next";
import { Suspense } from "react";
import { Risk } from "@/components/features/Risk";

export const metadata: Metadata = { title: "Risk Management" };

export default function Page() {
  return (
    <Suspense>
      <Risk />
    </Suspense>
  );
}
