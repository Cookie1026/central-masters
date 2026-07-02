import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')

  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
  }

  const { data, error } = await supabaseServer
    .from('dt_result_relay')
    .select(`
      id, rank, time_seconds,
      mst_event!inner(id, round),
      mst_category!inner(id, name)
    `)
    .eq('team_id', teamId)
    .not('time_seconds', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ relays: data ?? [] })
}
