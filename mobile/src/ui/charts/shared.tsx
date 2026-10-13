import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line as SvgLine, Pattern, Polygon, Rect } from 'react-native-svg';

import { strings } from '../../strings';
import { colours, fonts, radii, spacing } from '../../theme/tokens';
import { MIN_TOUCH_TARGET } from '../constants';
import { Body, Heading, Muted, Small } from '../Text';
import type { ChartFill, ChartMarker, ChartSeries, ChartTableRow } from './types';

export const CHART_HEIGHT = 200;
export const CHART_PADDING_LEFT = 44;
export const CHART_PADDING_RIGHT = 16;
export const CHART_PADDING_TOP = 16;
export const CHART_PADDING_BOTTOM = 28;

/** `12345` -> `"12.3k"`, `1234567` -> `"12.3L"` — axis ticks only; tables and tooltips always show
 * the full value via the caller's own `formatValue`. Below 1000, nice() can still hand back a
 * fractional tick (0.25, 0.5, 0.75 kg) for a chart whose whole domain sits under 1 — rounding those
 * to the nearest integer collapsed three distinct ticks down to the same "0" label, so this only
 * rounds once the value is already a whole number. */
export function formatAxisValue(value: number, valuePrefix = ''): string {
  const abs = Math.abs(value);
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (abs >= 100000) return `${valuePrefix}${trim((value / 100000).toFixed(1))}L`;
  if (abs >= 1000) return `${valuePrefix}${trim((value / 1000).toFixed(1))}k`;
  if (Number.isInteger(value)) return `${valuePrefix}${value}`;
  return `${valuePrefix}${trim(value.toFixed(2))}`;
}

/** Pixels a rendered x-axis label gets, centred on its point/bar — fixed and absolutely positioned
 * rather than an even flex share of the row, so a label still gets this full width to truncate in
 * regardless of how many other points exist between it and the next visible one. */
export const X_LABEL_WIDTH = 64;

/** 1 for a handful of points; every Nth label once there isn't room for all of them at
 * `X_LABEL_WIDTH` each (a 30-day period's daily buckets in a card capped at `HOME_CONTENT_WIDTH`
 * never have room for all 30) — skipped labels render nothing at all rather than an empty slot,
 * since each visible one is now positioned at its own exact point, not sharing a flex cell. */
export function xLabelStep(count: number, plotWidth: number): number {
  if (count <= 1) return 1;
  const maxVisible = Math.max(1, Math.floor(plotWidth / X_LABEL_WIDTH));
  return Math.max(1, Math.ceil(count / maxVisible));
}

/** A label centred on `pointX` would hang off the left or right edge for the first/last point on
 * the axis — clamped to stay fully inside the card, same as a tooltip already does. */
export function clampLabelLeft(pointX: number, containerWidth: number): number {
  return Math.max(0, Math.min(pointX - X_LABEL_WIDTH / 2, containerWidth - X_LABEL_WIDTH));
}

/** Marks a chart's own axis-tick text (x-axis dates/items, y-axis values) so the responsive
 * checker's site-wide 15px text-size floor can exempt it — these are deliberately 12px per the
 * Reports chart spec (dense numeric ticks, not body copy), the same kind of documented, scoped
 * exception docs/RESPONSIVE_AUDIT.md already carries for the landing page's phone mockups. */
export const CHART_AXIS_TEXT_ID = 'chart-axis-label';

export function ChartCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function ChartHeader({ title, unit }: { title: string; unit: string }) {
  return (
    <View style={styles.titleRow}>
      <Heading level={3}>{title}</Heading>
      <Muted size="sm">{unit}</Muted>
    </View>
  );
}

export function ChartTakeaway({ text }: { text: string }) {
  return (
    <View style={styles.takeaway}>
      <Small style={styles.takeawayText}>{text}</Small>
    </View>
  );
}

export function ChartViewToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  const s = strings.chart;
  return (
    <Pressable accessibilityRole="button" onPress={onToggle} style={styles.toggleRow}>
      <Small style={styles.toggleText}>{asTable ? s.viewAsChart : s.viewAsTable}</Small>
    </Pressable>
  );
}

export function ChartEmpty({
  message,
  buttonLabel,
  onPress,
}: {
  message: string;
  buttonLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Body style={styles.emptyText}>{message}</Body>
      {buttonLabel && onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={styles.emptyButton}>
          <Small style={styles.emptyButtonText}>{buttonLabel}</Small>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ChartTable({
  unit,
  series,
  rows,
}: {
  unit: string;
  series: ChartSeries[];
  rows: ChartTableRow[];
}) {
  const s = strings.chart;
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <Small style={styles.tableHeadCell}>{s.dateColumn}</Small>
        {series.map((item) => (
          <Small key={item.key} style={styles.tableHeadCell} numberOfLines={1}>
            {item.label}
          </Small>
        ))}
      </View>
      {rows.map((row, index) => (
        <View key={index} style={styles.tableRow}>
          <Small style={styles.tableCell}>{row.label}</Small>
          {row.values.map((value, cellIndex) => (
            <Small key={cellIndex} style={styles.tableCell}>
              {value}
            </Small>
          ))}
        </View>
      ))}
      <Muted size="sm" style={styles.tableUnit}>
        {unit}
      </Muted>
    </View>
  );
}

function MarkerShape({ marker, colour }: { marker: ChartMarker; colour: string }) {
  const size = 12;
  if (marker === 'square') {
    return <Rect x={0} y={0} width={size} height={size} fill={colour} />;
  }
  if (marker === 'triangle') {
    return <Polygon points={`${size / 2},0 ${size},${size} 0,${size}`} fill={colour} />;
  }
  return <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={colour} />;
}

/** A small static legend swatch, independent of the chart's own `<Defs>` (which only exists while
 * the chart itself is mounted) — the legend must render even in table view. */
function FillSwatch({ fill, colour }: { fill: ChartFill; colour: string }) {
  const size = 14;
  if (fill === 'solid') {
    return (
      <SvgIconBox size={size}>
        <Rect x={0} y={0} width={size} height={size} fill={colour} />
      </SvgIconBox>
    );
  }
  if (fill === 'dotted') {
    return (
      <SvgIconBox size={size}>
        <Rect x={0} y={0} width={size} height={size} fill={colours.mint} />
        {[2, 8].flatMap((cx) =>
          [2, 8].map((cy) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.6} fill={colour} />),
        )}
      </SvgIconBox>
    );
  }
  return (
    <SvgIconBox size={size}>
      <Rect x={0} y={0} width={size} height={size} fill={colours.mint} />
      {[-size, 0, size].map((offset) => (
        <SvgLine
          key={offset}
          x1={offset}
          y1={size}
          x2={offset + size}
          y2={0}
          stroke={colour}
          strokeWidth={2}
        />
      ))}
    </SvgIconBox>
  );
}

function SvgIconBox({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G>{children}</G>
    </Svg>
  );
}

export function ChartLegend({
  series,
  kind,
  extra,
}: {
  series: ChartSeries[];
  kind: 'line' | 'bar';
  /** An extra non-series entry, e.g. the dashed target line on Sales vs cost. */
  extra?: { label: string; colour: string }[];
}) {
  return (
    <View style={styles.legend}>
      {series.map((item) => (
        <View key={item.key} style={styles.legendItem}>
          {kind === 'line' ? (
            <SvgIconBox size={12}>
              <MarkerShape marker={item.marker ?? 'circle'} colour={item.colour} />
            </SvgIconBox>
          ) : (
            <FillSwatch fill={item.fill ?? 'solid'} colour={item.colour} />
          )}
          <Small style={styles.legendLabel}>{item.label}</Small>
        </View>
      ))}
      {(extra ?? []).map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.dashSwatch, { borderColor: item.colour }]} />
          <Small style={styles.legendLabel}>{item.label}</Small>
        </View>
      ))}
    </View>
  );
}

/** Diagonal-stripe and dot `<pattern>` fills for stacked bars, keyed by series so two series never
 * share a pattern id on the same chart. */
export function FillPatterns({ series }: { series: ChartSeries[] }) {
  return (
    <Defs>
      {series.map((item) => {
        if (item.fill === 'striped') {
          return (
            <Pattern
              key={item.key}
              id={patternId(item.key)}
              patternUnits="userSpaceOnUse"
              width={8}
              height={8}
              patternTransform="rotate(45)"
            >
              <Rect width={8} height={8} fill={item.colour} fillOpacity={0.25} />
              <SvgLine x1={0} y1={0} x2={0} y2={8} stroke={item.colour} strokeWidth={3} />
            </Pattern>
          );
        }
        if (item.fill === 'dotted') {
          return (
            <Pattern
              key={item.key}
              id={patternId(item.key)}
              patternUnits="userSpaceOnUse"
              width={8}
              height={8}
            >
              <Rect width={8} height={8} fill={item.colour} fillOpacity={0.25} />
              <Circle cx={4} cy={4} r={1.6} fill={item.colour} />
            </Pattern>
          );
        }
        return null;
      })}
    </Defs>
  );
}

export function patternId(key: string) {
  return `chart-fill-${key}`;
}

export function fillFor(series: ChartSeries): string {
  if (series.fill === 'striped' || series.fill === 'dotted') {
    return `url(#${patternId(series.key)})`;
  }
  return series.colour;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  titleRow: {
    gap: 2,
  },
  takeaway: {
    backgroundColor: colours.mint,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  takeawayText: {
    fontFamily: fonts.bodyExtraBold,
  },
  toggleRow: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  toggleText: {
    color: colours.primary,
    textDecorationLine: 'underline',
  },
  empty: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyText: {
    color: colours.muted,
  },
  emptyButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  emptyButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendLabel: {
    color: colours.text,
  },
  dashSwatch: {
    width: 14,
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
  },
  table: {
    gap: spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colours.mint,
  },
  tableHeadCell: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
  },
  tableCell: {
    flex: 1,
    color: colours.text,
  },
  tableUnit: {
    marginTop: spacing.xs,
  },
});
