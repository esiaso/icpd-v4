import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/session';

/** Renders a regulator-authored CMS page (content is sanitised by the API on save). */
export async function CmsPage({ slug }: { slug: string }) {
  const page = await serverApi<{ title: string; description: string | null; content: string | null }>(`/public/pages/${encodeURIComponent(slug)}`);
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold">{page.title}</h1>
      {page.description && <p className="mt-2 text-muted-foreground">{page.description}</p>}
      <div className="mt-6 space-y-4 leading-relaxed [&_a]:text-primary [&_a]:underline [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: page.content ?? '' }} />
    </article>
  );
}
