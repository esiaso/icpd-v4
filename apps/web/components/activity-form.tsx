'use client';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { activitySchema } from '@icpd/shared';
import { Alert, Button, Field, Input, Select } from './ui';
import { MultiSelect } from './multi-select';
import { useReference } from '@/lib/hooks';
import { applyApiError, useZodForm } from '@/lib/forms';
import { pts } from '@/lib/utils';

const dateOnly = (d?: string) => (d ? d.slice(0, 10) : '');

export function ActivityForm({ initial, onSubmit, submitLabel = 'Save' }: { initial?: any; onSubmit: (v: any) => Promise<unknown>; submitLabel?: string }) {
  const { data: ref } = useReference();
  const form = useZodForm<any>(activitySchema, {
    defaultValues: {
      activityTypeId: initial?.activityTypeId ?? '',
      name: initial?.name ?? '',
      shortTitle: initial?.shortTitle ?? '',
      numSessions: initial?.numSessions ?? 1,
      releaseDate: dateOnly(initial?.releaseDate),
      expiryDate: dateOnly(initial?.expiryDate),
      endTime: initial?.endTime ?? '',
      deliveryMode: initial?.deliveryMode ?? 'physical',
      venue: initial?.venue ?? '',
      venueOnline: initial?.venueOnline ?? '',
      city: initial?.city ?? '',
      specializationAreas: initial?.specializationAreas ?? [],
    },
  });
  const [busy, setBusy] = useState(false);
  const e = form.formState.errors as any;
  const typeId = Number(form.watch('activityTypeId'));
  const sessions = Number(form.watch('numSessions')) || 1;
  const mode = form.watch('deliveryMode');
  const type = ref?.activityTypes.find((t) => t.id === typeId);
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      await onSubmit(v);
    } catch (err) {
      applyApiError(form, err);
    } finally {
      setBusy(false);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Activity type" error={e.activityTypeId?.message} required>
          <Select {...form.register('activityTypeId')}>
            <option value="">Choose…</option>
            {ref?.activityTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Number of sessions" error={e.numSessions?.message} required>
          <Input type="number" min={1} {...form.register('numSessions')} />
        </Field>
      </div>
      {type && (
        <Alert>
          <b>{pts(type.cpdPoints)}</b> points per session × {sessions} = <b>{pts(Number(type.cpdPoints) * sessions)}</b> maximum points per attendee.
          {Number(type.presenterPoints) > 0 && ` Presenters get +${pts(type.presenterPoints)}, moderators +${pts(type.moderatorPoints)}.`}
          {type.evidenceRequired && <span className="block text-xs text-muted-foreground">Evidence: {type.evidenceRequired}</span>}
        </Alert>
      )}
      <Field label="Activity name" error={e.name?.message} required><Input maxLength={255} {...form.register('name')} /></Field>
      <Field label="Short title"><Input {...form.register('shortTitle')} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Start date" error={e.releaseDate?.message} required><Input type="date" {...form.register('releaseDate')} /></Field>
        <Field label="End date" error={e.expiryDate?.message} required><Input type="date" {...form.register('expiryDate')} /></Field>
        <Field label="End time"><Input type="time" {...form.register('endTime')} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Delivery mode" required>
          <Select {...form.register('deliveryMode')}><option value="physical">Physical</option><option value="online">Online</option><option value="hybrid">Hybrid</option></Select>
        </Field>
        {mode !== 'online' && <Field label="Venue"><Input {...form.register('venue')} /></Field>}
        {mode !== 'online' && <Field label="City / town"><Input {...form.register('city')} /></Field>}
        {mode !== 'physical' && <Field label="Online link" error={e.venueOnline?.message}><Input type="url" placeholder="https://" {...form.register('venueOnline')} /></Field>}
      </div>
      <Field label="Specialization areas" hint="Used to decide which practitioners' speciality requirement the points count towards.">
        <Controller
          control={form.control}
          name="specializationAreas"
          render={({ field }) => <MultiSelect options={ref?.specialities ?? []} value={field.value ?? []} onChange={(v) => field.onChange(v.map(Number))} />}
        />
      </Field>
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  );
}
