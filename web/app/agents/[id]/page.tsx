import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentDetail } from "@/components/features/Agents";
import { AGENT_META, AGENT_ORDER } from "@/lib/demo/generate";
import type { AgentId } from "@/lib/types";

const isAgent = (id: string): id is AgentId => (AGENT_ORDER as string[]).includes(id);

export function generateStaticParams() {
  return AGENT_ORDER.map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/agents/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: isAgent(id) ? `${AGENT_META[id].name} agent` : "Agent" };
}

export default async function Page({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  if (!isAgent(id)) notFound();
  return <AgentDetail id={id} />;
}
