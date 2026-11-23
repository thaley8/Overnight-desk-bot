import type { Metadata } from "next";
import { Suspense } from "react";
import { Positions } from "@/components/features/Positions";

export const metadata: Metadata = { title: "Open Positions" };

export default function Page() {
  return (
    <Suspense>
      <Positions />
    </Suspense>
  );
}
