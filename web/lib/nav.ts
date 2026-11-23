import { Activity, BrainCircuit, ChartNoAxesCombined, Gauge, History, Layers, PlugZap, Radar, Settings2, ShieldAlert, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Desk",
    items: [
      { href: "/", label: "Command Center", icon: Gauge, description: "Performance, agents and live activity" },
      { href: "/scanner", label: "Token Scanner", icon: Radar, description: "Discovered pairs and analyst verdicts" },
      { href: "/agents", label: "AI Agents", icon: BrainCircuit, description: "Pipeline status and agent detail" },
    ],
  },
  {
    group: "Book",
    items: [
      { href: "/positions", label: "Open Positions", icon: Layers, description: "Exposure, marks and exits" },
      { href: "/trades", label: "Trade History", icon: History, description: "Every order with verification" },
      { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined, description: "Returns, risk-adjusted metrics, attribution" },
    ],
  },
  {
    group: "Control",
    items: [
      { href: "/risk", label: "Risk Management", icon: ShieldAlert, description: "Limits, alerts and emergency stop" },
      { href: "/wallet", label: "Wallet", icon: Wallet, description: "Balances, addresses and transfers" },
    ],
  },
  {
    group: "Infrastructure",
    items: [
      { href: "/system", label: "System Health", icon: Activity, description: "Services, resources and incidents" },
      { href: "/api-monitor", label: "API Monitor", icon: PlugZap, description: "Providers, latency and errors" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings2, description: "Limits, agents, notifications, display" };

export const ALL_NAV: NavItem[] = [...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

export function navFor(pathname: string): NavItem | undefined {
  if (pathname === "/") return ALL_NAV[0];
  return ALL_NAV.filter((n) => n.href !== "/").find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
}
