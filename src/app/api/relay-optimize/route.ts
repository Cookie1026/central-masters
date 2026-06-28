import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventIdParam = searchParams.get('eventId')
  const teamId = searchParams.get('teamId')

  if (!eventIdParam || !teamId) {
    return NextResponse.json({ error: 'eventId and teamId are required' }, { status: 400 })
  }
  const eventId = Number(eventIdParam)

  // 1. Get the team's actual relay results for this event
  const { data: actualRelays, error: relayError } = await supabaseServer
    .from('dt_result_relay')
    .select(`
      id, rank, time_seconds, time_display, team_points,
      age_group_label, combined_age,
      mst_category!inner(id, name, stroke, distance, relay_count),
      mst_age(id, name, min_age, max_age),
      dt_player_relay(
        id, swim_order, split_seconds,
        dt_player_person!inner(id, name, gender, birth_year)
      )
    `)
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .order('rank', { ascending: true })

  if (relayError) {
    return NextResponse.json({ error: relayError.message }, { status: 500 })
  }

  // 2. Get all relay results for this event (to know what ranks are possible)
  const { data: allRelays } = await supabaseServer
    .from('dt_result_relay')
    .select('rank, time_seconds, category_id, age_group_label, combined_age')
    .eq('event_id', eventId)
    .order('rank', { ascending: true })

  // 3. Get all individual results for this team in this event
  // to understand what athletes swam and their times per stroke/category
  const { data: individualResults } = await supabaseServer
    .from('dt_result_person')
    .select(`
      rank, time_seconds, time_display, points,
      dt_player_person!inner(id, name, gender, birth_year),
      mst_category!inner(id, name, stroke, distance)
    `)
    .eq('event_id', eventId)
    .eq('team_id', teamId)

  // Build relay ranking maps per (category_id, age_group_label)
  const relayFieldMap = new Map<string, { rank: number; time_seconds: number }[]>()
  for (const r of (allRelays ?? [])) {
    const key = `${r.category_id}:${r.age_group_label}`
    if (!relayFieldMap.has(key)) relayFieldMap.set(key, [])
    if (r.rank != null && r.time_seconds != null) {
      relayFieldMap.get(key)!.push({ rank: r.rank, time_seconds: Number(r.time_seconds) })
    }
  }

  // For each actual relay, compute "optimal" combination using split times
  const optimizations = (actualRelays ?? []).map((relay) => {
    const members = ((relay.dt_player_relay ?? []) as unknown) as {
      id: number
      swim_order: number
      split_seconds: number | null
      dt_player_person: { id: number; name: string; gender: string; birth_year: number | null }
    }[]

    const actualTeamTime = Number(relay.time_seconds ?? 0)
    const actualRank = relay.rank
    const categoryId = (relay.mst_category as unknown as { id: number; name: string }).id
    const categoryName = (relay.mst_category as unknown as { id: number; name: string }).name
    const ageGroup = relay.age_group_label
    const combinedAge = relay.combined_age

    // Get current year for age calculation
    const currentYear = 2026
    const fieldKey = `${categoryId}:${ageGroup}`
    const field = relayFieldMap.get(fieldKey) ?? []

    // Individual results for this event — find athletes with times in matching stroke
    const stroke = (relay.mst_category as unknown as { stroke?: string }).stroke ?? ''
    const distance = (relay.mst_category as unknown as { distance?: number }).distance ?? 0
    const relayCount = (relay.mst_category as unknown as { relay_count?: number }).relay_count ?? 4

    // Find athletes from this team who swam the individual equivalent stroke this event
    const equivalentAthletes = (individualResults ?? [])
      .filter((ind) => {
        const indStroke = (ind.mst_category as { stroke?: string }).stroke ?? ''
        const indDist = (ind.mst_category as { distance?: number }).distance ?? 0
        return indStroke === stroke && indDist === distance / relayCount
      })
      .map((ind) => {
        const p = ind.dt_player_person as unknown as { id: number; name: string; gender: string; birth_year: number | null }
        return {
          id: p.id,
          name: p.name,
          gender: p.gender,
          age: p.birth_year ? currentYear - p.birth_year : 0,
          splitSeconds: Number(ind.time_seconds ?? 0),
          source: 'individual' as const,
        }
      })

    // Also include athletes who actually swam this relay (use their split times)
    const actualMemberIds = new Set(members.map((m) => m.dt_player_person.id))
    const relayAthletes = members.map((m) => ({
      id: m.dt_player_person.id,
      name: m.dt_player_person.name,
      gender: m.dt_player_person.gender,
      age: m.dt_player_person.birth_year ? currentYear - m.dt_player_person.birth_year : 0,
      splitSeconds: Number(m.split_seconds ?? 0),
      source: 'relay' as const,
    }))

    type Candidate = { id: number; name: string; gender: string; age: number; splitSeconds: number; source: 'relay' | 'individual' }
    // Merge: prefer individual time if better, else use relay split
    const allCandidates = new Map<number, Candidate>()
    for (const a of relayAthletes) allCandidates.set(a.id, a)
    for (const a of equivalentAthletes) {
      const existing = allCandidates.get(a.id)
      if (!existing || (a.splitSeconds > 0 && a.splitSeconds < existing.splitSeconds)) {
        allCandidates.set(a.id, a)
      }
    }

    const candidates = [...allCandidates.values()].filter((a) => a.splitSeconds > 0)

    // Find best N-person combination satisfying age constraint (if combinedAge is set)
    // Age constraint: sum of (ages) must be close to combinedAge bracket
    let bestCombination: typeof candidates = []
    let bestTime = Infinity

    if (candidates.length < relayCount) {
      // Not enough candidates — use what we have
      bestCombination = candidates.slice(0, relayCount)
      bestTime = bestCombination.reduce((s, a) => s + a.splitSeconds, 0)
    } else {
      // Brute force (n choose relayCount) — n is typically small (< 15)
      const combos = combinations(candidates, relayCount)
      for (const combo of combos) {
        // Check age constraint if applicable
        if (combinedAge != null && combinedAge > 0) {
          const sumAge = combo.reduce((s, a) => s + a.age, 0)
          // Allow some flexibility: must be within the same bracket
          // We can't easily check the exact bracket without mst_age data,
          // so we approximate: sumAge should be close to combinedAge ± 40
          if (Math.abs(sumAge - combinedAge) > 40) continue
        }
        const totalTime = combo.reduce((s, a) => s + a.splitSeconds, 0)
        if (totalTime < bestTime) {
          bestTime = totalTime
          bestCombination = combo
        }
      }
      if (bestCombination.length === 0) {
        // No age-valid combo, fall back to fastest without constraint
        bestCombination = candidates.sort((a, b) => a.splitSeconds - b.splitSeconds).slice(0, relayCount)
        bestTime = bestCombination.reduce((s, a) => s + a.splitSeconds, 0)
      }
    }

    // What rank would the optimal time achieve?
    const fieldSorted = [...field].sort((a, b) => a.time_seconds - b.time_seconds)
    let optimalRank = fieldSorted.length + 1
    for (let i = 0; i < fieldSorted.length; i++) {
      if (bestTime <= fieldSorted[i].time_seconds) {
        optimalRank = i + 1
        break
      }
    }

    // Points calculation: 1st=10, 2nd=9, ... 10th=1, beyond=0
    const rankToPoints = (r: number) => Math.max(0, 11 - r)
    const actualPoints = rankToPoints(actualRank ?? 99)
    const optimalPoints = rankToPoints(optimalRank)
    const pointsGain = optimalPoints - actualPoints

    const isCurrentOptimal = actualMemberIds.size === relayCount &&
      bestCombination.every((a) => actualMemberIds.has(a.id))

    return {
      categoryName,
      ageGroup,
      actualRank,
      actualTeamTime,
      actualPoints,
      actualMembers: members.sort((a, b) => a.swim_order - b.swim_order).map((m) => ({
        name: m.dt_player_person.name,
        splitSeconds: m.split_seconds,
      })),
      optimalRank,
      optimalTime: bestTime,
      optimalPoints,
      optimalMembers: bestCombination.sort((a, b) => a.splitSeconds - b.splitSeconds).map((a) => ({
        name: a.name,
        splitSeconds: a.splitSeconds,
        source: a.source,
      })),
      pointsGain,
      isCurrentOptimal,
      candidatesCount: candidates.length,
    }
  })

  // Compute total points gain
  const totalActualPoints = optimizations.reduce((s, o) => s + o.actualPoints, 0)
  const totalOptimalPoints = optimizations.reduce((s, o) => s + o.optimalPoints, 0)
  const totalGain = totalOptimalPoints - totalActualPoints

  // Get team's actual ranking for this event
  const { data: teamRankData } = await supabaseServer
    .from('dt_ranking_team')
    .select('rank, total_points, mst_team(name)')
    .eq('event_id', eventId)
    .order('rank', { ascending: true })

  const teamRankRow = (teamRankData ?? []).find((r) => {
    const t = r.mst_team as unknown as { name: string } | null
    return t && String(t.name)
  })

  return NextResponse.json({
    optimizations,
    totalActualPoints,
    totalOptimalPoints,
    totalGain,
    teamRankings: (teamRankData ?? []).slice(0, 20),
  })
}

// Utility: generate all combinations of size k from array
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c])
  const withoutFirst = combinations(rest, k)
  return [...withFirst, ...withoutFirst]
}
