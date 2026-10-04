import { OfficeApp } from '@/features/chat/office-app';
export default async function Chat({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  return <OfficeApp threadId={threadId} />;
}
