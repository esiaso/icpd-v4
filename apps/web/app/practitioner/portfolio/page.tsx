'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PortfolioView } from '@/components/cpd/portfolio-view';
import { Alert, PageHeader } from '@/components/ui';
import { get } from '@/lib/api';

export default function PortfolioPage() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/auth/me') });
  if (me && !me.practitionerId) {
    return (
      <Alert variant="warning">
        You don&apos;t have a practitioner profile yet. <Link className="font-medium underline" href="/practitioner/registration/new">Start your registration application</Link>.
      </Alert>
    );
  }
  return (
    <>
      <PageHeader title="My CPD portfolio" actions={<Link href="/practitioner/portfolio/claim" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Claim points</Link>} />
      {me && <PortfolioView base="/me" pdfBase="/me" certificate />}
    </>
  );
}
