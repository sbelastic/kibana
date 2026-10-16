/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod';
import { dataViewReferenceSchema, dataViewSpecSchema } from '@kbn/as-code-data-views-schema';
import {
  discoverSessionApiClassicTabSchema,
  discoverSessionApiDataSchema,
  discoverSessionApiEsqlTabSchema,
  discoverSessionApiMetricsTabSchema,
} from '@kbn/as-code-discover-schema';
import {
  MAX_DISCOVER_SESSION_TABS,
  METRICS_GRID_HISTOGRAM_VISUALIZATIONS,
} from '@kbn/discover-session-constants';
import { MAX_SAVED_OBJECT_ID_LENGTH } from '@kbn/core-saved-objects-server';
import { discoverSessionApiResponseSchema, discoverSessionGetResponseSchema } from './schema';

/** Keeps the heatmap selection off the public session schema while the feature is still changing. */
const discoverSessionInternalMetricsTabSchema = discoverSessionApiMetricsTabSchema.extend({
  histogram_percentile: z.enum(METRICS_GRID_HISTOGRAM_VISUALIZATIONS).meta({
    description:
      'How histogram metric fields are displayed. `distribution` shows a heatmap. ' +
      'A percentile value shows that percentile as a series.',
  }),
});

const internalTabSchema = z.union([
  discoverSessionApiClassicTabSchema.extend({
    data_source: z.discriminatedUnion('type', [
      dataViewReferenceSchema,
      dataViewSpecSchema.extend({
        id: z.string().min(1).max(MAX_SAVED_OBJECT_ID_LENGTH).optional(),
      }),
    ]),
  }),
  discoverSessionApiEsqlTabSchema,
  discoverSessionInternalMetricsTabSchema,
]);

/** Uses the public session format while preserving inline Data View IDs for Discover. */
export const discoverSessionInternalDataSchema = discoverSessionApiDataSchema.extend({
  tabs: z
    .array(internalTabSchema)
    .min(1)
    .max(MAX_DISCOVER_SESSION_TABS)
    .refine(
      (tabs) => new Set(tabs.map((tab) => tab.id)).size === tabs.length,
      'tabs must have unique ids'
    ),
});

export const discoverSessionInternalParamsSchema = z
  .object({ id: z.string().min(1).max(MAX_SAVED_OBJECT_ID_LENGTH) })
  .strict();

export const discoverSessionInternalResponseSchema = discoverSessionApiResponseSchema.extend({
  data: discoverSessionInternalDataSchema,
});

export const discoverSessionInternalGetResponseSchema = discoverSessionGetResponseSchema.extend({
  data: discoverSessionInternalDataSchema,
});

export type DiscoverSessionInternalData = z.output<typeof discoverSessionInternalDataSchema>;
export type DiscoverSessionInternalDataInput = z.input<typeof discoverSessionInternalDataSchema>;
export type DiscoverSessionInternalResponse = z.output<
  typeof discoverSessionInternalResponseSchema
>;
export type DiscoverSessionInternalGetResponse = z.output<
  typeof discoverSessionInternalGetResponseSchema
>;
