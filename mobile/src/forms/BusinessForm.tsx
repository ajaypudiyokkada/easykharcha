import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { RequestOptions } from '../api/client';
import { BUSINESS_TYPES, type BusinessTypeValue } from '../constants/businessTypes';
import { EMPTY_LOCATION_DRAFT, PincodeLocationField } from './PincodeLocationField';
import { strings } from '../strings';
import { Body, Icon, TextField } from '../ui';
import { colours, fonts, radii, spacing, type } from '../theme/tokens';

const s1 = strings.setup.step1;

export type BusinessDraft = {
  name: string;
  businessType: BusinessTypeValue | '';
  city: string;
  pincode: string;
  state: string;
  manualLocation: boolean;
  tagline: string;
};

export const EMPTY_BUSINESS_DRAFT: BusinessDraft = {
  name: '',
  businessType: '',
  tagline: '',
  ...EMPTY_LOCATION_DRAFT,
};

type Props = {
  value: BusinessDraft;
  onChange: (patch: Partial<BusinessDraft>) => void;
  authedFetch: <T>(path: string, options?: RequestOptions) => Promise<T>;
  errors?: { name?: string; businessType?: string; city?: string };
};

/** The business fields shared by setup/1 and Settings' "Business details" screen — name, type,
 * city, tagline. No Save/Next button here — the caller owns that. */
export function BusinessForm({ value, onChange, authedFetch, errors }: Props) {
  return (
    <View style={styles.field}>
      <TextField
        label={s1.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={s1.namePlaceholder}
        autoComplete="organization"
        error={errors?.name}
      />

      <View style={styles.field}>
        <Body style={styles.label}>{s1.typeLabel}</Body>
        <View style={styles.typeGrid}>
          {BUSINESS_TYPES.map((option) => {
            const selected = value.businessType === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onChange({ businessType: option.value })}
                style={[styles.typeCard, selected ? styles.typeCardSelected : null]}
              >
                <Body style={[styles.typeCardText, selected ? styles.typeCardTextSelected : null]}>
                  {option.label}
                </Body>
                {selected ? <Icon name="success" size={18} colour={colours.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
        {errors?.businessType ? (
          <View style={styles.formError}>
            <Icon name="error" size={type.md} colour={colours.danger} />
            <Body style={styles.formErrorText}>{errors.businessType}</Body>
          </View>
        ) : null}
      </View>

      <PincodeLocationField
        value={value}
        onChange={onChange}
        authedFetch={authedFetch}
        error={errors?.city}
      />

      <TextField
        label={s1.taglineLabel}
        value={value.tagline}
        onChangeText={(tagline) => onChange({ tagline })}
        placeholder={s1.taglinePlaceholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  typeGrid: {
    gap: spacing.sm,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colours.card,
  },
  typeCardSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  typeCardText: {
    color: colours.text,
  },
  typeCardTextSelected: {
    fontFamily: fonts.bodyExtraBold,
  },
  formError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  formErrorText: {
    flex: 1,
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
});
