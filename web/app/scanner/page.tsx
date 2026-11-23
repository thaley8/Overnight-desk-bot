import type { Metadata } from "next";
import { Suspense } from "react";
import { Scanner } from "@/components/features/Scanner";

export const metadata: Metadata = { title: "Token Scanner" };

export default function Page() {
  return (
    <Suspense>
      <Scanner />
    </Suspense>
  );
}
