import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Keeps a half-typed "add item" form across a browser refresh or back/forward during onboarding
 * — same storage split as screens/countDraftStorage.ts. Only the *unsaved* draft needs this: a
 * confirmed Add is already on the server the instant it succeeds (see hooks/useInstantAdd.ts), so
 * there's nothing else here to lose. */
function keyFor(scope: string): string {
  return `easykharcha.item_draft.${scope}`;
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

export const itemDraftStorage = {
  async load<T>(scope: string): Promise<T | null> {
    const raw = await getItem(keyFor(scope));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async save<T>(scope: string, draft: T): Promise<void> {
    await setItem(keyFor(scope), JSON.stringify(draft));
  },
  async clear(scope: string): Promise<void> {
    await removeItem(keyFor(scope));
  },
};
