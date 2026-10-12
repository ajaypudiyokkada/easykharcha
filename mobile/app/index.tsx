import { Redirect } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { nextRouteAfterAuth } from '../src/business/routing';
import { links } from '../src/config';
import { useOnlineStatus } from '../src/hooks/useOnlineStatus';
import { strings } from '../src/strings';
import { OfflineRetry } from '../src/ui';
import { colours } from '../src/theme/tokens';

const s = strings.app.landingOffline;

function goToLanding() {
  window.location.href = links.landingUrl;
}

/**
 * The real landing route: never a screen of its own, just a dispatcher to wherever a visitor
 * actually belongs. On web, a signed-out visitor is sent to the public marketing site — a full page
 * navigation out of the app, not a route inside it — since that's the public front door; native has
 * no landing page, so it still goes straight to /login. `status === 'offline'` is intercepted by the
 * root layout before this ever renders — see app/_layout.tsx's RootShell.
 */
export default function Index() {
  const { status, businesses } = useAuth();
  const online = useOnlineStatus();
  // Guards against firing the navigation more than once — `window.location.href` doesn't halt JS
  // execution immediately, so without this a re-render in that brief window could re-trigger it.
  const redirected = useRef(false);

  useEffect(() => {
    if (status !== 'signedOut' || Platform.OS !== 'web' || !online || redirected.current) return;
    redirected.current = true;
    goToLanding();
  }, [status, online]);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }

  if (status === 'signedOut') {
    if (Platform.OS !== 'web') {
      return <Redirect href="/login" />;
    }
    if (!online) {
      // Attempting the navigation anyway would just hand the browser off to its own "can't reach
      // this page" error, losing the app's offline UI entirely — show our own retry screen instead.
      // Guard `onRetry` on `online` too: a stale tap registered just before the device actually
      // went offline must not still fire the same dead navigation.
      return (
        <OfflineRetry
          title={s.title}
          body={s.body}
          retryLabel={s.retry}
          onRetry={() => {
            if (!online) return;
            redirected.current = false;
            goToLanding();
          }}
        />
      );
    }
    // The effect above is sending the browser to the landing page — show the loading screen
    // meanwhile so there's no flash of anything else while that navigation is in flight.
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }

  return <Redirect href={nextRouteAfterAuth(businesses)} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
});
