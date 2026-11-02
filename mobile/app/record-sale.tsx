import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { RecordSalesSheet } from '../src/screens/RecordSalesSheet';
import { strings } from '../src/strings';
import { colours, fonts, radii, spacing, type } from '../src/theme/tokens';
import {
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  Screen,
  Sheet,
  Small,
  type IconName,
} from '../src/ui';
import { MIN_TOUCH_TARGET } from '../src/ui/constants';

const s = strings.saleHub;

type OptionKey = 'manual' | 'scan' | 'report' | 'invoice';

const OPTIONS: { key: OptionKey; icon: IconName }[] = [
  { key: 'manual', icon: 'sales' },
  { key: 'scan', icon: 'camera' },
  { key: 'report', icon: 'document' },
  { key: 'invoice', icon: 'invoice' },
];

export default function RecordSaleHub() {
  const router = useRouter();
  const { status, user, businesses } = useAuth();
  const params = useLocalSearchParams<{ returnTo?: string; date?: string }>();
  const returnsToSales = params.returnTo === 'sales';
  const backPath = returnsToSales ? '/sales' : '/home';
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [manualVisible, setManualVisible] = useState(false);
  const [comingSoonKey, setComingSoonKey] = useState<OptionKey | null>(null);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }

  const goBack = () => router.replace(backPath);

  if (!can(permissions, 'sales.create')) {
    return (
      <Screen>
        <HubHeader onBack={goBack} />
        <NoAccess />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.page}>
        <HubHeader onBack={goBack} />
        <Small style={styles.subtitle}>{s.subtitle}</Small>

        <View style={styles.options}>
          {OPTIONS.map((option) => {
            const copy = s.options[option.key];
            const comingSoon = option.key !== 'manual';
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={copy.title}
                style={styles.option}
                onPress={() => (comingSoon ? setComingSoonKey(option.key) : setManualVisible(true))}
              >
                <View style={styles.optionIcon}>
                  <Icon name={option.icon} size={type.lg} colour={colours.primary} />
                </View>
                <View style={styles.optionCopy}>
                  <View style={styles.titleRow}>
                    <Body style={styles.optionTitle}>{copy.title}</Body>
                    <View style={[styles.badge, comingSoon ? styles.badgeMuted : null]}>
                      <Small style={[styles.badgeText, comingSoon ? styles.badgeTextMuted : null]}>
                        {comingSoon ? s.comingSoonBadge : s.fastestBadge}
                      </Small>
                    </View>
                  </View>
                  <Small style={styles.optionDesc}>{copy.desc}</Small>
                </View>
                <Icon name="chevronRight" size={20} colour={colours.muted} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <RecordSalesSheet
        visible={manualVisible}
        onClose={() => setManualVisible(false)}
        initialDate={params.date}
        onSaved={() => {
          const saved =
            returnsToSales && params.date ? `saved=sales&date=${params.date}` : 'saved=sales';
          router.replace(`${backPath}?${saved}`);
        }}
      />

      <Sheet
        visible={comingSoonKey !== null}
        onClose={() => setComingSoonKey(null)}
        title={s.comingSoonBadge}
      >
        <Body style={styles.comingSoonMessage}>{s.comingSoonSheet.message}</Body>
        <View style={styles.comingSoonActions}>
          <Button
            label={s.comingSoonSheet.recordManually}
            variant="primary"
            onPress={() => {
              setComingSoonKey(null);
              setManualVisible(true);
            }}
          />
          <Button
            label={s.comingSoonSheet.close}
            variant="secondary"
            onPress={() => setComingSoonKey(null)}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function HubHeader({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backBtn}
      >
        <Icon name="back" size={22} colour={colours.text} />
      </Pressable>
      <Heading level={2}>{s.title}</Heading>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  page: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  subtitle: {
    color: colours.muted,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 84,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colours.card,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  optionTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  optionDesc: {
    color: colours.muted,
  },
  badge: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  badgeText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  badgeMuted: {
    backgroundColor: colours.background,
  },
  badgeTextMuted: {
    color: colours.muted,
  },
  comingSoonMessage: {
    marginBottom: spacing.lg,
  },
  comingSoonActions: {
    gap: spacing.sm,
  },
});
