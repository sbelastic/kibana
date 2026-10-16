/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { METRICS_GRID_HISTOGRAM_VISUALIZATIONS } from '@kbn/discover-session-constants';
import { DiscoverTabType } from '@kbn/discover-session-constants';
import type { DiscoverSessionTabAttributes } from '@kbn/saved-search-plugin/server';
import type {
  DiscoverSessionApiTab,
  DiscoverSessionApiTabTypeState,
} from '@kbn/as-code-discover-schema';

type StoredTabTypeState = DiscoverSessionTabAttributes['tabTypeState'];
type HistogramVisualization = (typeof METRICS_GRID_HISTOGRAM_VISUALIZATIONS)[number];

/** Percentile the public session API returns for a stored heatmap selection. */
export const PUBLIC_HISTOGRAM_PERCENTILE_FOR_DISTRIBUTION = 'p95' as const;

type PublicMetricsTabTypeState = Extract<DiscoverSessionApiTabTypeState, { type: 'metrics' }>;
type PublicMetricsTab = Extract<DiscoverSessionApiTab, { type: 'metrics' }>;

/** Metrics settings the internal session API accepts, including the heatmap selection. */
export type DiscoverSessionMetricsTabTypeStateInput = Omit<
  PublicMetricsTabTypeState,
  'histogram_percentile'
> & {
  histogram_percentile: HistogramVisualization;
};

/** Tab settings accepted by the internal session API. */
export type DiscoverSessionTabTypeStateInput =
  | Exclude<DiscoverSessionApiTabTypeState, { type: 'metrics' }>
  | DiscoverSessionMetricsTabTypeStateInput;

/** Session tab the internal API accepts, including the heatmap selection. */
export type DiscoverSessionInternalMetricsTab = Omit<PublicMetricsTab, 'histogram_percentile'> & {
  histogram_percentile: HistogramVisualization;
};

/** Session tab the internal API accepts. */
export type DiscoverSessionInternalApiTab =
  | Exclude<DiscoverSessionApiTab, { type: 'metrics' }>
  | DiscoverSessionInternalMetricsTab;

/** Converts API tab settings to saved state; default tabs have no type-specific state. */
export const toStoredTabTypeState = (
  apiTabTypeState: DiscoverSessionTabTypeStateInput
): StoredTabTypeState => {
  switch (apiTabTypeState.type) {
    case DiscoverTabType.Default:
      // Default tabs have no tabTypeState in the saved object.
      return undefined;
    case DiscoverTabType.Metrics:
      return {
        type: DiscoverTabType.Metrics,
        dimensions: apiTabTypeState.dimensions,
        searchTerm: apiTabTypeState.search_term,
        counterAggregation: apiTabTypeState.counter_aggregation,
        gaugeAggregation: apiTabTypeState.gauge_aggregation,
        histogramPercentile: apiTabTypeState.histogram_percentile,
        ...(apiTabTypeState.grid_sort_field !== undefined && {
          gridSortField: apiTabTypeState.grid_sort_field,
        }),
        ...(apiTabTypeState.grid_sort_direction !== undefined && {
          gridSortDirection: apiTabTypeState.grid_sort_direction,
        }),
      };
  }
};

const toApiHistogramPercentile = (
  histogramPercentile: HistogramVisualization,
  includeDistribution: boolean
): HistogramVisualization =>
  histogramPercentile === 'distribution' && !includeDistribution
    ? PUBLIC_HISTOGRAM_PERCENTILE_FOR_DISTRIBUTION
    : histogramPercentile;

/** Converts saved tab settings to declarative fields. The public API omits the heatmap selection. */
export function fromStoredTabTypeState(
  tabTypeState: StoredTabTypeState,
  options: { includeDistribution: true }
): DiscoverSessionTabTypeStateInput;
export function fromStoredTabTypeState(
  tabTypeState: StoredTabTypeState,
  options?: { includeDistribution?: false }
): DiscoverSessionApiTabTypeState;
export function fromStoredTabTypeState(
  tabTypeState: StoredTabTypeState,
  options?: { includeDistribution?: boolean }
): DiscoverSessionTabTypeStateInput {
  const includeDistribution = options?.includeDistribution ?? false;

  switch (tabTypeState?.type) {
    case undefined:
      // The API always includes a type, using default when the saved object has no tabTypeState.
      return { type: DiscoverTabType.Default };
    case DiscoverTabType.Metrics:
      return {
        type: DiscoverTabType.Metrics,
        dimensions: tabTypeState.dimensions,
        search_term: tabTypeState.searchTerm,
        counter_aggregation: tabTypeState.counterAggregation,
        gauge_aggregation: tabTypeState.gaugeAggregation,
        histogram_percentile: toApiHistogramPercentile(
          tabTypeState.histogramPercentile,
          includeDistribution
        ),
        ...(tabTypeState.gridSortField !== undefined && {
          grid_sort_field: tabTypeState.gridSortField,
        }),
        ...(tabTypeState.gridSortDirection !== undefined && {
          grid_sort_direction: tabTypeState.gridSortDirection,
        }),
      };
  }
}
