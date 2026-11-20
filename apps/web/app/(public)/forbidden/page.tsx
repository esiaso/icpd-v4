import Link from 'next/link';

export default function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-bold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-muted-foreground">If you think this is a mistake, contact the regulator.</p>
      <Link href="/" className="mt-6 inline-block text-primary underline">Go home</Link>
    </div>
  );
}
