import { notFound } from "next/navigation";
import { fixturePreviewEnabled } from "@/lib/portal/preview";
import { previewSnapshots } from "@/lib/portal/fixtures";
import PortalDashboard from "../portal-dashboard";

export const dynamic = "force-dynamic";
export default async function Preview({ searchParams }: { searchParams: Promise<{ project?: string; scenario?: string }> }) {
  if (!fixturePreviewEnabled()) notFound();
  const { project, scenario } = await searchParams;
  return <PortalDashboard email="test.candidate@example.invalid" name="Test candidate" snapshots={scenario === "empty" ? [] : previewSnapshots()} requestedProject={project} preview />;
}
