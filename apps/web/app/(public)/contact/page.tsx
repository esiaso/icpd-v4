'use client';
import { useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Card, CardContent, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

const schema = z.object({
  name: z.string().min(2, 'Required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  subject: z.string().min(2, 'Required'),
  message: z.string().min(5, 'Please write a little more'),
  website: z.string().max(0).optional(),
});

export default function ContactPage() {
  const [sent, setSent] = useState<string | null>(null);
  const form = useZodForm<z.infer<typeof schema>>(schema);
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await post('/public/contact', v);
      setSent(r.message);
      form.reset();
    } catch (err) {
      applyApiError(form, err);
    }
  });
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Contact us" description="Questions about CPD points, providers or your account." />
      {sent && <Alert variant="success" className="mb-4">{sent}</Alert>}
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" error={e.name?.message} required><Input {...form.register('name')} /></Field>
              <Field label="Phone"><Input type="tel" {...form.register('phone')} /></Field>
            </div>
            <Field label="Email" error={e.email?.message} required><Input type="email" {...form.register('email')} /></Field>
            <Field label="Subject" error={e.subject?.message} required><Input {...form.register('subject')} /></Field>
            <Field label="Message" error={e.message?.message} required><Textarea rows={6} {...form.register('message')} /></Field>
            <input type="text" tabIndex={-1} aria-hidden className="hidden" {...form.register('website')} />
            <Button type="submit" loading={form.formState.isSubmitting}>Send message</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
