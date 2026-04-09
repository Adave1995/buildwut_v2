import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  bigserial,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type Evidence = {
  source: string
  url: string
  snippet: string
  signal_type: 'momentum' | 'engagement' | 'distribution_gap' | 'fundamentals'
}

export type AdjacentNiche = {
  niche: string
  rationale: string
  why_it_could_win: string
  suggested_angle: string
  estimated_difficulty: 'low' | 'medium' | 'high'
}

export type AlertCondition = {
  type: 'score_above' | 'score_below' | 'new_entity' | 'momentum_spike'
  threshold?: number
  sub_score?: string
}

// ---------------------------------------------------------------------------
// Shared data tables (readable by any authed user, writable by service role)
// ---------------------------------------------------------------------------

export const entity = pgTable('entity', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  url: text('url'),
  category: text('category'),
  platform: text('platform').array(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  externalIds: jsonb('external_ids').$type<Record<string, string>>().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const rawObservation = pgTable(
  'raw_observation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // nullable until resolved by the entity resolver
    entityId: uuid('entity_id').references(() => entity.id, { onDelete: 'set null' }),
    sourceId: text('source_id').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    eventType: text('event_type').notNull(), // 'launch' | 'mention' | 'rank_snapshot' | 'comment' | 'star'
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('raw_observation_source_event_unique').on(table.sourceId, table.sourceEventId),
    index('raw_observation_entity_id_idx').on(table.entityId),
  ]
)

export const metricTimeseries = pgTable(
  'metric_timeseries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    metricName: text('metric_name').notNull(), // 'mentions_24h' | 'rank_apple_topfree' | 'hn_score' | ...
    t: timestamp('t', { withTimezone: true }).notNull(),
    value: numeric('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('metric_timeseries_entity_metric_t_idx').on(table.entityId, table.metricName, table.t),
  ]
)

export const scoreSnapshot = pgTable('score_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entity.id, { onDelete: 'cascade' }),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  totalScore: integer('total_score').notNull(),
  momentumScore: integer('momentum_score').notNull(),
  engagementQualityScore: integer('engagement_quality_score').notNull(),
  distributionGapScore: integer('distribution_gap_score').notNull(),
  marketTailwindsScore: integer('market_tailwinds_score').notNull(),
  fundamentalsScore: integer('fundamentals_score').notNull(),
  executionFeasibilityScore: integer('execution_feasibility_score').notNull(),
  reasoning: text('reasoning').notNull(),
  redFlags: text('red_flags').array(),
  oneSentencePitch: text('one_sentence_pitch'),
  evidence: jsonb('evidence').$type<Evidence[]>().notNull().default([]),
  adjacentNiches: jsonb('adjacent_niches').$type<AdjacentNiche[]>().notNull().default([]),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// User-scoped tables (RLS: user_id = auth.uid())
// ---------------------------------------------------------------------------

export const watchlist = pgTable('watchlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  filter: jsonb('filter').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const watchlistEntity = pgTable(
  'watchlist_entity',
  {
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => watchlist.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.watchlistId, table.entityId] })]
)

export const pipelineItem = pgTable(
  'pipeline_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull().default('inbox'), // 'inbox' | 'shortlist' | 'investigating' | 'building' | 'archived'
    notes: text('notes'),
    priority: integer('priority').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('pipeline_item_user_entity_unique').on(table.userId, table.entityId)]
)

export const hiddenEntity = pgTable(
  'hidden_entity',
  {
    userId: uuid('user_id').notNull(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.entityId] })]
)

export const alertRule = pgTable('alert_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  condition: jsonb('condition').$type<AlertCondition>().notNull(),
  delivery: text('delivery').array().notNull().default(['in_app']),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const alertEvent = pgTable('alert_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => alertRule.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entity.id, { onDelete: 'cascade' }),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
  delivered: boolean('delivered').notNull().default(false),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Source health (written by cron handlers, readable by /sources page)
// ---------------------------------------------------------------------------

export const sourceRun = pgTable('source_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: text('source_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(), // 'ok' | 'partial' | 'error'
  itemsIngested: integer('items_ingested').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const entityRelations = relations(entity, ({ many }) => ({
  observations: many(rawObservation),
  metrics: many(metricTimeseries),
  scores: many(scoreSnapshot),
  pipelineItems: many(pipelineItem),
  watchlistEntities: many(watchlistEntity),
  alertEvents: many(alertEvent),
  hiddenEntities: many(hiddenEntity),
}))

export const rawObservationRelations = relations(rawObservation, ({ one }) => ({
  entity: one(entity, { fields: [rawObservation.entityId], references: [entity.id] }),
}))

export const metricTimeseriesRelations = relations(metricTimeseries, ({ one }) => ({
  entity: one(entity, { fields: [metricTimeseries.entityId], references: [entity.id] }),
}))

export const scoreSnapshotRelations = relations(scoreSnapshot, ({ one }) => ({
  entity: one(entity, { fields: [scoreSnapshot.entityId], references: [entity.id] }),
}))

export const watchlistRelations = relations(watchlist, ({ many }) => ({
  entities: many(watchlistEntity),
}))

export const watchlistEntityRelations = relations(watchlistEntity, ({ one }) => ({
  watchlist: one(watchlist, { fields: [watchlistEntity.watchlistId], references: [watchlist.id] }),
  entity: one(entity, { fields: [watchlistEntity.entityId], references: [entity.id] }),
}))

export const pipelineItemRelations = relations(pipelineItem, ({ one }) => ({
  entity: one(entity, { fields: [pipelineItem.entityId], references: [entity.id] }),
}))

export const hiddenEntityRelations = relations(hiddenEntity, ({ one }) => ({
  entity: one(entity, { fields: [hiddenEntity.entityId], references: [entity.id] }),
}))

export const alertRuleRelations = relations(alertRule, ({ many }) => ({
  events: many(alertEvent),
}))

export const alertEventRelations = relations(alertEvent, ({ one }) => ({
  rule: one(alertRule, { fields: [alertEvent.ruleId], references: [alertRule.id] }),
  entity: one(entity, { fields: [alertEvent.entityId], references: [entity.id] }),
}))
