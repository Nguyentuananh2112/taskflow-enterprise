import { redirect } from 'next/navigation';

// `/w/[wsId]` ⇒ danh sách project (frontend.md §1.1).
export default async function WorkspacePage({
  params,
}: Readonly<{ params: Promise<{ wsId: string }> }>) {
  const { wsId } = await params;
  redirect(`/w/${encodeURIComponent(wsId)}/projects`);
}
