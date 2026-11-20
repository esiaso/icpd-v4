'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/**
 * Camera QR scanner for token cards (mobile-first). Calls onResult with the decoded text.
 * Token cards encode the activity claim URL; the token itself is typed or scanned from the
 * printed barcode text.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let controls: { stop: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromVideoDevice(undefined, video.current!, (res) => {
          if (res && !cancelled) {
            cancelled = true;
            controls?.stop();
            onResult(res.getText());
          }
        });
      } catch (e: any) {
        setError(e?.message?.includes('Permission') ? 'Camera permission was denied.' : 'Could not start the camera on this device.');
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onResult]);
  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : <video ref={video} className="aspect-square w-full max-w-sm rounded-md bg-black object-cover" muted playsInline />}
      <Button variant="outline" size="sm" onClick={onClose}>Close camera</Button>
    </div>
  );
}
