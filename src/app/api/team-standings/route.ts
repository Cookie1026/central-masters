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
    .select('rank, total_points, male_points, female_points, mixed_points, mst_team!inner(name), mst_event!inner(id, round, pool_type, date)')
    .order('rank', { ascending: true, nullsFirst: false })

  if (eventId !== null) query = query.eq('event_id', eventId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ standings: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ standings: data ?? [] })
}
