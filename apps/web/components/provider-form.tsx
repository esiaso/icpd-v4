'use client';
import { useState } from 'react';
import { Button, Field, Input } from './ui';
import { MultiSelect } from './multi-select';
import { useReference } from '@/lib/hooks';
import { ApiError } from '@/lib/api';
import { applyApiError } from '@/lib/forms';

const FIELDS: [string, string, boolean, string?][] = [
  ['regNo', 'Accreditation / reg. no.', true],
  ['contactName', 'Contact person', false],
  ['physicalAddress', 'Physical address', true],
  ['street', 'Street', false],
  ['building', 'Building', false],
  ['postalAddress', 'Postal address', true],
  ['postalCode', 'Postal code', true],
  ['town', 'Town / city', true],
  ['phone', 'Telephone', true, 'tel'],
  ['fixedLine', 'Fixed line', false, 'tel'],
  ['email', 'Email', true, 'email'],
  ['website', 'Website', true, 'url'],
  ['facebook', 'Facebook', false],
  ['twitter', 'X / Twitter', false],
  ['linkedin', 'LinkedIn', false],
];

/** Provider details form. `coordinator` hides fields only the regulator may change. */
export function ProviderForm({ initial, onSubmit, coordinator }: { initial?: any; onSubmit: (v: any) => Promise<unknown>; coordinator?: boolean }) {
  const { data: ref } = useReference();
  const [specs, setSpecs] = useState<(number | string)[]>(initial?.specialities ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    for (const k of Object.keys(fd)) if (fd[k] === '') (fd as any)[k] = null;
    setBusy(true);
    setErrors({});
    try {
      await onSubmit({ ...fd, ...(coordinator ? {} : { specialities: specs.map(Number) }) });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  const fields = coordinator ? FIELDS.filter(([k]) => k !== 'regNo') : FIELDS;
  return (
    <form onSubmit={submit} className="space-y-4">
      {!coordinator && (
        <>
          <Field label="Provider name" error={errors.name} required><Input name="name" defaultValue={initial?.name} /></Field>
          <Field label="Specialities" error={errors.specialities} required><MultiSelect options={ref?.specialities ?? []} value={specs} onChange={setSpecs} /></Field>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([k, label, required, type]) => (
          <Field key={k} label={label} error={errors[k]} required={required}>
            <Input name={k} type={type ?? 'text'} defaultValue={initial?.[k] ?? ''} />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={busy}>Save</Button>
    </form>
  );
}
