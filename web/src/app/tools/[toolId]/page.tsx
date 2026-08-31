import { ToolPage } from "@/components/tool-page";

export default async function Page({ params }: PageProps<"/tools/[toolId]">) {
  const { toolId } = await params;
  return <ToolPage toolId={toolId} />;
}
