import type { Response } from 'express';

export const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  txt: 'text/plain; charset=utf-8',
};

export function sendFile(res: Response, body: Buffer | string, type: string, filename: string, inline = false) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(body);
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
}
