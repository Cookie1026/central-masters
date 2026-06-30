import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const course = searchParams.get('course') // 短水路 | 長水路 | null(両方)

  const buildQuery = (tableName: string) =>
    supabaseServer
      .from(tableName)
      .select('id, course, gender, event, distance, age_group, is_relay, name_team_raw, athlete_name, team_name, record, established_date')
      .order('gender')
      .order('event')
      .order('distance')
      .order('age_group', { ascending: true })

  if (course === '短水路' || course === '長水路') {
    const table = course === '長水路' ? 'mst_record_tournament_long' : 'mst_record_tournament_short'
    const { data, error } = await buildQuery(table)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ records: data ?? [] })
  }

  // 両方取得
  const [shortResult, longResult] = await Promise.all([
    buildQuery('mst_record_tournament_short'),
    buildQuery('mst_record_tournament_long'),
  ])
  const error = shortResult.error ?? longResult.error
  if (error && error.message.includes('schema cache')) return NextResponse.json({ records: shortResult.data ?? [] })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ records: [...(shortResult.data ?? []), ...(longResult.data ?? [])] })
}
