import type { Metadata } from "next";
import { Suspense } from "react";
import { Wallet } from "@/components/features/Wallet";

export const metadata: Metadata = { title: "Wallet" };

export default function Page() {
  return (
    <Suspense>
      <Wallet />
    </Suspense>
  );
}
