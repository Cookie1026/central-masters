import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

type AthleteScore = {
  playerId: number
  name: string
  gender: string
  points: number
  races: number
}

export async function GET() {
  const { data: teams, error: teamError } = await supabaseServer
    .from('mst_team')
    .select('id, name')
    .ilike('name', '%おおたか%')

  if (teamError) return NextResponse.json({ error: teamError.message }, { status: 500 })
  const teamIds = (teams ?? []).map((team) => team.id)
  if (teamIds.length === 0) return NextResponse.json({ athleteScores: [], totals: null })

  const [
    { data: individual, error: individualError },
    { data: relay, error: relayError },
    { data: official, error: officialError },
  ] =
    await Promise.all([
      supabaseServer
        .from('dt_result_person')
        .select('player_id, points, dt_player_person!inner(name, gender, team_id)')
        .in('dt_player_person.team_id', teamIds)
        .not('points', 'is', null),
      supabaseServer
        .from('dt_result_relay')
        .select('team_points, mst_category!inner(gender)')
        .in('team_id', teamIds)
        .not('team_points', 'is', null),
      supabaseServer
        .from('dt_ranking_team')
        .select('total_points')
        .in('team_id', teamIds),
    ])

  if (individualError) return NextResponse.json({ error: individualError.message }, { status: 500 })
  if (relayError) return NextResponse.json({ error: relayError.message }, { status: 500 })
  if (officialError) return NextResponse.json({ error: officialError.message }, { status: 500 })

  const athleteMap = new Map<number, AthleteScore>()
  const genderPoints: Record<string, number> = { 男子: 0, 女子: 0 }
  let individualPoints = 0

  for (const result of individual ?? []) {
    const player = result.dt_player_person as unknown as { name: string; gender: string }
    const points = Number(result.points ?? 0)
    if (!Number.isFinite(points) || points <= 0) continue
    individualPoints += points
    genderPoints[player.gender] = (genderPoints[player.gender] ?? 0) + points
    const current = athleteMap.get(result.player_id) ?? {
      playerId: result.player_id,
      name: player.name,
      gender: player.gender,
      points: 0,
      races: 0,
    }
    current.points += points
    current.races += 1
    athleteMap.set(result.player_id, current)
  }

  let relayPoints = 0
  const relayGenderPoints: Record<string, number> = { 男子: 0, 女子: 0, 混合: 0 }
  for (const result of relay ?? []) {
    const points = Number(result.team_points ?? 0)
    if (!Number.isFinite(points) || points <= 0) continue
    const category = result.mst_category as unknown as { gender: string }
    relayPoints += points
    relayGenderPoints[category.gender] = (relayGenderPoints[category.gender] ?? 0) + points
  }

  return NextResponse.json({
    athleteScores: [...athleteMap.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja')),
    totals: {
      individualPoints,
      relayPoints,
      officialPoints: (official ?? []).reduce((sum, row) => sum + Number(row.total_points ?? 0), 0),
      genderPoints,
      relayGenderPoints,
    },
  })
}
