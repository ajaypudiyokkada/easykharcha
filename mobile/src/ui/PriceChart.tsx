import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { MIN_TOUCH_TARGET } from './constants';
import { Heading, Muted, Small } from './Text';

export type ChartPoint = { label: string; value: number };

type Props = {
  title: string;
  /** Shown in the title area, e.g. "₹ per L" — never a rotated axis label. */
  unit: string;
  points: ChartPoint[];
  /** "₹" for money values — prefixed onto every value shown (axis, table, tooltip). */
  valuePrefix?: string;
  /** The one plain-language line above the chart — omit (or pass null) when there's nothing to say
   * yet; the caller decides the wording ("Milk costs 7% more than 3 weeks ago"), this just displays
   * it, so the component stays reusable for any series. */
  takeawayText?: string | null;
};

const CHART_HEIGHT = 160;
const MIN_POINT_SPACING = 56;
const PADDING = 24;

/**
 * A small SVG line chart — hand-rolled (no chart library) so it stays lightweight and behaves
 * identically on web and native. Reused by Stock item detail now, and by Reports later.
 */
export function PriceChart({ title, unit, points, valuePrefix = '', takeawayText }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const s = strings.chart;

  if (points.length < 2) {
    return (
      <View style={styles.card}>
        <ChartHeader title={title} unit={unit} />
        <Muted style={styles.notEnough}>{s.notEnoughData}</Muted>
      </View>
    );
  }

  const values = points.map((p) => p.value);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const range = maxValue - minValue || 1;
  const width = Math.max(280, PADDING * 2 + (points.length - 1) * MIN_POINT_SPACING);
  const plotWidth = width - PADDING * 2;
  const plotHeight = CHART_HEIGHT - PADDING * 2;

  const coords = points.map((point, index) => ({
    x: PADDING + (index / (points.length - 1)) * plotWidth,
    y: PADDING + plotHeight - ((point.value - minValue) / range) * plotHeight,
  }));
  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');

  return (
    <View style={styles.card}>
      <ChartHeader title={title} unit={unit} />

      {takeawayText ? (
        <View style={styles.takeaway}>
          <Small style={styles.takeawayText}>{takeawayText}</Small>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setSelected(null);
          setAsTable((current) => !current);
        }}
        style={styles.toggleRow}
      >
        <Small style={styles.toggleText}>{asTable ? s.viewAsChart : s.viewAsTable}</Small>
      </Pressable>

      {asTable ? (
        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Small style={styles.tableHeadCell}>{s.dateColumn}</Small>
            <Small style={styles.tableHeadCell}>{s.priceColumn}</Small>
          </View>
          {points.map((point, index) => (
            <View key={index} style={styles.tableRow}>
              <Small style={styles.tableCell}>{point.label}</Small>
              <Small style={styles.tableCell}>
                {valuePrefix}
                {point.value}
              </Small>
            </View>
          ))}
        </View>
      ) : (
        <View>
          <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`}>
            <Line
              x1={PADDING}
              y1={PADDING}
              x2={PADDING}
              y2={CHART_HEIGHT - PADDING}
              stroke={colours.muted}
              strokeWidth={1}
            />
            <Line
              x1={PADDING}
              y1={CHART_HEIGHT - PADDING}
              x2={width - PADDING}
              y2={CHART_HEIGHT - PADDING}
              stroke={colours.muted}
              strokeWidth={1}
            />
            <Polyline
              points={polylinePoints}
              fill="none"
              stroke={colours.primary}
              strokeWidth={2}
            />
            {coords.map((c, index) => (
              // A ring, not a filled dot — shape plus colour, not colour alone, for the one series
              // this screen draws; a second series (Reports) would use a different mark entirely.
              <Circle
                key={index}
                cx={c.x}
                cy={c.y}
                r={5}
                fill={colours.card}
                stroke={colours.primary}
                strokeWidth={3}
              />
            ))}
          </Svg>
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {coords.map((c, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`${points[index].label}: ${valuePrefix}${points[index].value}`}
                onPress={() => setSelected((current) => (current === index ? null : index))}
                style={[styles.pointTarget, { left: `${(c.x / width) * 100}%`, top: c.y }]}
              >
                {selected === index ? (
                  <View style={styles.tooltip}>
                    <Small style={styles.tooltipText}>
                      {valuePrefix}
                      {points[index].value}
                    </Small>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
          <View style={styles.xAxis}>
            {points.map((point, index) => (
              <Small key={index} style={styles.xLabel} numberOfLines={1}>
                {point.label}
              </Small>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function ChartHeader({ title, unit }: { title: string; unit: string }) {
  return (
    <View style={styles.titleRow}>
      <Heading level={3}>{title}</Heading>
      <Muted size="sm">{unit}</Muted>
    </View>
  );
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
  notEnough: {
    paddingVertical: spacing.lg,
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
  pointTarget: {
    position: 'absolute',
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    marginLeft: -(MIN_TOUCH_TARGET / 2),
    marginTop: -(MIN_TOUCH_TARGET / 2),
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    backgroundColor: colours.text,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  tooltipText: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingHorizontal: PADDING - 16,
  },
  xLabel: {
    color: colours.muted,
    fontSize: 12,
    flex: 1,
    textAlign: 'center',
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
});
