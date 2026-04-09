/**
 * Main scoring orchestrator.
 *
 * Flow:
 *   1. Load entity + recent metrics + top observations from DB
 *   2. Call Grok for enrichment snippets (non-blocking, parallel)
 *   3. Build versioned prompt
 *   4. Call Claude with tool_use for structured output
 *   5. Write score_snapshot (immutable — never updated)
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { entity, metricTimeseries, rawObservation, scoreSnapshot } from '@/lib/db/schema'
import { eq, desc, and, gte } from 'drizzle-orm'
import { enrichWithGrok } from './grok-enricher'
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  SCORE_TOOL,
  buildUserPrompt,
  type ScoreOutput,
} from './prompts/score-v1'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 900

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ScorerResult =
  | { ok: true; scoreId: string }
  | { ok: false; reason: string }

export async function scoreEntity(
  entityId: string,
  functionStartedAt: number = Date.now(),
  withGrok: boolean = true
): Promise<ScorerResult> {
  // 1. Load entity
  const [entityRow] = await db
    .select()
    .from(entity)
    .where(eq(entity.id, entityId))
    .limit(1)

  if (!entityRow) {
    return { ok: false, reason: `Entity ${entityId} not found` }
  }

  // 2. Load recent metrics (last 30 days, latest value per metric)
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const metrics = await db
    .select({
      metricName: metricTimeseries.metricName,
      value: metricTimeseries.value,
      t: metricTimeseries.t,
    })
    .from(metricTimeseries)
    .where(
      and(
        eq(metricTimeseries.entityId, entityId),
        gte(metricTimeseries.t, since30d)
      )
    )
    .orderBy(desc(metricTimeseries.t))
    .limit(20)

  // 3. Load top 5 most recent observations
  const observations = await db
    .select({
      sourceId: rawObservation.sourceId,
      eventType: rawObservation.eventType,
      payload: rawObservation.payload,
      observedAt: rawObservation.observedAt,
    })
    .from(rawObservation)
    .where(eq(rawObservation.entityId, entityId))
    .orderBy(desc(rawObservation.observedAt))
    .limit(5)

  // 4. Grok enrichment — non-fatal; failure just means no enrichment snippets.
  let grokSnippets: Awaited<ReturnType<typeof enrichWithGrok>> = []
  if (withGrok) {
    try {
      grokSnippets = await enrichWithGrok(entityRow.name)
    } catch {
      // non-fatal
    }
  }

  // 5. Build prompt
  const userPrompt = buildUserPrompt(
    {
      name: entityRow.name,
      description: entityRow.description ?? null,
      url: entityRow.url ?? null,
      category: entityRow.category ?? null,
    },
    metrics.map((m) => ({ ...m, value: String(m.value), t: m.t ?? new Date() })),
    observations.map((o) => ({
      ...o,
      payload: o.payload as Record<string, unknown>,
    })),
    grokSnippets
  )

  // 6. Call Claude with structured output via tool_use.
  //    Cap at 25s; score-pending maxDuration is 60s so we have plenty of headroom.
  const remaining = 55_000 - (Date.now() - functionStartedAt)
  const claudeTimeout = Math.min(remaining - 500, 25_000) // leave 500ms for DB write
  if (claudeTimeout < 2_000) {
    return { ok: false, reason: `Insufficient time for Claude call (${claudeTimeout}ms remaining)` }
  }

  let scoreOutput: ScoreOutput
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), claudeTimeout)

    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [SCORE_TOOL],
        tool_choice: { type: 'tool', name: 'score_entity' },
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal }
    )
    clearTimeout(timer)

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return { ok: false, reason: 'Claude did not call score_entity tool' }
    }

    scoreOutput = toolUseBlock.input as ScoreOutput
  } catch (err) {
    return { ok: false, reason: `Claude API error: ${String(err)}` }
  }

  // Clamp all scores to 0–100
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

  // 8. Write score_snapshot (immutable)
  const asOf = new Date()
  const [inserted] = await db
    .insert(scoreSnapshot)
    .values({
      entityId,
      asOf,
      totalScore: clamp(scoreOutput.total_score),
      momentumScore: clamp(scoreOutput.sub_scores.momentum),
      engagementQualityScore: clamp(scoreOutput.sub_scores.engagement_quality),
      distributionGapScore: clamp(scoreOutput.sub_scores.distribution_gap),
      marketTailwindsScore: clamp(scoreOutput.sub_scores.market_tailwinds),
      fundamentalsScore: clamp(scoreOutput.sub_scores.fundamentals),
      executionFeasibilityScore: clamp(scoreOutput.sub_scores.execution_feasibility),
      reasoning: scoreOutput.reasoning,
      redFlags: scoreOutput.red_flags,
      oneSentencePitch: scoreOutput.one_sentence_pitch,
      evidence: scoreOutput.evidence,
      adjacentNiches: scoreOutput.adjacent_niches,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
    })
    .returning({ id: scoreSnapshot.id })

  return { ok: true, scoreId: inserted.id }
}
