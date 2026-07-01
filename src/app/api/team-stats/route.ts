import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const athleteId = Number(searchParams.get('athleteId'))
  if (!Number.isInteger(athleteId) || athleteId <= 0) {
    return NextResponse.json({ members: [] })
  }

  const { data: athlete } = await supabaseServer
    .from('dt_player_person')
    .select('id, mst_team!inner(id, name)')
    .eq('id', athleteId)
    .maybeSingle()
  if (!athlete) return NextResponse.json({ members: [] })

  const team = athlete.mst_team as unknown as { id: number; name: string }

  const { data: members } = await supabaseServer
    .from('dt_player_person')
    .select('id, name')
    .eq('team_id', team.id)
  if (!members?.length) return NextResponse.json({ teamName: team.name, members: [] })

  const memberIds = members.map((m) => m.id)

  const [{ data: indResults }, { data: relayMemberData }] = await Promise.all([
    supabaseServer
      .from('dt_result_person')
      .select('player_id, points')
      .in('player_id', memberIds)
      .not('points', 'is', null),
    supabaseServer
      .from('dt_player_relay')
      .select('player_id, relay_result_id')
      .in('player_id', memberIds),
  ])

  const pointsMap = new Map<number, number>()
  for (const r of indResults ?? []) {
    pointsMap.set(Number(r.player_id), (pointsMap.get(Number(r.player_id)) ?? 0) + Number(r.points))
  }

  if (relayMemberData?.length) {
    const relayIds = [...new Set(relayMemberData.map((r) => r.relay_result_id))]
    const { data: relayResults } = await supabaseServer
      .from('dt_result_relay')
      .select('id, team_points')
      .in('id', relayIds)
      .not('team_points', 'is', null)
    const relayPtsMap = new Map((relayResults ?? []).map((r) => [r.id, Number(r.team_points)]))
    for (const rm of relayMemberData) {
      const pts = (relayPtsMap.get(rm.relay_result_id) ?? 0) / 4
      pointsMap.set(Number(rm.player_id), (pointsMap.get(Number(rm.player_id)) ?? 0) + pts)
    }
  }

  const ranked = members
    .map((m) => ({ id: m.id, name: m.name, totalPoints: Math.round((pointsMap.get(m.id) ?? 0) * 10) / 10 }))
    .filter((m) => m.totalPoints > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((m, i) => ({ ...m, rank: i + 1 }))

  return NextResponse.json({ teamName: team.name, members: ranked })
}
