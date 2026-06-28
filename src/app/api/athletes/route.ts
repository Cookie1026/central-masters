import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { AthleteOption } from '@/types'

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const team = searchParams.get('team')
  const teamIdsParam = searchParams.get('teamIds')
  const eventId = searchParams.get('eventId')

  if (!team && !teamIdsParam) return NextResponse.json([])

  let teamIds = (teamIdsParam ?? '')
    .split(',')
    .map((id) => parseInt(id))
    .filter((id) => Number.isFinite(id))

  if (teamIds.length === 0 && team) {
    const { data: teamData } = await supabaseServer
      .from('mst_team')
      .select('id')
      .eq('name', team)
      .single()
    if (!teamData) return NextResponse.json([])
    teamIds = [teamData.id]
  }

  const [{ data: athletes }, { data: aliasData }] = await Promise.all([
    supabaseServer
      .from('dt_player_person')
      .select('id, name, gender')
      .in('team_id', teamIds),
    supabaseServer
      .from('mst_player_alias')
      .select('alias'),
  ])

  if (!athletes?.length) return NextResponse.json([])

  // エイリアス（OCR誤読名）は一覧に表示しない
  const aliasNames = new Set((aliasData ?? []).map((a: { alias: string }) => a.alias))
  const filteredAthletes = aliasNames.size > 0
    ? athletes.filter((a) => !aliasNames.has(a.name))
    : athletes

  if (eventId) {
    const athleteIdList = filteredAthletes.map((a) => a.id)

    const [{ data: results }, { data: playerPoints }] = await Promise.all([
      supabaseServer
        .from('dt_result_person')
        .select('player_id, mst_age!inner(name, min_age)')
        .eq('event_id', parseInt(eventId))
        .in('player_id', athleteIdList),
      supabaseServer
        .from('v_player_point')
        .select('player_id, total_points')
        .eq('event_id', parseInt(eventId))
        .in('player_id', athleteIdList),
    ])

    const ageMap = new Map<number, { name: string; min_age: number }>()
    for (const r of results ?? []) {
      const age = r.mst_age as unknown as { name: string; min_age: number }
      const minAge = age.min_age
      const existing = ageMap.get(r.player_id)
      if (existing === undefined || minAge < existing.min_age) ageMap.set(r.player_id, age)
    }

    const pointsMap = new Map(
      (playerPoints ?? []).map((row) => [row.player_id, toNumber(row.total_points)]),
    )

    // 現在の大会で個人成績がない選手（リレーのみ等）→ 過去の大会から年齢区分を補完
    const missingAgeIds = athleteIdList.filter((id) => !ageMap.has(id))
    if (missingAgeIds.length > 0) {
      const { data: fallback } = await supabaseServer
        .from('dt_result_person')
        .select('player_id, mst_age!inner(name, min_age)')
        .in('player_id', missingAgeIds)
      for (const r of fallback ?? []) {
        const age = r.mst_age as unknown as { name: string; min_age: number }
        const existing = ageMap.get(r.player_id)
        // より高い年齢区分（新しい方）を使う
        if (existing === undefined || age.min_age > existing.min_age) {
          ageMap.set(r.player_id, age)
        }
      }
    }

    for (const a of filteredAthletes) {
      const age = ageMap.get(a.id)
      ;(a as AthleteOption).age_name = age?.name ?? null
      ;(a as AthleteOption).min_age = age?.min_age ?? null
      ;(a as AthleteOption).total_points = pointsMap.get(a.id) ?? 0
    }

    filteredAthletes.sort((a, b) => {
      const ageA = ageMap.get(a.id)?.min_age ?? 999
      const ageB = ageMap.get(b.id)?.min_age ?? 999
      if (ageA !== ageB) return ageA - ageB
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender)
      return a.name.localeCompare(b.name, 'ja')
    })
  } else {
    filteredAthletes.sort((a, b) => {
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender)
      return a.name.localeCompare(b.name, 'ja')
    })
  }

  return NextResponse.json(filteredAthletes as AthleteOption[])
}
