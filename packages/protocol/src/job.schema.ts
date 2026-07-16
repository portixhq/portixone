import { z } from 'zod';
import { PRINT_TARGETS, type PrintTarget } from './printer-target.types.js';

/**
 * Upper bounds on a single print job. A real receipt is a few KB of text and
 * never needs thousands of copies, so these are guardrails — not functional
 * limits — against a buggy or abusive caller monopolizing the single-worker
 * queue or spewing paper (e.g. an app that loops and sends `copies: 1000000`).
 * The 5 MB HTTP body cap (protocol.adapter.ts) is the outer memory bound;
 * these are the print-semantics bound layered on top.
 */
export const MAX_CONTENT_LENGTH = 100_000;
export const MAX_COPIES = 100;

export const printJobSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  // Cast keeps zod's tuple signature happy while preserving PrintTarget through to PrintJobInput —
  // a plain `string` here would silently widen the type everywhere downstream.
  target: z.enum([...PRINT_TARGETS] as [PrintTarget, ...PrintTarget[]]).optional(),
  printerName: z.string().min(1).optional(),
  copies: z.number().int().positive().max(MAX_COPIES).optional(),
});

export type PrintJobInput = z.infer<typeof printJobSchema>;
