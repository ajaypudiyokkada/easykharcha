import { bisector } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import React, { useState } from 'react';
import {
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Line as SvgLine, Rect, Text as SvgText } from 'react-native-svg';

import { colours, fonts } from '../../theme/tokens';
import { Small } from '../Text';
import {
  CHART_AXIS_TEXT_ID,
  CHART_HEIGHT,
  CHART_PADDING_BOTTOM,
  CHART_PADDING_LEFT,
  CHART_PADDING_RIGHT,
  CHART_PADDING_TOP,
  ChartCard,
  ChartEmpty,
  ChartHeader,
  ChartLegend,
  ChartTable,
  ChartTakeaway,
  ChartViewToggle,
  clampLabelLeft,
  FillPatterns,
  fillFor,
  formatAxisValue,
  X_LABEL_WIDTH,
  xLabelStep,
} from './shared';
import type { ChartSeries, ChartTableRow } from './types';

type Props = {
  title: string;
  unit: string;
  xLabels: string[];
  series: ChartSeries[];
  mode: 'stacked' | 'grouped';
  valuePrefix?: string;
  takeawayText?: string | null;
  emptyMessage: string;
  emptyButtonLabel?: string;
  onEmptyAction?: () => void;
  formatValue?: (value: number) => string;
};

function locationXFrom(
  event: NativeSyntheticEvent<unknown> | GestureResponderEvent,
): number | null {
  const native = (event as GestureResponderEvent).nativeEvent as unknown as {
    locationX?: number;
    offsetX?: number;
  };
  if (typeof native.locationX === 'number') return native.locationX;
  if (typeof native.offsetX === 'number') return native.offsetX;
  return null;
}

export function BarChart({
  title,
  unit,
  xLabels,
  series,
  mode,
  valuePrefix = '',
  takeawayText,
  emptyMessage,
  emptyButtonLabel,
  onEmptyAction,
  formatValue,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(320);
  const [asTable, setAsTable] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const format = formatValue ?? ((value: number) => `${valuePrefix}${value}`);

  // Unlike a line chart (which needs 2+ points to draw a trend), one bar/category is still a
  // meaningful picture — a single "Today" bucket, or a single stock item's used-vs-expected pair.
  // What makes a bar chart genuinely empty is no categories, or every series sitting at zero.
  const hasData =
    xLabels.length > 0 &&
    series.length > 0 &&
    series.some((item) => item.values.some((value) => value !== null && value !== 0));
  if (!hasData) {
    return (
      <ChartCard>
        <ChartHeader title={title} unit={unit} />
        <ChartEmpty message={emptyMessage} buttonLabel={emptyButtonLabel} onPress={onEmptyAction} />
      </ChartCard>
    );
  }

  const plotLeft = CHART_PADDING_LEFT;
  const plotRight = Math.max(containerWidth - CHART_PADDING_RIGHT, plotLeft + 1);
  const labelStep = xLabelStep(xLabels.length, plotRight - plotLeft);
  const outerBand = scaleBand(xLabels, [plotLeft, plotRight]).padding(0.3);
  const innerBand = scaleBand(
    series.map((item) => item.key),
    [0, outerBand.bandwidth()],
  ).padding(0.12);

  const maxValue =
    mode === 'stacked'
      ? Math.max(
          0,
          ...xLabels.map((_, index) =>
            series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
          ),
        )
      : Math.max(0, ...series.flatMap((item) => item.values.map((v) => v ?? 0)));
  const yScale = scaleLinear()
    .domain([0, maxValue])
    .nice(4)
    .range([CHART_HEIGHT - CHART_PADDING_BOTTOM, CHART_PADDING_TOP]);
  const yTicks = yScale.ticks(4);

  const centers = xLabels.map(
    (label) => (outerBand(label) ?? plotLeft) + outerBand.bandwidth() / 2,
  );
  const bisectCenter = bisector((d: number) => d).center;

  function handleMove(event: NativeSyntheticEvent<unknown> | GestureResponderEvent) {
    const x = locationXFrom(event);
    if (x === null) return;
    const index = bisectCenter(centers, x);
    setSelected(Math.max(0, Math.min(xLabels.length - 1, index)));
  }

  const tableRows: ChartTableRow[] = xLabels.map((label, index) => ({
    label,
    values: series.map((item) =>
      item.values[index] === null ? '—' : format(item.values[index] as number),
    ),
  }));

  return (
    <ChartCard>
      <ChartHeader title={title} unit={unit} />
      {takeawayText ? <ChartTakeaway text={takeawayText} /> : null}
      <ChartLegend series={series} kind="bar" />
      <ChartViewToggle
        asTable={asTable}
        onToggle={() => {
          setSelected(null);
          setAsTable((current) => !current);
        }}
      />

      {asTable ? (
        <ChartTable unit={unit} series={series} rows={tableRows} />
      ) : (
        <View
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleMove}
          onResponderMove={handleMove}
          {...(Platform.OS === 'web'
            ? ({ onMouseMove: handleMove, onMouseLeave: () => setSelected(null) } as object)
            : {})}
        >
          <Svg
            width={containerWidth}
            height={CHART_HEIGHT}
            viewBox={`0 0 ${containerWidth} ${CHART_HEIGHT}`}
          >
            <FillPatterns series={series} />
            {yTicks.map((tick) => (
              <SvgLine
                key={tick}
                x1={plotLeft}
                y1={yScale(tick)}
                x2={plotRight}
                y2={yScale(tick)}
                stroke={colours.mint}
                strokeWidth={1}
              />
            ))}
            {yTicks.map((tick) => (
              <SvgText
                key={`label-${tick}`}
                x={plotLeft - 8}
                y={yScale(tick) + 4}
                fontSize={12}
                fill={colours.muted}
                textAnchor="end"
              >
                {formatAxisValue(tick, valuePrefix)}
              </SvgText>
            ))}

            {xLabels.map((label, index) => {
              if (mode === 'stacked') {
                let cumulative = 0;
                const x = outerBand(label) ?? plotLeft;
                const width = outerBand.bandwidth();
                return series.map((item) => {
                  const value = item.values[index] ?? 0;
                  const y0 = yScale(cumulative);
                  const y1 = yScale(cumulative + value);
                  cumulative += value;
                  if (value <= 0) return null;
                  return (
                    <Rect
                      key={`${label}-${item.key}`}
                      x={x}
                      y={y1}
                      width={width}
                      height={Math.max(0, y0 - y1)}
                      fill={fillFor(item)}
                    />
                  );
                });
              }
              return series.map((item) => {
                const value = item.values[index];
                if (value === null) return null;
                const x = (outerBand(label) ?? plotLeft) + (innerBand(item.key) ?? 0);
                const width = innerBand.bandwidth();
                const y = yScale(value);
                const baseline = yScale(0);
                return (
                  <Rect
                    key={`${label}-${item.key}`}
                    x={x}
                    y={Math.min(y, baseline)}
                    width={width}
                    height={Math.abs(baseline - y)}
                    fill={fillFor(item)}
                  />
                );
              });
            })}

            {selected !== null ? (
              <SvgLine
                x1={centers[selected]}
                y1={CHART_PADDING_TOP}
                x2={centers[selected]}
                y2={CHART_HEIGHT - CHART_PADDING_BOTTOM}
                stroke={colours.secondary}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
            ) : null}
          </Svg>

          <View style={styles.xAxis}>
            {xLabels.map((label, index) =>
              index % labelStep === 0 ? (
                <Small
                  key={index}
                  nativeID={CHART_AXIS_TEXT_ID}
                  numberOfLines={1}
                  style={[styles.xLabel, { left: clampLabelLeft(centers[index], containerWidth) }]}
                >
                  {label}
                </Small>
              ) : null,
            )}
          </View>

          {selected !== null ? (
            <View
              style={[
                styles.tooltip,
                { left: Math.min(Math.max(centers[selected] - 70, 0), containerWidth - 150) },
              ]}
            >
              <Small style={styles.tooltipHead}>{xLabels[selected]}</Small>
              {series.map((item) => {
                const value = item.values[selected];
                return (
                  <Small key={item.key} style={styles.tooltipRow}>
                    {item.label}: {value === null ? '—' : format(value)}
                  </Small>
                );
              })}
            </View>
          ) : null}
        </View>
      )}
    </ChartCard>
  );
}

const styles = StyleSheet.create({
  xAxis: {
    position: 'relative',
    height: 16,
    marginTop: 2,
  },
  xLabel: {
    position: 'absolute',
    width: X_LABEL_WIDTH,
    color: colours.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  tooltip: {
    position: 'absolute',
    top: 4,
    width: 150,
    backgroundColor: colours.text,
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  tooltipHead: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  tooltipRow: {
    color: colours.card,
  },
});
