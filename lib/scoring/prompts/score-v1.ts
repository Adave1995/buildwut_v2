/**
 * score-v1: Versioned Claude scoring prompt.
 *
 * NEVER edit this file in place. To change scoring logic:
 *   1. Copy this file to score-v2.ts
 *   2. Update PROMPT_VERSION below
 *   3. Update scorer.ts to import the new version
 *
 * This ensures all existing score_snapshot rows remain reproducible.
 */

import type { GrokSnippet } from '@/lib/scoring/grok-enricher'
import type { Evidence, AdjacentNiche } from '@/lib/db/schema'

export const PROMPT_VERSION = 'score-v1'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a startup opportunity analyst helping a solo indie founder named Austin identify actionable opportunities.

Your job is to evaluate product and startup signals gathered from the internet (Hacker News, Reddit, Product Hunt, etc.) and score entities on how interesting they are as inspiration for Austin to build something *adjacent*.

## Scoring philosophy

1. **Distribution gap is the highest-signal dimension.** A great product with bad marketing is a better opportunity than a hot product everyone is already copying. Weight this heavily.
2. **Penalize hype without depth.** If the engagement is all upvotes and no discussion, or all discussion and no users, say so clearly.
3. **Adjacent niches are the most valuable output.** Name specific, concrete verticals — not "other industries." Three sharp niches beat ten vague ones.
4. **Never invent facts.** If you don't have evidence for a claim, say "unknown" or "insufficient data" rather than fabricating.
5. **Execution feasibility is calibrated for a solo founder** with no team, no VC, and limited runway. Be realistic.

## Who Austin is
- Solo indie founder; non-technical on the software side but able to use no-code/low-code tools
- Building personal tools and small SaaS products
- Looking for opportunities he can realistically ship in 1–3 months solo
- Values niche specificity over broad markets

## Output rules
- reasoning: 3–5 sentences maximum. Be direct. Start with the most important observation.
- red_flags: Be honest and specific. "Looks crowded" is not useful. Name the specific risk.
- adjacent_niches: Return at least 3. Each must name a concrete niche (e.g. "construction project managers" not "non-tech industries"), explain why it's underserved, and give a sharp positioning angle.
- one_sentence_pitch: Write it for a feed card. 15 words max. Action-oriented.
`

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

type EntityInput = {
  name: string
  description: string | null
  url: string | null
  category: string | null
}

type MetricInput = {
  metricName: string
  value: string
  t: Date
}

type ObservationInput = {
  sourceId: string
  eventType: string
  payload: Record<string, unknown>
  observedAt: Date
}

export function buildUserPrompt(
  entity: EntityInput,
  metrics: MetricInput[],
  observations: ObservationInput[],
  grokSnippets: GrokSnippet[]
): string {
  const lines: string[] = []

  lines.push(`# Entity: ${entity.name}`)
  if (entity.description) lines.push(`**Description:** ${entity.description}`)
  if (entity.url) lines.push(`**URL:** ${entity.url}`)
  if (entity.category) lines.push(`**Category:** ${entity.category}`)

  lines.push('\n## Metrics (last 30 days)')
  if (metrics.length === 0) {
    lines.push('No metrics computed yet.')
  } else {
    for (const m of metrics) {
      lines.push(`- ${m.metricName}: ${m.value} (as of ${m.t.toISOString().slice(0, 10)})`)
    }
  }

  lines.push('\n## Top observations')
  if (observations.length === 0) {
    lines.push('No observations available.')
  } else {
    for (const obs of observations) {
      const payload = obs.payload
      const title = typeof payload.title === 'string' ? payload.title : null
      const score = typeof payload.score === 'number' ? payload.score : null
      const comments = typeof payload.comments_count === 'number' ? payload.comments_count : null
      const isShowHn = payload.is_show_hn === true

      let line = `- [${obs.sourceId}/${obs.eventType}]`
      if (title) line += ` "${title}"`
      if (isShowHn) line += ' (Show HN)'
      if (score !== null) line += ` | HN score: ${score}`
      if (comments !== null) line += ` | ${comments} comments`
      line += ` | ${obs.observedAt.toISOString().slice(0, 10)}`
      lines.push(line)
    }
  }

  if (grokSnippets.length > 0) {
    lines.push('\n## Additional evidence (from live search)')
    const xSnippets = grokSnippets.filter((s) => s.source === 'x_posts')
    const webSnippets = grokSnippets.filter((s) => s.source === 'web_search')

    if (xSnippets.length > 0) {
      lines.push('\n### X posts (last 7 days)')
      for (const s of xSnippets) {
        lines.push(`- ${s.text}${s.url ? ` (${s.url})` : ''}`)
      }
    }

    if (webSnippets.length > 0) {
      lines.push('\n### Web search results')
      for (const s of webSnippets) {
        lines.push(`- ${s.text}${s.url ? ` (${s.url})` : ''}`)
      }
    }
  }

  lines.push('\n---')
  lines.push('Please score this entity using the score_entity tool.')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Claude tool definition (structured output)
// ---------------------------------------------------------------------------

export const SCORE_TOOL = {
  name: 'score_entity',
  description:
    'Output the complete scoring result for the entity. Always use this tool — do not respond in plain text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      total_score: {
        type: 'number',
        description: 'Overall opportunity score 0–100',
      },
      sub_scores: {
        type: 'object',
        description: 'Breakdown of the total score',
        properties: {
          momentum: {
            type: 'number',
            description: '0–100. Rate of new mentions and engagement velocity.',
          },
          engagement_quality: {
            type: 'number',
            description: '0–100. Depth of discussion vs. shallow upvotes.',
          },
          distribution_gap: {
            type: 'number',
            description:
              '0–100. How much better the product could do with proper distribution. Higher = more opportunity.',
          },
          market_tailwinds: {
            type: 'number',
            description: '0–100. Macro trends supporting growth.',
          },
          fundamentals: {
            type: 'number',
            description: '0–100. Product quality signals: retention, reviews, real use.',
          },
          execution_feasibility: {
            type: 'number',
            description: '0–100. How feasible is it for a solo founder to build something adjacent? Higher = easier.',
          },
        },
        required: [
          'momentum',
          'engagement_quality',
          'distribution_gap',
          'market_tailwinds',
          'fundamentals',
          'execution_feasibility',
        ],
      },
      reasoning: {
        type: 'string',
        description: 'A 3–5 sentence narrative explaining why this entity scored this way. Lead with the most important observation.',
      },
      red_flags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific reasons Austin should be skeptical. Be honest and concrete.',
      },
      evidence: {
        type: 'array',
        description: 'The specific signals that drove the score. Include only evidence you actually have.',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'e.g. hackernews, x_posts, web_search' },
            url: { type: 'string', description: 'Source URL if available, else empty string' },
            snippet: { type: 'string', description: 'Relevant excerpt or observation' },
            signal_type: {
              type: 'string',
              enum: ['momentum', 'engagement', 'distribution_gap', 'fundamentals'],
            },
          },
          required: ['source', 'url', 'snippet', 'signal_type'],
        },
      },
      adjacent_niches: {
        type: 'array',
        description: 'At least 3 concrete adjacent niches where a similar product could win. These are the most valuable output.',
        minItems: 3,
        items: {
          type: 'object',
          properties: {
            niche: {
              type: 'string',
              description: 'Specific niche (e.g. "Construction project managers", not "Other industries")',
            },
            rationale: {
              type: 'string',
              description: 'Why this niche is underserved right now',
            },
            why_it_could_win: {
              type: 'string',
              description: 'Why the pattern from the original product transposes to this niche',
            },
            suggested_angle: {
              type: 'string',
              description: 'A sharp, specific positioning Austin could use to enter this niche',
            },
            estimated_difficulty: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'How hard is this for a solo founder to execute?',
            },
          },
          required: ['niche', 'rationale', 'why_it_could_win', 'suggested_angle', 'estimated_difficulty'],
        },
      },
      one_sentence_pitch: {
        type: 'string',
        description: 'Max 15 words. Action-oriented pitch for the feed card.',
      },
    },
    required: [
      'total_score',
      'sub_scores',
      'reasoning',
      'red_flags',
      'evidence',
      'adjacent_niches',
      'one_sentence_pitch',
    ],
  },
} as const

// ---------------------------------------------------------------------------
// TypeScript type for the Claude tool output
// ---------------------------------------------------------------------------

export type ScoreOutput = {
  total_score: number
  sub_scores: {
    momentum: number
    engagement_quality: number
    distribution_gap: number
    market_tailwinds: number
    fundamentals: number
    execution_feasibility: number
  }
  reasoning: string
  red_flags: string[]
  evidence: Array<{
    source: string
    url: string
    snippet: string
    signal_type: Evidence['signal_type']
  }>
  adjacent_niches: AdjacentNiche[]
  one_sentence_pitch: string
}
