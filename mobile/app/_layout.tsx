import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '../src/state/session';
import { usePalette } from '../src/ui';

function Shell() {
  const palette = usePalette();
  return (
    <>
      <StatusBar style={palette.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="tenants" options={{ title: 'Choose a business' }} />
        <Stack.Screen name="change-pin" options={{ title: 'Change PIN' }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ title: 'Admin' }} />
        <Stack.Screen name="recipe" options={{ title: 'Recipe' }} />
        <Stack.Screen name="trends" options={{ title: 'Trends' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="sales-import" options={{ title: 'Import sales' }} />
        <Stack.Screen name="add-tenant" options={{ title: 'Add a business' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Restaurant wifi is unreliable; one quiet retry beats an error banner on a flaky request.
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
        },
      }),
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
