import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

const PH_TOKEN_URL = 'https://api.producthunt.com/v2/oauth/token'
const PH_GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql'

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PRODUCT_HUNT_API_KEY
  const clientSecret = process.env.PRODUCT_HUNT_API_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('PRODUCT_HUNT_API_KEY / PRODUCT_HUNT_API_SECRET not set')
  }

  const res = await fetch(PH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`PH token exchange failed: ${res.status}`)
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

type PhPost = {
  id: string
  name: string
  tagline: string
  description: string | null
  url: string
  website: string | null
  votesCount: number
  commentsCount: number
  createdAt: string
  thumbnail: { url: string } | null
  topics: { edges: Array<{ node: { name: string } }> }
}

type PhResponse = {
  data: {
    posts: {
      edges: Array<{ node: PhPost }>
    }
  }
}

const POSTS_QUERY = `
  query TodaysPosts($postedAfter: DateTime!) {
    posts(order: VOTES, postedAfter: $postedAfter, first: 20) {
      edges {
        node {
          id
          name
          tagline
          description
          url
          website
          votesCount
          commentsCount
          createdAt
          thumbnail { url }
          topics { edges { node { name } } }
        }
      }
    }
  }
`

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0

  let token: string
  try {
    token = await getAccessToken()
  } catch (err) {
    return { ok: false, itemsIngested: 0, errors: [String(err)] }
  }

  // Fetch posts from the last 24 hours
  const postedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let posts: PhPost[]
  try {
    const res = await fetch(PH_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'buildwut/0.1 (personal tool)',
      },
      body: JSON.stringify({
        query: POSTS_QUERY,
        variables: { postedAfter },
      }),
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`PH GraphQL returned ${res.status}`)
    const data = (await res.json()) as PhResponse
    posts = data.data.posts.edges.map((e) => e.node)
  } catch (err) {
    return { ok: false, itemsIngested: 0, errors: [String(err)] }
  }

  for (const post of posts) {
    try {
      const topics = post.topics.edges.map((e) => e.node.name)

      let entityId: string | null = null
      try {
        entityId = await resolveEntity({
          name: post.name,
          url: post.website ?? post.url,
          description: post.tagline,
          category: topics[0],
          externalIds: { producthunt: post.id },
        })
      } catch (resolveErr) {
        errors.push(`resolve PH ${post.id}: ${String(resolveErr)}`)
      }

      await db
        .insert(rawObservation)
        .values({
          entityId,
          sourceId: 'producthunt',
          sourceEventId: post.id,
          eventType: 'launch',
          payload: {
            name: post.name,
            tagline: post.tagline,
            description: post.description,
            url: post.url,
            website: post.website,
            votes: post.votesCount,
            comments: post.commentsCount,
            topics,
            thumbnail: post.thumbnail?.url ?? null,
          },
          observedAt: new Date(post.createdAt),
        })
        .onConflictDoNothing()

      itemsIngested++
    } catch (err) {
      errors.push(`PH post ${post.id}: ${String(err)}`)
    }
  }

  return { ok: errors.length === 0, itemsIngested, errors }
}
