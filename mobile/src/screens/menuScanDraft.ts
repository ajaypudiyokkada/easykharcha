import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type MenuScanReturnTo = 'onboarding' | 'settings';

export type MenuScanDraft = {
  businessId: number;
  scanId: number;
  returnTo: MenuScanReturnTo;
};

function keyFor(businessId: number): string {
  return `easykharcha.menu_scan_draft.${businessId}`;
}

/** Keeps the in-progress scan's id on the device so leaving the Analyzing screen (a reload, the
 * back button, closing the tab) and coming back resumes polling the same scan instead of starting
 * a new one — same platform split as countDraftStorage.ts. */
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

export const menuScanDraft = {
  async load(businessId: number): Promise<MenuScanDraft | null> {
    const raw = await getItem(keyFor(businessId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MenuScanDraft;
    } catch {
      return null;
    }
  },
  async save(draft: MenuScanDraft): Promise<void> {
    await setItem(keyFor(draft.businessId), JSON.stringify(draft));
  },
  async clear(businessId: number): Promise<void> {
    await removeItem(keyFor(businessId));
  },
};
