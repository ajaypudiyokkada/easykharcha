/** The in-progress Create invoice form, kept on the device so a page reload (iOS PWAs reload when
 * the camera or another app takes over) doesn't lose it. Same platform split and try/catch pattern as
 * `screens/ekSetupStore.ts`: web `localStorage`, native `SecureStore`; any storage failure just means
 * "no draft", never an error on screen.
 *
 * `key` is the idempotency key for this draft: made when the draft starts and kept until the invoice
 * is created or the draft is cancelled, so every retry sends the same key. */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { PaymentModeKey } from '../api/invoices';

const MODES: string[] = ['cash', 'upi', 'card', 'bank_transfer'];

export type InvoiceLineDraft = {
  sellItemId: number;
  name: string;
  /** Whole units, as text. */
  quantity: string;
  /** Rupees, as typed (e.g. "220" or "220.50"). */
  rate: string;
};

export type InvoiceDraft = {
  key: string;
  date: string;
  phone: string;
  name: string;
  lines: InvoiceLineDraft[];
  step: 'form' | 'review';
  /** Payment chosen on the form: Unpaid by default; Paid needs a mode, and a proof photo (its id,
   * already uploaded) for every mode except Cash. */
  paid: boolean;
  mode: PaymentModeKey | '';
  proofId: number | null;
};

export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const rand = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rand()}-${rand()}-${rand()}`;
}

export function emptyDraft(date: string): InvoiceDraft {
  return {
    key: newIdempotencyKey(),
    date,
    phone: '',
    name: '',
    lines: [],
    step: 'form',
    paid: false,
    mode: '',
    proofId: null,
  };
}

function storageKey(businessId: number): string {
  return `easykharcha.invoice_draft.${businessId}`;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function isDraft(value: unknown): value is InvoiceDraft {
  const d = value as InvoiceDraft | null;
  return (
    !!d &&
    typeof d.key === 'string' &&
    typeof d.date === 'string' &&
    typeof d.phone === 'string' &&
    typeof d.name === 'string' &&
    Array.isArray(d.lines) &&
    d.lines.every(
      (l) =>
        typeof l?.sellItemId === 'number' &&
        typeof l.name === 'string' &&
        typeof l.quantity === 'string' &&
        typeof l.rate === 'string',
    )
  );
}

export const invoiceDraftStorage = {
  async load(businessId: number): Promise<InvoiceDraft | null> {
    try {
      const raw = await getItem(storageKey(businessId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isDraft(parsed)
        ? {
            ...parsed,
            step: parsed.step === 'review' ? 'review' : 'form',
            // Drafts saved before payments existed have none of these.
            paid: parsed.paid === true,
            mode: MODES.includes(parsed.mode) ? parsed.mode : '',
            proofId: typeof parsed.proofId === 'number' ? parsed.proofId : null,
          }
        : null;
    } catch {
      return null;
    }
  },
  async save(businessId: number, draft: InvoiceDraft): Promise<void> {
    try {
      await setItem(storageKey(businessId), JSON.stringify(draft));
    } catch {
      // Best effort only.
    }
  },
  async clear(businessId: number): Promise<void> {
    try {
      await removeItem(storageKey(businessId));
    } catch {
      // Best effort only.
    }
  },
};
