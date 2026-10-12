import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { CountLineState, CountType } from '../api/counts';

export type CountDraftLine = {
  stockItem: number;
  state: CountLineState;
  countedQty: string;
};

export type CountDraft = {
  businessId: number;
  countType: CountType;
  lines: CountDraftLine[];
};

function keyFor(businessId: number, countType: CountType): string {
  return `easykharcha.count_draft.${businessId}.${countType}`;
}

/** Keeps an in-progress blind count on the device so an interrupted session (a call, a closed tab)
 * can resume — same platform split as auth/storage.ts's tokenStorage: localStorage on web, the OS
 * keychain on native. A count draft has no secrets in it, but reusing the same small storage
 * primitive already proven in this codebase is simpler than adding a new dependency for it. */
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

export const countDraftStorage = {
  async load(businessId: number, countType: CountType): Promise<CountDraft | null> {
    const raw = await getItem(keyFor(businessId, countType));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CountDraft;
    } catch {
      return null;
    }
  },
  async save(draft: CountDraft): Promise<void> {
    await setItem(keyFor(draft.businessId, draft.countType), JSON.stringify(draft));
  },
  async clear(businessId: number, countType: CountType): Promise<void> {
    await removeItem(keyFor(businessId, countType));
  },
};
