import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

type EventStat = {
  event: string
  poolType: string
  ageName: string
  myBestTime: number
  myBestDisplay: string
  avgTime: number
  stdDev: number
  deviation: number
  overallRank: number
  totalParticipants: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const athleteId = Number(searchParams.get('athleteId'))
  if (!Number.isInteger(athleteId) || athleteId <= 0) {
    return NextResponse.json({ eventStats: [] })
  }

  const { data: athlete } = await supabaseServer
    .from('dt_player_person')
    .select('id, gender')
    .eq('id', athleteId)
    .maybeSingle()
  if (!athlete) return NextResponse.json({ eventStats: [] })

  const { data: myResults } = await supabaseServer
    .from('dt_result_person')
    .select(
      'category_id, age_id, time_display, time_seconds, mst_event!inner(pool_type), mst_category!inner(name), mst_age!inner(name)',
    )
    .eq('player_id', athleteId)
    .not('time_seconds', 'is', null)
    .not('rank', 'is', null)

  if (!myResults?.length) return NextResponse.json({ eventStats: [] })

  const myBests = new Map<
    string,
    { categoryId: number; ageId: number; poolType: string; eventName: string; ageName: string; bestTime: number; bestDisplay: string }
  >()
  for (const r of myResults) {
    const ev = r.mst_event as unknown as { pool_type: string }
    const cat = r.mst_category as unknown as { name: string }
    const age = r.mst_age as unknown as { name: string }
    const t = Number(r.time_seconds)
    if (!Number.isFinite(t) || t <= 0) continue
    const key = `${r.category_id}:${r.age_id}:${ev.pool_type}`
    const existing = myBests.get(key)
    if (!existing || t < existing.bestTime) {
      myBests.set(key, {
        categoryId: r.category_id,
        ageId: r.age_id,
        poolType: ev.pool_type,
        eventName: cat.name,
        ageName: age.name,
        bestTime: t,
        bestDisplay: r.time_display ?? '',
      })
    }
  }

  if (myBests.size === 0) return NextResponse.json({ eventStats: [] })

  const categoryIds = [...new Set([...myBests.values()].map((v) => v.categoryId))]
  const ageIds = [...new Set([...myBests.values()].map((v) => v.ageId))]

  const { data: allResults } = await supabaseServer
    .from('dt_result_person')
    .select(
      'player_id, category_id, age_id, time_seconds, mst_event!inner(pool_type), dt_player_person!inner(gender)',
    )
    .eq('dt_player_person.gender', athlete.gender)
    .in('category_id', categoryIds)
    .in('age_id', ageIds)
    .not('time_seconds', 'is', null)
    .not('rank', 'is', null)

  const allBests = new Map<string, Map<number, number>>()
  for (const r of allResults ?? []) {
    const ev = r.mst_event as unknown as { pool_type: string }
    const key = `${r.category_id}:${r.age_id}:${ev.pool_type}`
    if (!myBests.has(key)) continue
    const t = Number(r.time_seconds)
    if (!Number.isFinite(t) || t <= 0) continue
    const playerMap = allBests.get(key) ?? new Map<number, number>()
    const existing = playerMap.get(Number(r.player_id))
    if (existing === undefined || t < existing) playerMap.set(Number(r.player_id), t)
    allBests.set(key, playerMap)
  }

  const eventStats: EventStat[] = []
  for (const [key, myBest] of myBests.entries()) {
    const playerTimes = [...(allBests.get(key)?.values() ?? [])]
    const n = playerTimes.length
    if (n < 1) continue
    const avg = playerTimes.reduce((s, t) => s + t, 0) / n
    const variance = n > 1 ? playerTimes.reduce((s, t) => s + (t - avg) ** 2, 0) / n : 0
    const stdDev = Math.sqrt(variance)
    const deviation = stdDev > 0 ? 50 + 10 * (avg - myBest.bestTime) / stdDev : 50
    const overallRank = playerTimes.filter((t) => t < myBest.bestTime).length + 1
    eventStats.push({
      event: myBest.eventName,
      poolType: myBest.poolType,
      ageName: myBest.ageName,
      myBestTime: myBest.bestTime,
      myBestDisplay: myBest.bestDisplay,
      avgTime: Math.round(avg * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      deviation: Math.round(deviation * 10) / 10,
      overallRank,
      totalParticipants: n,
    })
  }

  return NextResponse.json({
    eventStats: eventStats.sort((a, b) => a.overallRank - b.overallRank || a.event.localeCompare(b.event, 'ja')),
  })
}
