import type { PrintOptions } from './types.js';

/** Renders a plain-text receipt preview for mock mode — no DOM, no Node-only APIs, works anywhere. */
export function renderMockReceipt(job: PrintOptions): string {
  const lines = job.content.split('\n').filter((line) => line.length > 0);
  const width = Math.max(28, ...lines.map((line) => line.length)) + 4;
  const border = '─'.repeat(width);
  const pad = (line: string) => `│ ${line.padEnd(width - 2)} │`;

  return [
    `┌${border}┐`,
    pad('PORTIX MOCK PRINT PREVIEW'),
    `├${border}┤`,
    ...lines.map(pad),
    `├${border}┤`,
    pad(`copies: ${job.copies ?? 1}`),
    `└${border}┘`,
  ].join('\n');
}
