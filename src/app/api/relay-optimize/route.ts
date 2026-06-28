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

  // 1. mst_medley_relay マスター取得（メドレーリレーのみ: 泳順 → ストローク対応表）
  const { data: relayMaster } = await supabaseServer
    .from('mst_medley_relay')
    .select('relay_stroke, swim_order, stroke')
    .order('swim_order', { ascending: true })

  // relay_stroke → Map<swim_order, stroke>
  const relayOrderMap = new Map<string, Map<number, string>>()
  for (const row of (relayMaster ?? [])) {
    if (!relayOrderMap.has(row.relay_stroke)) {
      relayOrderMap.set(row.relay_stroke, new Map())
    }
    relayOrderMap.get(row.relay_stroke)!.set(row.swim_order, row.stroke)
  }

  // 2. このチームの実際のリレー結果を取得
  const { data: actualRelays, error: relayError } = await supabaseServer
    .from('dt_result_relay')
    .select(`
      id, rank, time_seconds, time_display, team_points,
      age_group_label, combined_age,
      mst_category!inner(id, name, stroke, distance),
      mst_age(id, name, min_age, max_age),
      dt_player_relay(
        id, swim_order, split_seconds,
        dt_player_person!inner(id, name, gender)
      )
    `)
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .order('rank', { ascending: true })

  if (relayError) {
    return NextResponse.json({ error: relayError.message }, { status: 500 })
  }

  // 3. 同大会の全リレー結果（順位予測用）
  const { data: allRelays } = await supabaseServer
    .from('dt_result_relay')
    .select('rank, time_seconds, category_id, age_group_label, combined_age')
    .eq('event_id', eventId)
    .order('rank', { ascending: true })

  // 4. このチームの全個人結果
  const { data: individualResults } = await supabaseServer
    .from('dt_result_person')
    .select(`
      rank, time_seconds, time_display, points,
      dt_player_person!inner(id, name, gender),
      mst_category!inner(id, name, stroke, distance)
    `)
    .eq('event_id', eventId)
    .eq('team_id', teamId)

  // relay ranking maps per (category_id, age_group_label)
  const relayFieldMap = new Map<string, { rank: number; time_seconds: number }[]>()
  for (const r of (allRelays ?? [])) {
    const key = `${r.category_id}:${r.age_group_label}`
    if (!relayFieldMap.has(key)) relayFieldMap.set(key, [])
    if (r.rank != null && r.time_seconds != null) {
      relayFieldMap.get(key)!.push({ rank: r.rank, time_seconds: Number(r.time_seconds) })
    }
  }

  // stroke → seconds の個人ベストタイムマップ (playerId → Map<stroke, seconds>)
  const indBestByPlayer = new Map<number, Map<string, number>>()
  for (const ind of (individualResults ?? [])) {
    const p = ind.dt_player_person as unknown as { id: number; name: string }
    const indStroke = (ind.mst_category as { stroke?: string }).stroke ?? ''
    const t = Number(ind.time_seconds ?? 0)
    if (!t) continue
    if (!indBestByPlayer.has(p.id)) indBestByPlayer.set(p.id, new Map())
    const existing = indBestByPlayer.get(p.id)!.get(indStroke)
    if (!existing || t < existing) indBestByPlayer.get(p.id)!.set(indStroke, t)
  }

  const optimizations = (actualRelays ?? []).map((relay) => {
    const members = ((relay.dt_player_relay ?? []) as unknown) as {
      id: number
      swim_order: number
      split_seconds: number | null
      dt_player_person: { id: number; name: string; gender: string }
    }[]
    const sortedMembers = [...members].sort((a, b) => a.swim_order - b.swim_order)

    const actualTeamTime = Number(relay.time_seconds ?? 0)
    const actualRank = relay.rank
    const categoryId = (relay.mst_category as unknown as { id: number; name: string }).id
    const categoryName = (relay.mst_category as unknown as { id: number; name: string }).name
    const relayStroke = (relay.mst_category as unknown as { stroke?: string }).stroke ?? ''
    const distance = (relay.mst_category as unknown as { distance?: number }).distance ?? 0
    const ageGroup = relay.age_group_label
    const fieldKey = `${categoryId}:${ageGroup}`
    const field = relayFieldMap.get(fieldKey) ?? []

    // リレー人数をカテゴリ名から解析
    const relayCountMatch = categoryName.match(/^(\d+)[×x]/)
    const relayCount = relayCountMatch ? parseInt(relayCountMatch[1], 10) : 4

    // mst_relay からこのリレー種別の泳順→ストローク対応を取得
    const strokeByOrder = relayOrderMap.get(relayStroke)
    const legDistance = distance / relayCount

    // 各泳順の候補者を収集
    // - 実際にリレーを泳いだ選手（split_seconds 使用）
    // - 同ストロークの個人種目を泳いだ選手（individual time 使用）
    type Candidate = {
      id: number
      name: string
      gender: string
      seconds: number
      source: 'relay' | 'individual'
    }

    const buildCandidatesForOrder = (order: number): Candidate[] => {
      // この泳順に必要なストローク
      const fallbackStroke = relayStroke.replace(/リレー.*$/, '').replace(/（混合）/, '').trim() || '自由形'
      const requiredStroke = strokeByOrder?.get(order) ?? fallbackStroke
      const candidateMap = new Map<number, Candidate>()

      // リレースプリットタイムを持つ実際のメンバー
      for (const m of sortedMembers) {
        if (m.swim_order !== order) continue
        const t = Number(m.split_seconds ?? 0)
        if (!t) continue
        candidateMap.set(m.dt_player_person.id, {
          id: m.dt_player_person.id,
          name: m.dt_player_person.name,
          gender: m.dt_player_person.gender,
          seconds: t,
          source: 'relay',
        })
      }

      // 同ストローク・同距離の個人タイムを持つ選手（より速ければ上書き）
      for (const ind of (individualResults ?? [])) {
        const indStroke = (ind.mst_category as { stroke?: string }).stroke ?? ''
        const indDist = (ind.mst_category as { distance?: number }).distance ?? 0
        if (indStroke !== requiredStroke || indDist !== legDistance) continue
        const p = ind.dt_player_person as unknown as { id: number; name: string; gender: string }
        const t = Number(ind.time_seconds ?? 0)
        if (!t) continue
        const existing = candidateMap.get(p.id)
        if (!existing || t < existing.seconds) {
          candidateMap.set(p.id, {
            id: p.id, name: p.name, gender: p.gender,
            seconds: t, source: 'individual',
          })
        }
      }

      return [...candidateMap.values()].filter((c) => c.seconds > 0)
    }

    // 全泳順の候補者リストを構築
    const candidatesPerOrder: Candidate[][] = Array.from({ length: relayCount }, (_, i) =>
      buildCandidatesForOrder(i + 1)
    )

    // 最適割当: 全泳順の候補から各選手を1回ずつ使って最速組み合わせを探索
    // 再帰的に全組み合わせを試す（チームサイズが小さいため現実的）
    type Assignment = { order: number; candidate: Candidate }[]

    let bestTime = Infinity
    let bestAssignment: Assignment = []

    function search(orderIdx: number, usedIds: Set<number>, current: Assignment) {
      if (orderIdx === relayCount) {
        const total = current.reduce((s, a) => s + a.candidate.seconds, 0)
        if (total < bestTime) {
          bestTime = total
          bestAssignment = [...current]
        }
        return
      }
      const candidates = candidatesPerOrder[orderIdx].filter((c) => !usedIds.has(c.id))
      if (candidates.length === 0) {
        // この泳順に候補なし → 組み合わせ不成立
        return
      }
      // 上位5人までに絞って計算量を抑える
      const top = candidates.sort((a, b) => a.seconds - b.seconds).slice(0, 5)
      for (const c of top) {
        usedIds.add(c.id)
        current.push({ order: orderIdx + 1, candidate: c })
        search(orderIdx + 1, usedIds, current)
        current.pop()
        usedIds.delete(c.id)
      }
    }

    search(0, new Set(), [])

    // 候補ゼロの泳順があった場合は実測メンバーで代用
    if (bestAssignment.length < relayCount) {
      bestTime = actualTeamTime
      bestAssignment = sortedMembers.map((m) => ({
        order: m.swim_order,
        candidate: {
          id: m.dt_player_person.id,
          name: m.dt_player_person.name,
          gender: m.dt_player_person.gender,
          seconds: Number(m.split_seconds ?? 0),
          source: 'relay' as const,
        },
      }))
    }

    // 最適タイムで何位になれるか予測
    const fieldSorted = [...field].sort((a, b) => a.time_seconds - b.time_seconds)
    let optimalRank = fieldSorted.length + 1
    for (let i = 0; i < fieldSorted.length; i++) {
      if (bestTime <= fieldSorted[i].time_seconds) { optimalRank = i + 1; break }
    }

    const rankToPoints = (r: number) => Math.max(0, 11 - r)
    const actualPoints = rankToPoints(actualRank ?? 99)
    const optimalPoints = rankToPoints(optimalRank)
    const pointsGain = optimalPoints - actualPoints

    const actualMemberIds = new Set(sortedMembers.map((m) => m.dt_player_person.id))
    const isCurrentOptimal = bestAssignment.length === relayCount &&
      bestAssignment.every((a) => actualMemberIds.has(a.candidate.id))

    // 泳順→ストローク名のラベル（表示用）
    const getStrokeLabel = (order: number) =>
      strokeByOrder?.get(order) ?? '自由形'

    return {
      categoryName,
      ageGroup,
      relayStroke,
      actualRank,
      actualTeamTime,
      actualPoints,
      actualMembers: sortedMembers.map((m) => ({
        swim_order: m.swim_order,
        stroke: getStrokeLabel(m.swim_order),
        name: m.dt_player_person.name,
        splitSeconds: m.split_seconds,
      })),
      optimalRank,
      optimalTime: bestTime,
      optimalPoints,
      optimalMembers: bestAssignment
        .sort((a, b) => a.order - b.order)
        .map((a) => ({
          swim_order: a.order,
          stroke: getStrokeLabel(a.order),
          name: a.candidate.name,
          splitSeconds: a.candidate.seconds,
          source: a.candidate.source,
        })),
      pointsGain,
      isCurrentOptimal,
      candidatesPerOrder: candidatesPerOrder.map((cs, i) => ({
        order: i + 1,
        stroke: getStrokeLabel(i + 1),
        count: cs.length,
      })),
    }
  })

  const totalActualPoints = optimizations.reduce((s, o) => s + o.actualPoints, 0)
  const totalOptimalPoints = optimizations.reduce((s, o) => s + o.optimalPoints, 0)
  const totalGain = totalOptimalPoints - totalActualPoints

  const { data: teamRankData } = await supabaseServer
    .from('dt_ranking_team')
    .select('rank, total_points, mst_team(name)')
    .eq('event_id', eventId)
    .order('rank', { ascending: true })

  return NextResponse.json({
    optimizations,
    totalActualPoints,
    totalOptimalPoints,
    totalGain,
    teamRankings: (teamRankData ?? []).slice(0, 20),
  })
}
