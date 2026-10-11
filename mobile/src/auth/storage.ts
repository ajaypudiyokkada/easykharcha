import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'easykharcha.access';
const REFRESH_KEY = 'easykharcha.refresh';

/**
 * Where tokens persist between app launches: `localStorage` on web, the OS keychain/keystore
 * (expo-secure-store) on native — never plain `AsyncStorage`, which is unencrypted on disk. The
 * in-memory copy that actually drives requests lives in AuthContext; this module only persists it.
 */
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

export const tokenStorage = {
  async load(): Promise<{ access: string | null; refresh: string | null }> {
    const [access, refresh] = await Promise.all([getItem(ACCESS_KEY), getItem(REFRESH_KEY)]);
    return { access, refresh };
  },
  async save(access: string, refresh: string): Promise<void> {
    await Promise.all([setItem(ACCESS_KEY, access), setItem(REFRESH_KEY, refresh)]);
  },
  async clear(): Promise<void> {
    await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY)]);
  },
};
