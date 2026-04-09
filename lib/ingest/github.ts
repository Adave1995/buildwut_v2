import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

// gitterapp.com mirrors GitHub Trending — no auth required
const GITTERAPP_URL = 'https://api.gitterapp.com/repositories?since=daily'

type GitterRepo = {
  author: string
  name: string
  url: string
  description: string
  language: string
  stars: number
  forks: number
  currentPeriodStars: number
}

type GithubSearchItem = {
  id: number
  full_name: string
  name: string
  description: string | null
  html_url: string
  stargazers_count: number
  forks_count: number
  language: string | null
  owner: { login: string }
}

type GithubSearchResponse = {
  items: GithubSearchItem[]
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoString(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function fetchViaGitterapp(): Promise<GitterRepo[]> {
  const res = await fetch(GITTERAPP_URL, {
    headers: { 'User-Agent': 'buildwut/0.1 (personal tool)' },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`gitterapp returned ${res.status}`)
  return res.json() as Promise<GitterRepo[]>
}

async function fetchViaGithubSearch(): Promise<GitterRepo[]> {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN
  const url = `https://api.github.com/search/repositories?q=stars:>50+created:>${daysAgoString(7)}&sort=stars&order=desc&per_page=25`
  const headers: Record<string, string> = {
    'User-Agent': 'buildwut/0.1 (personal tool)',
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) headers['Authorization'] = `token ${token}`

  const res = await fetch(url, { headers, next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`GitHub Search returned ${res.status}`)
  const data = (await res.json()) as GithubSearchResponse
  return data.items.map((item) => ({
    author: item.owner.login,
    name: item.name,
    url: item.html_url,
    description: item.description ?? '',
    language: item.language ?? '',
    stars: item.stargazers_count,
    forks: item.forks_count,
    currentPeriodStars: 0,
  }))
}

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0
  const today = todayString()

  let repos: GitterRepo[]
  try {
    repos = await fetchViaGitterapp()
  } catch (primaryErr) {
    errors.push(`gitterapp failed (${String(primaryErr)}); falling back to GitHub Search`)
    try {
      repos = await fetchViaGithubSearch()
    } catch (fallbackErr) {
      return { ok: false, itemsIngested: 0, errors: [...errors, String(fallbackErr)] }
    }
  }

  for (const repo of repos) {
    try {
      const repoPath = `${repo.author}/${repo.name}`

      let entityId: string | null = null
      try {
        entityId = await resolveEntity({
          name: repo.name,
          url: repo.url,
          description: repo.description,
          externalIds: { github: repoPath },
        })
      } catch (resolveErr) {
        errors.push(`resolve ${repoPath}: ${String(resolveErr)}`)
      }

      await db
        .insert(rawObservation)
        .values({
          entityId,
          sourceId: 'github',
          sourceEventId: `${repoPath}:${today}`,
          eventType: 'mention',
          payload: {
            repo: repoPath,
            url: repo.url,
            description: repo.description,
            language: repo.language,
            stars: repo.stars,
            forks: repo.forks,
            current_period_stars: repo.currentPeriodStars,
          },
          observedAt: new Date(),
        })
        .onConflictDoNothing()

      itemsIngested++
    } catch (err) {
      errors.push(`repo ${repo.author}/${repo.name}: ${String(err)}`)
    }
  }

  return { ok: errors.length === 0, itemsIngested, errors }
}
