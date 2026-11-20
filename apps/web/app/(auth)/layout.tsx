import Link from 'next/link';
import { Wordmark } from '@/components/site-header';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-3">
        <Wordmark />
        <span>
          <span className="block font-heading text-lg font-bold uppercase leading-tight text-muted-foreground">Integrated CPD Management System</span>
          <span className="block font-heading italic text-gold">A National CPD Program</span>
        </span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <div className="mt-6 h-1 w-full max-w-md bg-navy" />
    </div>
  );
}
