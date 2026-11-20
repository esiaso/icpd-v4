import { CmsPage } from '@/components/cms-page';

export const dynamic = 'force-dynamic';

export default function AboutPage({ params }: { params: { slug: string } }) {
  return <CmsPage slug={params.slug} />;
}
