import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { DeskProvider } from "@/lib/store";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "Overnight Desk", template: "%s · Overnight Desk" },
  description: "Autonomous trading desk — agents, positions, risk and infrastructure in one terminal.",
};

export const viewport: Viewport = {
  themeColor: "#080F1C",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full">
        <DeskProvider>
          <AppShell>{children}</AppShell>
        </DeskProvider>
      </body>
    </html>
  );
}
