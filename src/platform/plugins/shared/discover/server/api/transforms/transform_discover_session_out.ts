/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { toAsCodeTags } from '@kbn/as-code-shared-transforms';
import type {
  DiscoverSessionApiData,
  DiscoverSessionApiTab,
  DiscoverSessionApiTabBase,
} from '@kbn/as-code-discover-schema';
import type { SavedObjectReference } from '@kbn/core/server';
import type { DiscoverSessionAttributes } from '@kbn/saved-search-plugin/server';
import { injectReferences, parseSearchSourceJSON } from '@kbn/data-plugin/common';
import type { SerializedSearchSourceFields } from '@kbn/data-plugin/common';
import { isOfAggregateQueryType } from '@kbn/es-query';
import { AS_CODE_DATA_VIEW_SPEC_TYPE } from '@kbn/as-code-data-views-schema';
import { DiscoverTabType } from '@kbn/discover-session-constants';
import type { DiscoverSessionInternalData } from '../internal_schema';
import type { DiscoverSessionWarning } from '../schema';
import { transformControlPanelsOut } from './transform_control_panels';
import {
  applySessionTabTypeState,
  fromStoredSessionSearchAndTable,
  fromStoredClassicSessionSettings,
  fromStoredEsqlSessionSettings,
  pinnedFiltersToAppFilters,
} from '../../../common/session/session_tab_mapping';
import { fromStoredSearchAndTable } from '../../../common/session/search_and_table_mapping';
import {
  PUBLIC_HISTOGRAM_PERCENTILE_FOR_DISTRIBUTION,
  type DiscoverSessionInternalApiTab,
} from '../../../common/session/tab_type_state';
import { isDiscoverSessionEsqlTab } from '../../../common/session/type_guards';
import { toApiVisContext } from '../../../common/session/vis_context';

interface ConvertedSessionTab<TTab = DiscoverSessionApiTab> {
  tab: TTab;
  warnings: DiscoverSessionWarning[];
}

/** Builds API session data, preserving valid controls and collecting warnings for omitted ones. */
export const transformDiscoverSessionOut = (
  attributes: DiscoverSessionAttributes,
  references: SavedObjectReference[] = []
): { sessionState: DiscoverSessionApiData; warnings: DiscoverSessionWarning[] } => {
  const convertedTabs = attributes.tabs.map((storedTab) => {
    const searchSource = readSessionSearchSource(storedTab, references);
    const searchAndTableFields = fromStoredSessionSearchAndTable(
      storedTab.attributes,
      searchSource
    );

    return fromStoredSessionTab(storedTab, searchAndTableFields, { includeDistribution: false });
  });

  return assembleApiSession(attributes, references, convertedTabs);
};

/** Builds session data for Discover, preserving inline IDs and their filter references. */
export const transformInternalDiscoverSessionOut = (
  attributes: DiscoverSessionAttributes,
  references: SavedObjectReference[] = []
): { sessionState: DiscoverSessionInternalData; warnings: DiscoverSessionWarning[] } => {
  const convertedTabs = attributes.tabs.map((storedTab) => {
    let searchSource = readSessionSearchSource(storedTab, references);
    let inlineDataViewId: string | undefined;

    if (!isOfAggregateQueryType(searchSource.query)) {
      searchSource = pinnedFiltersToAppFilters(searchSource);
      const { index } = searchSource;
      if (index && typeof index !== 'string') {
        inlineDataViewId = index.id;
      }
    }

    const searchAndTableFields = fromStoredSearchAndTable(storedTab.attributes, searchSource);
    const converted = fromStoredSessionTab(storedTab, searchAndTableFields, {
      includeDistribution: true,
    });
    const { tab } = converted;

    if (
      isDiscoverSessionEsqlTab(tab) ||
      tab.data_source.type !== AS_CODE_DATA_VIEW_SPEC_TYPE ||
      inlineDataViewId === undefined
    ) {
      return converted;
    }

    return {
      ...converted,
      tab: { ...tab, data_source: { ...tab.data_source, id: inlineDataViewId } },
    };
  });

  return assembleApiSession(attributes, references, convertedTabs);
};

/** Reads the SearchSource, resolving references only for classic tabs. */
const readSessionSearchSource = (
  tab: DiscoverSessionAttributes['tabs'][number],
  references: SavedObjectReference[]
): SerializedSearchSourceFields => {
  const searchSource = parseSearchSourceJSON(tab.attributes.kibanaSavedObjectMeta.searchSourceJSON);

  // ES|QL does not use Data View or filter references from the stored SearchSource.
  if (isOfAggregateQueryType(searchSource.query)) {
    return searchSource;
  }

  return injectReferences(searchSource, references);
};

/** Completes mapped search and table fields with session settings, chart, controls, and tab type. */
function fromStoredSessionTab(
  tab: DiscoverSessionAttributes['tabs'][number],
  searchAndTableFields: DiscoverSessionApiTabBase,
  options: { includeDistribution: true }
): ConvertedSessionTab<DiscoverSessionInternalApiTab>;
function fromStoredSessionTab(
  tab: DiscoverSessionAttributes['tabs'][number],
  searchAndTableFields: DiscoverSessionApiTabBase,
  options: { includeDistribution: false }
): ConvertedSessionTab;
function fromStoredSessionTab(
  tab: DiscoverSessionAttributes['tabs'][number],
  searchAndTableFields: DiscoverSessionApiTabBase,
  options: { includeDistribution: boolean }
): ConvertedSessionTab<DiscoverSessionApiTab | DiscoverSessionInternalApiTab> {
  const sessionSettings = isDiscoverSessionEsqlTab(searchAndTableFields)
    ? fromStoredEsqlSessionSettings(tab.attributes)
    : fromStoredClassicSessionSettings(tab.attributes);
  const apiTab = {
    ...searchAndTableFields,
    ...sessionSettings,
  };
  const visContext = toApiVisContext(tab.attributes.visContext);
  const { panels: controlPanels, warnings } = transformControlPanelsOut(
    tab.attributes.controlGroupJson,
    tab.id
  );
  const sessionTab = {
    id: tab.id,
    label: tab.label,
    ...apiTab,
    ...(visContext !== undefined && { vis_context: visContext }),
    ...(controlPanels !== undefined && { control_panels: controlPanels }),
  };
  const includeDistribution = options.includeDistribution;
  const typedTab = includeDistribution
    ? applySessionTabTypeState(sessionTab, tab.attributes.tabTypeState, {
        includeDistribution: true,
      })
    : applySessionTabTypeState(sessionTab, tab.attributes.tabTypeState);
  const storedTabTypeState = tab.attributes.tabTypeState;
  const omittedDistribution =
    !includeDistribution &&
    storedTabTypeState?.type === DiscoverTabType.Metrics &&
    storedTabTypeState.histogramPercentile === 'distribution';

  return {
    tab: typedTab,
    warnings: omittedDistribution
      ? [
          ...warnings,
          {
            type: 'dropped_property',
            tab_id: tab.id,
            key: 'histogram_percentile',
            value: 'distribution',
            message: `The histogram visualization "distribution" is not available on this API. The response uses "${PUBLIC_HISTOGRAM_PERCENTILE_FOR_DISTRIBUTION}".`,
          },
        ]
      : warnings,
  };
}

/** Combines converted tabs and their warnings in the original tab order. */
const assembleApiSession = <TTab extends DiscoverSessionApiTab | DiscoverSessionInternalApiTab>(
  { title, description }: DiscoverSessionAttributes,
  references: SavedObjectReference[],
  convertedTabs: Array<ConvertedSessionTab<TTab>>
): {
  sessionState: Omit<DiscoverSessionApiData, 'tabs'> & { tabs: TTab[] };
  warnings: DiscoverSessionWarning[];
} => {
  const { tags } = toAsCodeTags(references);
  const sessionState = {
    title,
    description,
    tags,
    tabs: convertedTabs.map(({ tab }) => tab),
  };
  const warnings = convertedTabs.flatMap((tab) => tab.warnings);

  return { sessionState, warnings };
};
