/** The Import invoice flow's progress, kept on the device (web `localStorage`, native `SecureStore`,
 * same split and try/catch as `invoices/draft.ts`) so a page reload (common on iOS when the camera
 * takes over) resumes instead of starting again: which import is in flight, the idempotency key for
 * its confirm (created once, reused by every retry), and the owner's review choices. Any storage
 * failure just means "nothing saved". */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { LineDecision } from '../api/invoiceImports';
import { newIdempotencyKey } from './draft';

export type ImportProgress = {
  importId: number;
  /** Idempotency key for the confirm call of THIS import. */
  key: string;
  saleDate: string | null;
  billNumber: string | null;
  decisions: Record<string, LineDecision>;
  addAnyway: boolean;
  acceptPartial: boolean;
};

export function newProgress(importId: number): ImportProgress {
  return {
    importId,
    key: newIdempotencyKey(),
    saleDate: null,
    billNumber: null,
    decisions: {},
    addAnyway: false,
    acceptPartial: false,
  };
}

function storageKey(businessId: number): string {
  return `easykharcha.invoice_import.${businessId}`;
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

export const importProgressStorage = {
  async load(businessId: number): Promise<ImportProgress | null> {
    try {
      const raw = await getItem(storageKey(businessId));
      if (!raw) return null;
      const p = JSON.parse(raw) as ImportProgress;
      if (typeof p?.importId !== 'number' || typeof p.key !== 'string') return null;
      return {
        importId: p.importId,
        key: p.key,
        saleDate: typeof p.saleDate === 'string' ? p.saleDate : null,
        billNumber: typeof p.billNumber === 'string' ? p.billNumber : null,
        decisions: p.decisions && typeof p.decisions === 'object' ? p.decisions : {},
        addAnyway: p.addAnyway === true,
        acceptPartial: p.acceptPartial === true,
      };
    } catch {
      return null;
    }
  },
  async save(businessId: number, progress: ImportProgress): Promise<void> {
    try {
      await setItem(storageKey(businessId), JSON.stringify(progress));
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
