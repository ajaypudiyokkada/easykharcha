import { Platform } from 'react-native';

// expo-router's web Stack never does a full navigation between screens, so the browser's own
// "check sw.js for an update on navigation" never fires for someone who just leaves the app open —
// this interval (and the visibility listener below) are what catch a deploy during a long session.
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Production web builds only — `__DEV__` is false in the exported static build (npm run build:web)
 * and true under the Expo dev server, so this never registers while developing. */
export function registerServiceWorker(onUpdateAvailable: () => void): void {
  if (__DEV__ || Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // "installed" while a controller already exists means this is a *new* version replacing
          // one already running — not the very first install, which has no controller yet.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateAvailable();
          }
        });
      });

      const checkForUpdate = () => registration.update().catch(() => {});
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
      }
    })
    .catch(() => {
      // A failed registration shouldn't break the app — it just means no offline shell this visit.
    });
}
