'use client';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button, Textarea, Field } from './ui';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  wide,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  trigger?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close aria-label="Close" className="rounded p-1 hover:bg-secondary"><X className="h-4 w-4" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation dialog, optionally asking for a reason. */
export function ConfirmButton({
  label,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'destructive',
  size = 'sm',
  reason,
  onConfirm,
}: {
  label: React.ReactNode;
  title: string;
  message?: string;
  confirmLabel?: string;
  variant?: 'destructive' | 'default' | 'outline';
  size?: 'sm' | 'default';
  reason?: string;
  onConfirm: (reason?: string) => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen} title={title} description={message} trigger={<Button variant={variant === 'destructive' ? 'outline' : variant} size={size}>{label}</Button>}>
      {reason && (
        <Field label={reason} required>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button
          variant={variant}
          loading={busy}
          disabled={!!reason && text.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason ? text.trim() : undefined);
              setOpen(false);
              setText('');
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
