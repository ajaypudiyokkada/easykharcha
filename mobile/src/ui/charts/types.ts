/** Shared shape for both BarChart and LineChart — one series = one line or one stacked/grouped
 * slice. `marker` picks the line-chart point shape (circle/square/triangle); `fill` picks the
 * bar-chart fill pattern (solid/striped/dotted) — shape and pattern carry the series identity, so
 * colour is never the only thing telling two series apart. */
export type ChartMarker = 'circle' | 'square' | 'triangle';
export type ChartFill = 'solid' | 'striped' | 'dotted';

export type ChartSeries = {
  key: string;
  label: string;
  colour: string;
  /** Aligned 1:1 with the chart's `xLabels` — `null` for a bucket this series has no value in. */
  values: (number | null)[];
  marker?: ChartMarker;
  fill?: ChartFill;
};

export type ChartTableRow = {
  label: string;
  /** One formatted cell per series, same order as `series`. */
  values: string[];
};
