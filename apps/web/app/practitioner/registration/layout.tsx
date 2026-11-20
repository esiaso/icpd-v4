import { PageHeader } from '@/components/ui';
import { Stepper } from '@/components/registration/forms';

export default function RegistrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Registration application" description="Complete each step, then submit for screening by the regulator." />
      <Stepper />
      {children}
    </>
  );
}
