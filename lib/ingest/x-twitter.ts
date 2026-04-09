import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import type { IngestResult } from '@/lib/sources/registry'

const TWITTER_SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent'

// Signals relevant to indie building — start tight to keep within free tier limits
const SEARCH_QUERY =
  '(#buildinpublic OR #indiehackers OR #saas OR #microsaas) lang:en -is:retweet -is:reply'

type Tweet = {
  id: string
  text: string
  created_at: string
  author_id: string
  public_metrics: {
    retweet_count: number
    reply_count: number
    like_count: number
    quote_count: number
  }
}

type TwitterResponse = {
  data?: Tweet[]
  meta?: {
    result_count: number
    newest_id: string
    oldest_id: string
    next_token?: string
  }
  errors?: Array<{ message: string }>
}

export async function run(): Promise<IngestResult> {
  const bearerToken = process.env.X_API_BEARER_TOKEN
  if (!bearerToken) {
    return { ok: false, itemsIngested: 0, errors: ['X_API_BEARER_TOKEN not set'] }
  }

  const errors: string[] = []
  let itemsIngested = 0

  const url = new URL(TWITTER_SEARCH_URL)
  url.searchParams.set('query', SEARCH_QUERY)
  url.searchParams.set('max_results', '25')
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id')

  let tweets: Tweet[]
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'User-Agent': 'buildwut/0.1 (personal tool)',
      },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`X API returned ${res.status}`)
    const data = (await res.json()) as TwitterResponse
    if (data.errors?.length) throw new Error(data.errors[0].message)
    tweets = data.data ?? []
  } catch (err) {
    return { ok: false, itemsIngested: 0, errors: [String(err)] }
  }

  for (const tweet of tweets) {
    try {
      await db
        .insert(rawObservation)
        .values({
          entityId: null,
          sourceId: 'x-twitter',
          sourceEventId: tweet.id,
          eventType: 'mention',
          payload: {
            tweet_id: tweet.id,
            text: tweet.text,
            author_id: tweet.author_id,
            likes: tweet.public_metrics.like_count,
            retweets: tweet.public_metrics.retweet_count,
            replies: tweet.public_metrics.reply_count,
            quotes: tweet.public_metrics.quote_count,
          },
          observedAt: new Date(tweet.created_at),
        })
        .onConflictDoNothing()

      itemsIngested++
    } catch (err) {
      errors.push(`tweet ${tweet.id}: ${String(err)}`)
    }
  }

  return { ok: errors.length === 0, itemsIngested, errors }
}
