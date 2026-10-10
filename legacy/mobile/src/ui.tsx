/**
 * Shared primitives. Cross-platform only (View/Text/TextInput/Pressable/ScrollView/FlatList), so the
 * same components compile to iOS and Android later with no rewrite.
 */
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';

import { useSession } from './state/session';
import { Palette, buildPalette, radius, severityColour, spacing, tap, useScheme } from './theme';

export function usePalette(): Palette {
  const scheme = useScheme();
  const { tenant } = useSession();
  return useMemo(
    () => buildPalette(scheme, tenant?.primary_colour, tenant?.accent_colour),
    [scheme, tenant?.primary_colour, tenant?.accent_colour],
  );
}

/** Caps content width so the mobile-web build does not stretch across a desktop monitor. */
export function Screen({
  children,
  scroll = true,
  refreshing,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
}) {
  const palette = usePalette();
  const inner = (
    <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, gap: spacing.md }}>
      {refreshing ? <ActivityIndicator color={palette.primary} /> : null}
      {children}
    </View>
  );
  if (!scroll) return <View style={{ flex: 1, backgroundColor: palette.bg }}>{inner}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}
      keyboardShouldPersistTaps="handled"
    >
      {inner}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return <Text style={{ fontSize: 22, fontWeight: '700', color: palette.text }}>{children}</Text>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return <Text style={{ fontSize: 16, fontWeight: '700', color: palette.text }}>{children}</Text>;
}

export function Body({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  const palette = usePalette();
  return (
    <Text style={{ fontSize: 15, lineHeight: 21, color: muted ? palette.textMuted : palette.text }}>
      {children}
    </Text>
  );
}

export function Caption({ children, tone }: { children: React.ReactNode; tone?: keyof Palette }) {
  const palette = usePalette();
  const colour = tone ? (palette[tone] as string) : palette.textMuted;
  return <Text style={{ fontSize: 13, color: colour }}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
}) {
  const palette = usePalette();
  const background =
    variant === 'primary'
      ? palette.primary
      : variant === 'danger'
        ? palette.danger
        : variant === 'secondary'
          ? palette.surfaceAlt
          : 'transparent';
  const colour =
    variant === 'primary' || variant === 'danger'
      ? palette.onPrimary
      : variant === 'ghost'
        ? palette.primary
        : palette.text;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        ...tap,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: background,
        borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
        borderColor: palette.border,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colour} />
      ) : (
        <Text style={{ color: colour, fontWeight: '600', fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  hint,
  autoFocus,
  maxLength,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'phone-pad' | 'number-pad';
  secureTextEntry?: boolean;
  hint?: string;
  autoFocus?: boolean;
  maxLength?: number;
  multiline?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textMuted }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textFaint}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoFocus={autoFocus}
        maxLength={maxLength}
        multiline={multiline}
        style={{
          minHeight: multiline ? 88 : tap.minHeight,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          backgroundColor: palette.surface,
          color: palette.text,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          fontSize: 16,
          ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : null),
        }}
      />
      {hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export function Picker<T extends string | number>({
  label,
  value,
  options,
  onChange,
  emptyLabel = 'None',
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  emptyLabel?: string;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textMuted }}>{label}</Text>
      {options.length === 0 ? (
        <Caption>{emptyLabel}</Caption>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 }}>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={String(option.value)}
                  onPress={() => onChange(option.value)}
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: spacing.lg,
                    borderRadius: radius.pill,
                    backgroundColor: selected ? palette.primary : palette.surfaceAlt,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: selected ? palette.primary : palette.border,
                  }}
                >
                  <Text style={{ color: selected ? palette.onPrimary : palette.text, fontWeight: '600' }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export function Banner({ alerts }: { alerts: { severity: string; code: string; message: string }[] }) {
  const palette = usePalette();
  if (!alerts?.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {alerts.slice(0, 6).map((alert, index) => (
        <View
          key={`${alert.code}-${index}`}
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: palette.surface,
            borderLeftWidth: 4,
            borderLeftColor: severityColour(palette, alert.severity),
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
          }}
        >
          <Text style={{ flex: 1, color: palette.text, fontSize: 14, lineHeight: 20 }}>{alert.message}</Text>
        </View>
      ))}
      {alerts.length > 6 ? <Caption>+{alerts.length - 6} more</Caption> : null}
    </View>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'danger' | 'success' | 'warning'; children: React.ReactNode }) {
  const palette = usePalette();
  const colour = palette[tone];
  return (
    <View
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colour,
        backgroundColor: palette.surface,
      }}
    >
      <Text style={{ color: colour, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Row({ left, right, onPress }: { left: React.ReactNode; right?: React.ReactNode; onPress?: () => void }) {
  const palette = usePalette();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border,
      }}
    >
      <View style={{ flex: 1 }}>{left}</View>
      {right ? <View>{right}</View> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

/** A horizontally scrollable table. Mobile screens are narrow; a report has many columns. */
export function Table({
  columns,
  rows,
}: {
  columns: { key: string; label: string; width?: number; align?: 'left' | 'right' }[];
  rows: Record<string, React.ReactNode>[];
}) {
  const palette = usePalette();
  if (!rows.length) return <Caption>Nothing to show for this range.</Caption>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: palette.border, paddingBottom: spacing.sm }}>
          {columns.map((column) => (
            <Text
              key={column.key}
              style={{
                width: column.width ?? 110,
                fontSize: 12,
                fontWeight: '700',
                color: palette.textMuted,
                textAlign: column.align ?? 'left',
                paddingHorizontal: spacing.xs,
              }}
            >
              {column.label}
            </Text>
          ))}
        </View>
        {rows.map((row, index) => (
          <View
            key={index}
            style={{
              flexDirection: 'row',
              paddingVertical: spacing.sm,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.border,
              backgroundColor: index % 2 ? palette.surfaceAlt : 'transparent',
            }}
          >
            {columns.map((column) => (
              <View key={column.key} style={{ width: column.width ?? 110, paddingHorizontal: spacing.xs }}>
                {typeof row[column.key] === 'string' || typeof row[column.key] === 'number' ? (
                  <Text
                    style={{ fontSize: 13, color: palette.text, textAlign: column.align ?? 'left' }}
                    numberOfLines={2}
                  >
                    {row[column.key]}
                  </Text>
                ) : (
                  row[column.key]
                )}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' | 'warning' }) {
  const palette = usePalette();
  return (
    <View style={{ flex: 1, minWidth: 120, gap: 2 }}>
      <Text style={{ fontSize: 12, color: palette.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '700', color: tone ? palette[tone] : palette.text }}>{value}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const palette = usePalette();
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
      <ActivityIndicator color={palette.primary} />
      <Caption>{label}</Caption>
    </View>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <Notice tone="danger">{message}</Notice>;
}

export const money = (value: unknown) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const pct = (value: unknown) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`);

export const qty = (value: unknown, unit?: string) =>
  value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;

export const today = () => new Date().toISOString().slice(0, 10);
