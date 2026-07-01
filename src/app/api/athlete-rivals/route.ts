import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

type RivalRow = {
  id: number
  name: string
  gender: string
  teamName: string
  sharedEvents: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const athleteId = Number(searchParams.get('athleteId'))
  if (!Number.isInteger(athleteId) || athleteId <= 0) {
    return NextResponse.json({ rivals: [] })
  }

  const [{ data: athlete }, { data: targetResults }] = await Promise.all([
    supabaseServer
      .from('dt_player_person')
      .select('id, gender')
      .eq('id', athleteId)
      .maybeSingle(),
    supabaseServer
      .from('dt_result_person')
      .select('category_id, age_id, mst_event!inner(pool_type)')
      .eq('player_id', athleteId),
  ])
  if (!athlete || !targetResults?.length) return NextResponse.json({ rivals: [] })

  const categoryIds = [...new Set(targetResults.map((row) => row.category_id))]
  const ageIds = [...new Set(targetResults.map((row) => row.age_id))]
  const targetKeys = new Set(
    targetResults.map((row) => {
      const event = row.mst_event as unknown as { pool_type: string }
      return `${row.category_id}:${row.age_id}:${event.pool_type}`
    }),
  )

  const { data: candidateResults, error } = await supabaseServer
    .from('dt_result_person')
    .select('player_id, category_id, age_id, mst_event!inner(pool_type), dt_player_person!inner(id, name, gender, mst_team!inner(name))')
    .neq('player_id', athleteId)
    .eq('dt_player_person.gender', athlete.gender)
    .in('category_id', categoryIds)
    .in('age_id', ageIds)
  if (error) return NextResponse.json({ rivals: [], error: error.message }, { status: 500 })

  const rivals = new Map<number, RivalRow & { sharedKeys: Set<string> }>()
  for (const row of candidateResults ?? []) {
    const event = row.mst_event as unknown as { pool_type: string }
    const key = `${row.category_id}:${row.age_id}:${event.pool_type}`
    if (!targetKeys.has(key)) continue
    const player = row.dt_player_person as unknown as {
      id: number
      name: string
      gender: string
      mst_team: { name: string }
    }
    const current = rivals.get(player.id) ?? {
      id: player.id,
      name: player.name,
      gender: player.gender,
      teamName: player.mst_team.name,
      sharedEvents: 0,
      sharedKeys: new Set<string>(),
    }
    current.sharedKeys.add(key)
    current.sharedEvents = current.sharedKeys.size
    rivals.set(player.id, current)
  }

  return NextResponse.json({
    rivals: [...rivals.values()]
      .sort((a, b) => b.sharedEvents - a.sharedEvents || a.name.localeCompare(b.name, 'ja'))
      .slice(0, 120)
      .map(({ sharedKeys: _sharedKeys, ...rival }) => rival),
  })
}
