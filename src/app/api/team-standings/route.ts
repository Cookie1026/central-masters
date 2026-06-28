import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventIdParam = searchParams.get('eventId')
  const eventId = eventIdParam ? Number(eventIdParam) : null

  if (eventId !== null && (!Number.isInteger(eventId) || eventId <= 0)) {
    return NextResponse.json({ standings: [], error: 'eventId is invalid' }, { status: 400 })
  }

  let query = supabaseServer
    .from('dt_ranking_team')
    .select('rank, total_points, male_points, female_points, mixed_points, mst_team!inner(id, name), mst_event!inner(id, round, pool_type, date)')
    .order('rank', { ascending: true, nullsFirst: false })

  if (eventId !== null) query = query.eq('event_id', eventId)

  let calculatedQuery = supabaseServer
    .from('v_team_point_audit')
    .select('event_id, team_id, calculated_points')
  if (eventId !== null) calculatedQuery = calculatedQuery.eq('event_id', eventId)

  const [{ data, error }, { data: calculated, error: calculatedError }] = await Promise.all([
    query,
    calculatedQuery,
  ])

  if (error) {
    return NextResponse.json({ standings: [], error: error.message }, { status: 500 })
  }

  const calculatedMap = new Map(
    (calculated ?? []).map((row) => [
      `${row.event_id}:${row.team_id}`,
      row.calculated_points,
    ]),
  )
  const standings = (data ?? []).map((row) => {
    const team = row.mst_team as unknown as { id: number; name: string }
    const event = row.mst_event as unknown as { id: number }
    return {
      ...row,
      calculated_points: calculatedError
        ? null
        : calculatedMap.get(`${event.id}:${team.id}`) ?? 0,
    }
  })

  return NextResponse.json({
    standings,
    calculatedError: calculatedError?.message ?? null,
  })
}
