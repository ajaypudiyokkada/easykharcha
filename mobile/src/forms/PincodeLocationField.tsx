import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, type RequestOptions } from '../api/client';
import type { PincodeLookup } from '../api/geo';
import { INDIA_STATES } from '../constants/indiaStates';
import { strings } from '../strings';
import { Banner, Body, Icon, Sheet, Small, TextField } from '../ui';
import { colours, fonts, radii, spacing, type } from '../theme/tokens';

const s1 = strings.setup.step1;

export type LocationDraft = {
  pincode: string;
  city: string;
  state: string;
  /** Write-only on the API, never shown as a field of its own — true once the Owner has gone
   * through "Enter city yourself", so Business create/update skips the pincode/city/state check. */
  manualLocation: boolean;
};

export const EMPTY_LOCATION_DRAFT: LocationDraft = {
  pincode: '',
  city: '',
  state: '',
  manualLocation: false,
};

type Status = 'idle' | 'loading' | 'found' | 'notfound' | 'error';

type Props = {
  value: LocationDraft;
  onChange: (patch: Partial<LocationDraft>) => void;
  authedFetch: <T>(path: string, options?: RequestOptions) => Promise<T>;
  /** "Please choose a city" — surfaced once Next/Save is pressed with no city picked yet. */
  error?: string;
};

/**
 * Country (fixed "India") + Pincode lookup -> State (read-only) + City (the pincode's district(s),
 * first one preselected) + an optional searchable Area picker. Falls back to a free-text City and a
 * State picker ("Enter city yourself") when the pincode isn't found, which also sets
 * `manualLocation` so the server doesn't try to re-check it against the pincode table. Used by
 * BusinessForm — setup step 1 and Settings' Business profile — in place of the old free-text City.
 */
export function PincodeLocationField({ value, onChange, authedFetch, error }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [lookup, setLookup] = useState<PincodeLookup | null>(null);
  const [area, setArea] = useState('');
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  // An existing business saved before this field existed has a city but no pincode — shown as a
  // plain summary with a prompt, not an empty pincode box demanding one, until the Owner opts in.
  const [addingPincode, setAddingPincode] = useState(false);
  const latestPincode = useRef(value.pincode);
  latestPincode.current = value.pincode;

  useEffect(() => {
    if (value.manualLocation || value.pincode.length !== 6) return;
    setStatus('loading');
    const timer = setTimeout(() => {
      lookupPincode(value.pincode);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.pincode, value.manualLocation]);

  async function lookupPincode(code: string, attempt = 0): Promise<void> {
    try {
      const result = await authedFetch<PincodeLookup>(`/geo/pincode/${code}/`);
      if (latestPincode.current !== code) return;
      setLookup(result);
      setStatus('found');
      // A reload (existing business) already has a valid city — keep it instead of jumping to the
      // first district every time the field remounts.
      const cityStillValid =
        value.city && (result.districts.includes(value.city) || result.areas.includes(value.city));
      onChange({ state: result.state, city: cityStillValid ? value.city : result.districts[0] });
    } catch (err) {
      if (latestPincode.current !== code) return;
      if (err instanceof ApiError && err.status === 404) {
        setLookup(null);
        setStatus('notfound');
        return;
      }
      if (
        err instanceof ApiError &&
        (err.kind === 'network' || err.kind === 'timeout') &&
        attempt === 0
      ) {
        await lookupPincode(code, 1);
        return;
      }
      setLookup(null);
      setStatus('error');
    }
  }

  function handlePincodeChange(text: string) {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 6);
    setLookup(null);
    setArea('');
    setStatus(digits.length === 6 ? 'loading' : 'idle');
    onChange({ pincode: digits, city: '', state: '', manualLocation: false });
  }

  function enterManually() {
    setStatus('idle');
    setLookup(null);
    onChange({ manualLocation: true, city: '', state: '' });
  }

  if (!addingPincode && !value.pincode && value.city) {
    return (
      <View style={styles.summaryRow}>
        <View style={styles.summaryCopy}>
          <Small style={styles.label}>{s1.cityLabel}</Small>
          <Body>{value.city}</Body>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setAddingPincode(true)} hitSlop={8}>
          <Small style={styles.linkText}>{s1.addPincode}</Small>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.field}>
      <TextField
        label={s1.countryLabel}
        value={s1.countryValue}
        onChangeText={() => {}}
        editable={false}
      />

      <TextField
        label={s1.pincodeLabel}
        value={value.pincode}
        onChangeText={handlePincodeChange}
        placeholder={s1.pincodePlaceholder}
        keyboardType="number-pad"
        maxLength={6}
        right={
          status === 'loading' ? <ActivityIndicator size="small" color={colours.primary} /> : null
        }
      />

      {status === 'notfound' ? (
        <View style={styles.statusBlock}>
          <Banner kind="error">{s1.pincodeNotFound}</Banner>
          <Pressable accessibilityRole="button" onPress={enterManually} hitSlop={8}>
            <Small style={styles.linkText}>{s1.enterCityYourself}</Small>
          </Pressable>
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.statusBlock}>
          <Banner kind="error">{s1.pincodeLookupError}</Banner>
          <Pressable
            accessibilityRole="button"
            onPress={() => lookupPincode(value.pincode)}
            hitSlop={8}
          >
            <Small style={styles.linkText}>{s1.tryAgain}</Small>
          </Pressable>
        </View>
      ) : null}

      {status === 'found' && lookup ? (
        <>
          <View style={styles.field}>
            <Small style={styles.label}>{s1.stateLabel}</Small>
            <View style={styles.stateChip}>
              <Small style={styles.stateChipText}>{value.state}</Small>
            </View>
          </View>

          <View style={styles.field}>
            <Small style={styles.label}>{s1.cityLabel}</Small>
            <View style={styles.chipGrid}>
              {lookup.districts.map((district) => {
                const selected = value.city === district;
                return (
                  <Pressable
                    key={district}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onChange({ city: district })}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                  >
                    <Small style={selected ? styles.chipTextSelected : styles.chipText}>
                      {district}
                    </Small>
                  </Pressable>
                );
              })}
            </View>
            {error ? (
              <View style={styles.formError}>
                <Icon name="error" size={type.md} colour={colours.danger} />
                <Small style={styles.errorText}>{error}</Small>
              </View>
            ) : null}
          </View>

          {lookup.areas.length > 0 ? (
            <View style={styles.field}>
              <Small style={styles.label}>{s1.areaLabel}</Small>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s1.areaLabel}
                onPress={() => setAreaPickerOpen(true)}
                style={styles.pickerTrigger}
              >
                <Small style={area ? styles.pickerTriggerText : styles.pickerTriggerPlaceholder}>
                  {area || s1.areaPlaceholder}
                </Small>
                <Icon name="chevronDown" size={18} colour={colours.muted} />
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      {value.manualLocation ? (
        <>
          <View style={styles.field}>
            <Small style={styles.label}>{s1.stateLabel}</Small>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s1.stateLabel}
              onPress={() => setStatePickerOpen(true)}
              style={styles.pickerTrigger}
            >
              <Small
                style={value.state ? styles.pickerTriggerText : styles.pickerTriggerPlaceholder}
              >
                {value.state || s1.statePlaceholder}
              </Small>
              <Icon name="chevronDown" size={18} colour={colours.muted} />
            </Pressable>
          </View>

          <TextField
            label={s1.cityLabel}
            value={value.city}
            onChangeText={(city) => onChange({ city })}
            placeholder={s1.cityPlaceholder}
            error={error}
          />
        </>
      ) : null}

      <OptionPickerSheet
        visible={areaPickerOpen}
        title={s1.areaLabel}
        options={lookup?.areas ?? []}
        selected={area}
        onSelect={setArea}
        onClose={() => setAreaPickerOpen(false)}
      />
      <OptionPickerSheet
        visible={statePickerOpen}
        title={s1.stateLabel}
        options={INDIA_STATES}
        selected={value.state}
        onSelect={(state) => onChange({ state })}
        onClose={() => setStatePickerOpen(false)}
      />
    </View>
  );
}

const SEARCH_THRESHOLD = 8;

function OptionPickerSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (option: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const filtered = term ? options.filter((option) => option.toLowerCase().includes(term)) : options;

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.pickerSheet}>
        {options.length > SEARCH_THRESHOLD ? (
          <TextField
            label={s1.searchLabel}
            value={search}
            onChangeText={setSearch}
            placeholder={s1.searchPlaceholder}
          />
        ) : null}
        {filtered.length === 0 ? (
          <Small style={styles.emptyText}>{s1.noMatches}</Small>
        ) : (
          filtered.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: option === selected }}
              onPress={() => {
                onSelect(option);
                onClose();
              }}
              style={styles.pickerRow}
            >
              <Small
                style={option === selected ? styles.pickerRowTextSelected : styles.pickerRowText}
              >
                {option}
              </Small>
              {option === selected ? (
                <Icon name="success" size={18} colour={colours.primary} />
              ) : null}
            </Pressable>
          ))
        )}
      </View>
    </Sheet>
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
  statusBlock: {
    gap: spacing.sm,
  },
  linkText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  chipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  chipText: {
    color: colours.text,
  },
  chipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  stateChip: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  stateChipText: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  pickerTrigger: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    backgroundColor: colours.card,
  },
  pickerTriggerText: {
    color: colours.text,
  },
  pickerTriggerPlaceholder: {
    color: colours.muted,
  },
  pickerSheet: {
    gap: spacing.sm,
  },
  pickerRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  pickerRowText: {
    color: colours.text,
  },
  pickerRowTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  emptyText: {
    color: colours.muted,
  },
  formError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryCopy: {
    gap: 2,
  },
});
