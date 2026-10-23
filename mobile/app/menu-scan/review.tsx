import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { RowError } from '../../src/api/client';
import { ApiError } from '../../src/api/client';
import type {
  ExtractedDish,
  ExtractedSection,
  MenuScanCreateResponse,
  MenuScanDetail,
} from '../../src/api/menuScan';
import type { SellItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { pickFiles } from '../../src/forms/filePicker';
import { resizeImageForUpload } from '../../src/forms/menuFileValidation';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import {
  Banner,
  Body,
  Button,
  Checkbox,
  GroupedList,
  Heading,
  Icon,
  ReadError,
  Screen,
  Sheet,
  Small,
  SkeletonList,
  TextField,
} from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';

const sr = strings.menuScan.review;
const sd = strings.dishForm;

type DishRow = {
  id: string;
  name: string;
  price: string;
  ticked: boolean;
  kind: ExtractedDish['kind'];
  confidence: number;
  note: string;
  variants: string[];
  error?: string;
};

type SectionRow = {
  id: string;
  name: string;
  dishes: DishRow[];
};

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `row-${idSeq}`;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sectionsFromScan(sections: ExtractedSection[]): {
  sections: SectionRow[];
  skipped: number;
} {
  let skipped = 0;
  const rows = sections.map((section) => ({
    id: nextId(),
    name: section.name,
    dishes: section.dishes
      .filter((dish) => {
        if (dish.existing) skipped += 1;
        return !dish.existing;
      })
      .map((dish) => ({
        id: nextId(),
        name: dish.name,
        price: dish.price != null ? String(dish.price) : '',
        ticked: dish.kind !== 'addon',
        kind: dish.kind,
        confidence: dish.confidence,
        note: dish.note,
        variants: dish.variants,
      })),
  }));
  return { sections: rows.filter((section) => section.dishes.length > 0), skipped };
}

export default function MenuScanReview() {
  const router = useRouter();
  const { status, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{
    businessId?: string;
    scanId?: string;
    returnTo?: string;
  }>();
  const returnTo = params.returnTo === 'settings' ? 'settings' : 'onboarding';
  const business = businesses.find((b) => String(b.id) === params.businessId) ?? businesses[0];

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [incomplete, setIncomplete] = useState(false);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<SectionRow | null>(null);
  const [renameText, setRenameText] = useState('');
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = React.useCallback(() => {
    if (!business || !params.scanId) return;
    setLoading(true);
    setLoadFailed(false);
    authedFetch<MenuScanDetail>(`/businesses/${business.id}/ai/menu-scans/${params.scanId}/`)
      .then((detail) => {
        const built = sectionsFromScan(detail.sections ?? []);
        setSections(built.sections);
        setSkippedCount(built.skipped);
        setIncomplete(Boolean(detail.incomplete));
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [business, params.scanId, authedFetch]);

  useEffect(() => {
    load();
    // Fetches once for the scan this screen is reviewing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, params.scanId]);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }
  if (!business || !params.scanId) {
    return <Redirect href="/home" />;
  }

  const sector = sectorCopyFor(business.business_type);
  const backPath = returnTo === 'settings' ? '/settings/sell' : '/setup/4';

  function updateDish(sectionId: string, dishId: string, patch: Partial<DishRow>) {
    setSections((current) =>
      current.map((section) =>
        section.id !== sectionId
          ? section
          : {
              ...section,
              dishes: section.dishes.map((dish) =>
                dish.id !== dishId ? dish : { ...dish, ...patch },
              ),
            },
      ),
    );
  }

  function removeDish(sectionId: string, dishId: string) {
    setSections((current) =>
      current
        .map((section) =>
          section.id !== sectionId
            ? section
            : { ...section, dishes: section.dishes.filter((dish) => dish.id !== dishId) },
        )
        .filter((section) => section.dishes.length > 0),
    );
  }

  function toggleSection(sectionId: string, ticked: boolean) {
    setSections((current) =>
      current.map((section) =>
        section.id !== sectionId
          ? section
          : { ...section, dishes: section.dishes.map((dish) => ({ ...dish, ticked })) },
      ),
    );
  }

  function addBlankDish() {
    setSections((current) => {
      if (current.length === 0) {
        return [{ id: nextId(), name: sr.untitledSection, dishes: [newBlankDish()] }];
      }
      const [first, ...rest] = current;
      return [{ ...first, dishes: [newBlankDish(), ...first.dishes] }, ...rest];
    });
  }

  function newBlankDish(): DishRow {
    return {
      id: nextId(),
      name: '',
      price: '',
      ticked: true,
      kind: 'dish',
      confidence: 1,
      note: '',
      variants: [],
    };
  }

  function openRename(section: SectionRow) {
    setRenaming(section);
    setRenameText(section.name);
  }

  function saveRename() {
    if (!renaming) return;
    const name = renameText.trim() || renaming.name;
    setSections((current) =>
      current.map((section) => (section.id === renaming.id ? { ...section, name } : section)),
    );
    setRenaming(null);
  }

  async function handleAddAnotherPhoto() {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    if (files.length === 0 || !business) return;
    setAddingPhoto(true);
    try {
      const resized = await Promise.all(files.slice(0, 6).map(resizeImageForUpload));
      const formData = new FormData();
      for (const file of resized) formData.append('images', file, file.name);
      const scan = await authedFetch<MenuScanCreateResponse>(
        `/businesses/${business.id}/ai/menu-scans/`,
        { method: 'POST', body: formData },
      );
      const detail = await pollScan(business.id, scan.id);
      mergeScan(detail);
    } catch {
      setSubmitError(sr.errors.generic);
    } finally {
      setAddingPhoto(false);
    }
  }

  async function pollScan(businessId: number, scanId: number): Promise<MenuScanDetail> {
    for (;;) {
      const detail = await authedFetch<MenuScanDetail>(
        `/businesses/${businessId}/ai/menu-scans/${scanId}/`,
      );
      if (detail.status === 'done' || detail.status === 'failed') return detail;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  function mergeScan(detail: MenuScanDetail) {
    if (detail.status !== 'done') return;
    const existingNames = new Set<string>();
    for (const section of sections) {
      for (const dish of section.dishes) existingNames.add(normaliseName(dish.name));
    }
    setSections((current) => {
      const byName = new Map(current.map((section) => [section.name, section]));
      const order = current.map((section) => section.name);
      for (const incoming of detail.sections ?? []) {
        for (const dish of incoming.dishes) {
          const key = normaliseName(dish.name);
          if (dish.existing || existingNames.has(key)) continue;
          existingNames.add(key);
          const row: DishRow = {
            id: nextId(),
            name: dish.name,
            price: dish.price != null ? String(dish.price) : '',
            ticked: dish.kind !== 'addon',
            kind: dish.kind,
            confidence: dish.confidence,
            note: dish.note,
            variants: dish.variants,
          };
          const target = byName.get(incoming.name);
          if (target) {
            target.dishes = [...target.dishes, row];
          } else {
            const created = { id: nextId(), name: incoming.name, dishes: [row] };
            byName.set(incoming.name, created);
            order.push(incoming.name);
          }
        }
      }
      return order.map((name) => byName.get(name)).filter((s): s is SectionRow => Boolean(s));
    });
    if (detail.incomplete) setIncomplete(true);
  }

  async function handleSave() {
    const rows: { section: SectionRow; dish: DishRow }[] = [];
    for (const section of sections) {
      for (const dish of section.dishes) {
        if (dish.ticked) rows.push({ section, dish });
      }
    }
    setSubmitError(null);
    setSections((current) =>
      current.map((section) => ({
        ...section,
        dishes: section.dishes.map((dish) => ({ ...dish, error: undefined })),
      })),
    );
    if (rows.length === 0) {
      setSubmitError(sr.errors.minimumOne);
      return;
    }
    const nameErrors: Record<string, string> = {};
    for (const { dish } of rows) {
      if (!dish.name.trim()) nameErrors[dish.id] = sr.errors.nameRequired;
      else if (!dish.price.trim()) nameErrors[dish.id] = sr.errors.priceRequired;
    }
    if (Object.keys(nameErrors).length > 0) {
      setSections((current) =>
        current.map((section) => ({
          ...section,
          dishes: section.dishes.map((dish) => ({ ...dish, error: nameErrors[dish.id] })),
        })),
      );
      setSubmitError(sr.errors.generic);
      return;
    }

    setSaving(true);
    try {
      const items = rows.map(({ section, dish }) => ({
        name: dish.name.trim(),
        selling_price: dish.price.trim(),
        group: section.name,
      }));
      const created = await authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/bulk/`, {
        method: 'POST',
        body: { items, skip_existing: true },
      });
      router.replace(
        `/menu-scan/done?businessId=${business.id}&returnTo=${returnTo}&count=${created.length}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.rowErrors) {
        applyRowErrors(rows, err.rowErrors);
        setSubmitError(sr.errors.generic);
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setSubmitError(sr.errors.network);
      } else {
        setSubmitError(sr.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  function applyRowErrors(rows: { section: SectionRow; dish: DishRow }[], rowErrors: RowError[]) {
    const errorsByDishId: Record<string, string> = {};
    for (const err of rowErrors) {
      const target = rows[err.row - 1];
      if (target) errorsByDishId[target.dish.id] = err.message;
    }
    setSections((current) =>
      current.map((section) => ({
        ...section,
        dishes: section.dishes.map((dish) => ({ ...dish, error: errorsByDishId[dish.id] })),
      })),
    );
  }

  const matchesSearch = (dish: DishRow) =>
    !search.trim() || dish.name.toLowerCase().includes(search.trim().toLowerCase());
  const visibleSections = sections
    .map((section) => ({ ...section, dishes: section.dishes.filter(matchesSearch) }))
    .filter((section) => section.dishes.length > 0);
  const groups = visibleSections.map((section) => ({ group: section.name, items: section.dishes }));
  const sectionById = new Map(sections.map((section) => [section.name, section]));

  const tickedCount = sections.reduce(
    (sum, section) => sum + section.dishes.filter((dish) => dish.ticked).length,
    0,
  );

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={6} height={64} />
      </Screen>
    );
  }
  if (loadFailed) {
    return (
      <Screen>
        <ReadError onRetry={load} loading={loading} />
      </Screen>
    );
  }

  return (
    <Screen
      bottomBar={
        <View style={styles.bottomBar}>
          <Button
            label={sr.addSelected(tickedCount, sector.sellNounPlural)}
            onPress={handleSave}
            loading={saving}
            disabled={tickedCount === 0}
          />
          <Pressable
            accessibilityRole="link"
            onPress={() => router.replace(backPath)}
            style={styles.backLink}
          >
            <Small style={styles.backLinkText}>{sr.back}</Small>
          </Pressable>
        </View>
      }
    >
      <Heading level={1}>{sr.title(sector.sellNounPlural)}</Heading>

      {incomplete ? (
        <View style={styles.field}>
          <Banner kind="warning">{sr.incompleteBanner}</Banner>
          <Button
            label={sr.addAnotherPhoto}
            variant="secondary"
            onPress={handleAddAnotherPhoto}
            loading={addingPhoto}
          />
        </View>
      ) : null}

      {skippedCount > 0 ? <Banner kind="info">{sr.skippedExisting(skippedCount)}</Banner> : null}
      {submitError ? <Banner kind="error">{submitError}</Banner> : null}

      <TextField
        label={sr.searchPlaceholder}
        value={search}
        onChangeText={setSearch}
        placeholder={sr.searchPlaceholder}
      />

      <GroupedList
        groups={groups}
        getKey={(dish) => dish.id}
        countLabel={(group, items) => {
          const section = sectionById.get(group);
          const total = section?.dishes.length ?? items.length;
          const ticked = (section?.dishes ?? items).filter((d) => d.ticked).length;
          return `${ticked} of ${total}`;
        }}
        headerAccessory={(group) => {
          const section = sectionById.get(group);
          if (!section) return null;
          const allTicked = section.dishes.every((d) => d.ticked);
          return (
            <View style={styles.headerAccessory}>
              <Pressable
                accessibilityRole="button"
                onPress={() => toggleSection(section.id, !allTicked)}
              >
                <Small style={styles.selectAll}>{sr.selectAll}</Small>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => openRename(section)}>
                <Icon name="edit" size={16} colour={colours.muted} />
              </Pressable>
            </View>
          );
        }}
        renderItem={(dish) => {
          const section = sections.find((s) => s.dishes.some((d) => d.id === dish.id));
          if (!section) return null;
          return (
            <DishRowView
              dish={dish}
              onToggle={(ticked) => updateDish(section.id, dish.id, { ticked })}
              onNameChange={(name) => updateDish(section.id, dish.id, { name })}
              onPriceChange={(price) => updateDish(section.id, dish.id, { price })}
              onRemove={() => removeDish(section.id, dish.id)}
            />
          );
        }}
      />

      <Pressable accessibilityRole="button" onPress={addBlankDish} style={styles.addButton}>
        <Icon name="plus" size={18} colour={colours.primary} />
        <Body style={styles.addButtonText}>{sr.addDish(sector.sellNoun)}</Body>
      </Pressable>

      <Sheet visible={Boolean(renaming)} onClose={() => setRenaming(null)} title={sr.renameSection}>
        <View style={styles.field}>
          <TextField label={sr.sectionNameLabel} value={renameText} onChangeText={setRenameText} />
          <Button label={sr.renameSection} onPress={saveRename} />
        </View>
      </Sheet>
    </Screen>
  );
}

function DishRowView({
  dish,
  onToggle,
  onNameChange,
  onPriceChange,
  onRemove,
}: {
  dish: DishRow;
  onToggle: (ticked: boolean) => void;
  onNameChange: (name: string) => void;
  onPriceChange: (price: string) => void;
  onRemove: () => void;
}) {
  const needsCheck = dish.confidence < 0.8 || Boolean(dish.note);
  const dishLabel = dish.name || sr.untitledDish;
  return (
    <View style={styles.row}>
      <View style={styles.rowCheckbox}>
        <Checkbox
          checked={dish.ticked}
          onChange={onToggle}
          title=""
          accessibilityLabel={dishLabel}
        />
      </View>
      <View style={styles.rowFields}>
        <View style={styles.rowFieldsLine}>
          <View style={styles.rowName}>
            <TextField
              label={sd.nameLabel}
              accessibilityLabel={`${sd.nameLabel} — ${dishLabel}`}
              value={dish.name}
              onChangeText={onNameChange}
              error={dish.error}
            />
          </View>
          <View style={styles.rowPrice}>
            <TextField
              label={sd.priceLabel}
              accessibilityLabel={`${sd.priceLabel} — ${dishLabel}`}
              value={dish.price}
              onChangeText={onPriceChange}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        {needsCheck ? (
          <View style={styles.chip}>
            <Small style={styles.chipText}>{sr.checkThisChip}</Small>
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${sr.remove} ${dish.name || sr.untitledDish}`}
        onPress={onRemove}
        style={styles.rowDelete}
      >
        <Icon name="delete" size={18} colour={colours.danger} />
      </Pressable>
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
  field: {
    gap: spacing.sm,
  },
  headerAccessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selectAll: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  rowCheckbox: {
    paddingTop: spacing.sm,
  },
  rowFields: {
    flex: 1,
    gap: spacing.xs,
  },
  rowFieldsLine: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowName: {
    flex: 2,
    minWidth: 0,
  },
  rowPrice: {
    flex: 1,
    minWidth: 0,
  },
  rowDelete: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colours.warning,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
  },
  addButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  bottomBar: {
    backgroundColor: colours.card,
    borderTopWidth: 2,
    borderTopColor: colours.mint,
    padding: spacing.md,
    gap: spacing.sm,
  },
  backLink: {
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  backLinkText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
});
