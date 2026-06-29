import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const course = searchParams.get('course') // 短水路 | 長水路

  let query = supabaseServer
    .from('mst_record_tournament')
    .select('id, course, gender, event, distance, age_group, is_relay, name_team_raw, athlete_name, team_name, record, established_date')
    .order('gender')
    .order('event')
    .order('distance')
    .order('age_group', { ascending: true })

  if (course) query = query.eq('course', course)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ records: data ?? [] })
}
