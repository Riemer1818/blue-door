import { FilesView } from "@/components/files-view";

export default async function ExperimentPage({ params }: PageProps<"/files/[nodeId]">) {
  const { nodeId } = await params;
  return <FilesView nodeId={nodeId} />;
}
