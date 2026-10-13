import { bisector } from 'd3-array';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import React, { useState } from 'react';
import {
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Line as SvgLine,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

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
  formatAxisValue,
  X_LABEL_WIDTH,
  xLabelStep,
} from './shared';
import type { ChartSeries, ChartTableRow } from './types';

type Props = {
  title: string;
  unit: string;
  xLabels: string[];
  /** 1-3 solid lines. */
  series: ChartSeries[];
  /** An optional dashed reference line (Sales vs cost's target-cost line) — drawn and legended, but
   * never offered as the tooltip's "selected" series on its own. */
  dashedSeries?: ChartSeries | null;
  valuePrefix?: string;
  takeawayText?: string | null;
  emptyMessage: string;
  emptyButtonLabel?: string;
  onEmptyAction?: () => void;
  /** Full-precision formatting for the tooltip and table — axis ticks always abbreviate instead. */
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

export function LineChart({
  title,
  unit,
  xLabels,
  series,
  dashedSeries,
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

  const allSeries = dashedSeries ? [...series, dashedSeries] : series;

  if (xLabels.length < 2) {
    return (
      <ChartCard>
        <ChartHeader title={title} unit={unit} />
        <ChartEmpty message={emptyMessage} buttonLabel={emptyButtonLabel} onPress={onEmptyAction} />
      </ChartCard>
    );
  }

  const plotLeft = CHART_PADDING_LEFT;
  const plotRight = Math.max(containerWidth - CHART_PADDING_RIGHT, plotLeft + 1);
  const xScale = scalePoint(xLabels, [plotLeft, plotRight]).padding(0.15);
  const labelStep = xLabelStep(xLabels.length, plotRight - plotLeft);

  const allValues = allSeries.flatMap((item) => item.values.filter((v): v is number => v !== null));
  const maxValue = Math.max(0, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const yScale = scaleLinear()
    .domain([minValue, maxValue])
    .nice(4)
    .range([CHART_HEIGHT - CHART_PADDING_BOTTOM, CHART_PADDING_TOP]);
  const yTicks = yScale.ticks(4);

  const xPositions = xLabels.map((label) => xScale(label) ?? plotLeft);
  const bisectCenter = bisector((d: number) => d).center;

  function handleMove(event: NativeSyntheticEvent<unknown> | GestureResponderEvent) {
    const x = locationXFrom(event);
    if (x === null) return;
    const index = bisectCenter(xPositions, x);
    setSelected(Math.max(0, Math.min(xLabels.length - 1, index)));
  }

  function pathFor(item: ChartSeries): string {
    const points = item.values
      .map((value, index) => ({ value, index }))
      .filter((p): p is { value: number; index: number } => p.value !== null);
    const generator = d3line<{ value: number; index: number }>()
      .x((p) => xPositions[p.index])
      .y((p) => yScale(p.value));
    return generator(points) ?? '';
  }

  const tableRows: ChartTableRow[] = xLabels.map((label, index) => ({
    label,
    values: allSeries.map((item) =>
      item.values[index] === null ? '—' : format(item.values[index] as number),
    ),
  }));

  return (
    <ChartCard>
      <ChartHeader title={title} unit={unit} />
      {takeawayText ? <ChartTakeaway text={takeawayText} /> : null}
      <ChartLegend
        series={series}
        kind="line"
        extra={
          dashedSeries ? [{ label: dashedSeries.label, colour: dashedSeries.colour }] : undefined
        }
      />
      <ChartViewToggle
        asTable={asTable}
        onToggle={() => {
          setSelected(null);
          setAsTable((current) => !current);
        }}
      />

      {asTable ? (
        <ChartTable unit={unit} series={allSeries} rows={tableRows} />
      ) : (
        <View
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleMove}
          onResponderMove={handleMove}
          // react-native-web only — ignored by native, which has no plain mouse-hover concept.
          {...(Platform.OS === 'web'
            ? ({ onMouseMove: handleMove, onMouseLeave: () => setSelected(null) } as object)
            : {})}
        >
          <Svg
            width={containerWidth}
            height={CHART_HEIGHT}
            viewBox={`0 0 ${containerWidth} ${CHART_HEIGHT}`}
          >
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

            {dashedSeries ? (
              <Path
                d={pathFor(dashedSeries)}
                stroke={dashedSeries.colour}
                strokeWidth={2}
                strokeDasharray="6,5"
                fill="none"
              />
            ) : null}
            {series.map((item) => (
              <Path
                key={item.key}
                d={pathFor(item)}
                stroke={item.colour}
                strokeWidth={2}
                fill="none"
              />
            ))}
            {series.map((item) =>
              item.values.map((value, index) =>
                value === null ? null : (
                  <PointMarker
                    key={`${item.key}-${index}`}
                    marker={item.marker ?? 'circle'}
                    colour={item.colour}
                    cx={xPositions[index]}
                    cy={yScale(value)}
                  />
                ),
              ),
            )}

            {selected !== null ? (
              <SvgLine
                x1={xPositions[selected]}
                y1={CHART_PADDING_TOP}
                x2={xPositions[selected]}
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
                  style={[
                    styles.xLabel,
                    { left: clampLabelLeft(xPositions[index], containerWidth) },
                  ]}
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
                { left: Math.min(Math.max(xPositions[selected] - 70, 0), containerWidth - 150) },
              ]}
            >
              <Small style={styles.tooltipHead}>{xLabels[selected]}</Small>
              {allSeries.map((item) => {
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

function PointMarker({
  marker,
  colour,
  cx,
  cy,
}: {
  marker: NonNullable<ChartSeries['marker']>;
  colour: string;
  cx: number;
  cy: number;
}) {
  const r = 4;
  if (marker === 'square') {
    return <Rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={colour} />;
  }
  if (marker === 'triangle') {
    const points = `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`;
    return <Polygon points={points} fill={colour} />;
  }
  return <Circle cx={cx} cy={cy} r={r} fill={colours.card} stroke={colour} strokeWidth={2.5} />;
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
