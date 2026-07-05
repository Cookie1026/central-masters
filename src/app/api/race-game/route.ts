import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

type RaceRow = {
  id: number
  event_id: number
  player_id: number
  category_id: number
  age_id: number
  race_number: number | null
  rank: number | null
  time_seconds: number | string | null
  time_display: string | null
  is_meet_record: boolean
  dt_player_person: {
    id: number
    name: string
    gender: string
    team_id: number
    mst_team: { id: number; name: string }
  }
  mst_category: {
    id: number
    name: string
    stroke: string | null
    distance: number | null
  }
  mst_age: { id: number; name: string }
  mst_event: { id: number; round: number; pool_type: string }
}

const selection = `
  id, event_id, player_id, category_id, age_id, race_number, rank,
  time_seconds, time_display, is_meet_record,
  dt_player_person!inner(id, name, gender, team_id, mst_team!inner(id, name)),
  mst_category!inner(id, name, stroke, distance),
  mst_age!inner(id, name),
  mst_event!inner(id, round, pool_type)
`

function flattenRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

function normalize(rows: unknown[]): RaceRow[] {
  return rows.map((raw) => {
    const row = raw as RaceRow
    const player = flattenRelation(row.dt_player_person)
    return {
      ...row,
      dt_player_person: {
        ...player,
        mst_team: flattenRelation(player.mst_team),
      },
      mst_category: flattenRelation(row.mst_category),
      mst_age: flattenRelation(row.mst_age),
      mst_event: flattenRelation(row.mst_event),
    }
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') ?? 'browse'
  const stroke = searchParams.get('stroke')
  const teamId = Number(searchParams.get('teamId') ?? 0)
  const name = searchParams.get('name')?.trim()
  const baseResultId = Number(searchParams.get('baseResultId') ?? 0)

  if (mode === 'near' && baseResultId) {
    const { data: base, error: baseError } = await supabaseServer
      .from('dt_result_person')
      .select('id, category_id, time_seconds')
      .eq('id', baseResultId)
      .maybeSingle()
    if (baseError || !base?.time_seconds) {
      return NextResponse.json({ results: [], error: baseError?.message ?? '基準記録が見つかりません' })
    }

    const target = Number(base.time_seconds)
    const { data, error } = await supabaseServer
      .from('dt_result_person')
      .select(selection)
      .eq('category_id', base.category_id)
      .eq('result_status', 'FINISHED')
      .not('time_seconds', 'is', null)
      .gte('time_seconds', Math.max(0, target - 30))
      .lte('time_seconds', target + 30)
      .limit(300)

    if (error) return NextResponse.json({ results: [], error: error.message }, { status: 500 })
    const rows = normalize((data ?? []) as unknown[])
      .filter((row) => row.id !== baseResultId)
      .sort((a, b) =>
        Math.abs(Number(a.time_seconds) - target) - Math.abs(Number(b.time_seconds) - target)
      )
      .slice(0, 40)
    return NextResponse.json({ results: rows })
  }

  if (mode === 'actual' && baseResultId) {
    const { data: base, error: baseError } = await supabaseServer
      .from('dt_result_person')
      .select('event_id, category_id, age_id, race_number')
      .eq('id', baseResultId)
      .maybeSingle()
    if (baseError || !base) {
      return NextResponse.json({ results: [], error: baseError?.message ?? '基準レースが見つかりません' })
    }

    let query = supabaseServer
      .from('dt_result_person')
      .select(selection)
      .eq('event_id', base.event_id)
      .eq('category_id', base.category_id)
      .eq('age_id', base.age_id)
      .eq('result_status', 'FINISHED')
      .not('time_seconds', 'is', null)
      .order('rank', { ascending: true })
      .limit(10)
    query = base.race_number == null
      ? query.is('race_number', null)
      : query.eq('race_number', base.race_number)
    const { data, error } = await query
    if (error) return NextResponse.json({ results: [], error: error.message }, { status: 500 })
    return NextResponse.json({ results: normalize((data ?? []) as unknown[]) })
  }

  let query = supabaseServer
    .from('dt_result_person')
    .select(selection)
    .eq('result_status', 'FINISHED')
    .not('time_seconds', 'is', null)
    .order('event_id', { ascending: false })
    .order('time_seconds', { ascending: true })
    .limit(400)

  if (stroke && stroke !== 'all') query = query.eq('mst_category.stroke', stroke)
  if (teamId) query = query.eq('dt_player_person.team_id', teamId)
  if (name) query = query.ilike('dt_player_person.name', `%${name}%`)
  if (mode === 'records') query = query.eq('is_meet_record', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ results: [], error: error.message }, { status: 500 })
  return NextResponse.json({ results: normalize((data ?? []) as unknown[]) })
}
