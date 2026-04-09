/**
 * Grok enrichment: calls xAI Grok API for X post search + web search snippets.
 * Both calls are non-fatal — if they fail or time out, scoring continues without them.
 *
 * API: https://api.x.ai/v1/chat/completions (OpenAI-compatible)
 * Model: grok-2-1212 with search_parameters for live search
 */

const XAI_BASE = 'https://api.x.ai/v1'
const GROK_MODEL = 'grok-2-1212'
// 2s total for both parallel Grok calls (they run in parallel), leaving headroom for Claude
const GROK_TIMEOUT_MS = 2_000

export type GrokSnippet = {
  source: 'x_posts' | 'web_search'
  text: string
  url?: string
}

type GrokChatRequest = {
  model: string
  messages: Array<{ role: 'user' | 'system'; content: string }>
  max_tokens: number
  search_parameters?: {
    mode: 'on' | 'off' | 'auto'
    sources?: Array<{ type: 'x' | 'web' | 'news' }>
    return_citations?: boolean
  }
}

async function callGrok(
  request: GrokChatRequest,
  apiKey: string,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${XAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    if (!res.ok) return null

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function parseJsonSnippetsWithUrl(
  raw: string | null
): Array<{ text: string; url?: string }> {
  if (!raw) return []
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item: unknown) => {
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>
            const text = typeof obj.text === 'string' ? obj.text : null
            const url = typeof obj.url === 'string' ? obj.url : undefined
            if (text) return { text, url }
          }
          if (typeof item === 'string') return { text: item }
          return null
        })
        .filter((t): t is { text: string; url?: string } => t !== null)
        .slice(0, 5)
    }
  } catch {
    // ignore parse errors
  }
  return []
}

export async function enrichWithGrok(entityName: string): Promise<GrokSnippet[]> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) return []

  const xRequest: GrokChatRequest = {
    model: GROK_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Search X (Twitter) posts from the last 7 days mentioning "${entityName}". Return a JSON array of up to 5 relevant snippets. Each item: {"text": "post excerpt", "url": "post url if available"}. Respond with ONLY the JSON array, no other text.`,
      },
    ],
    search_parameters: {
      mode: 'on',
      sources: [{ type: 'x' }],
      return_citations: true,
    },
  }

  const webRequest: GrokChatRequest = {
    model: GROK_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Search the web for "${entityName}" reviews OR launch OR feedback. Return a JSON array of up to 5 relevant snippets. Each item: {"text": "excerpt from source", "url": "source url"}. Respond with ONLY the JSON array, no other text.`,
      },
    ],
    search_parameters: {
      mode: 'on',
      sources: [{ type: 'web' }],
      return_citations: true,
    },
  }

  // Both calls run in parallel, each with GROK_TIMEOUT_MS
  const [xRaw, webRaw] = await Promise.all([
    callGrok(xRequest, apiKey, GROK_TIMEOUT_MS),
    callGrok(webRequest, apiKey, GROK_TIMEOUT_MS),
  ])

  const xSnippets = parseJsonSnippetsWithUrl(xRaw)
  const webSnippets = parseJsonSnippetsWithUrl(webRaw)

  const result: GrokSnippet[] = [
    ...xSnippets.map((s) => ({ source: 'x_posts' as const, text: s.text, url: s.url })),
    ...webSnippets.map((s) => ({ source: 'web_search' as const, text: s.text, url: s.url })),
  ]

  return result
}
