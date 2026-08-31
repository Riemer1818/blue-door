import { WrapReview } from "@/components/wrap-review";

export default async function Page({ params }: PageProps<"/wraps/[runId]">) {
  const { runId } = await params;
  return <WrapReview runId={runId} />;
}
