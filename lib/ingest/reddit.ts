import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

const SUBREDDITS = [
  'SideProject',
  'SaaS',
  'startups',
  'Entrepreneur',
  'InternetIsBeautiful',
  'microsaas',
  'indiehackers',
]

const USER_AGENT = 'buildwut/0.1 (personal tool)'

type RedditPost = {
  id: string
  title: string
  url: string
  selftext: string
  score: number
  num_comments: number
  author: string
  created_utc: number
  permalink: string
  is_self: boolean
  domain: string
}

type RedditListing = {
  data: {
    children: Array<{ kind: string; data: RedditPost }>
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchSubreddit(subreddit: string): Promise<RedditPost[]> {
  const res = await fetch(`https://www.reddit.com/r/${subreddit}.json?limit=25`, {
    headers: { 'User-Agent': USER_AGENT },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`r/${subreddit} returned ${res.status}`)
  const json = (await res.json()) as RedditListing
  return json.data.children.filter((c) => c.kind === 't3').map((c) => c.data)
}

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const sub = SUBREDDITS[i]

    if (i > 0) await sleep(1000)

    let posts: RedditPost[]
    try {
      posts = await fetchSubreddit(sub)
    } catch (err) {
      errors.push(`r/${sub}: ${String(err)}`)
      continue
    }

    for (const post of posts) {
      try {
        // Only resolve entity for posts that link to an external URL
        const externalUrl =
          !post.is_self && post.url && !post.url.includes('reddit.com')
            ? post.url
            : undefined

        let entityId: string | null = null
        try {
          entityId = await resolveEntity({
            name: post.title,
            url: externalUrl,
            externalIds: { reddit: post.id },
          })
        } catch (resolveErr) {
          errors.push(`resolve ${post.id}: ${String(resolveErr)}`)
        }

        await db
          .insert(rawObservation)
          .values({
            entityId,
            sourceId: 'reddit',
            sourceEventId: post.id,
            eventType: 'mention',
            payload: {
              title: post.title,
              url: post.url,
              subreddit: sub,
              score: post.score,
              num_comments: post.num_comments,
              author: post.author,
              is_self: post.is_self,
              permalink: `https://reddit.com${post.permalink}`,
            },
            observedAt: new Date(post.created_utc * 1000),
          })
          .onConflictDoNothing()

        itemsIngested++
      } catch (err) {
        errors.push(`post ${post.id}: ${String(err)}`)
      }
    }
  }

  return { ok: errors.length === 0, itemsIngested, errors }
}
