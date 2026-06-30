import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')
  const team = searchParams.get('team')
  const teamIdsParam = searchParams.get('teamIds')
  const athleteId = searchParams.get('athleteId')
  const categoryId = searchParams.get('categoryId')
  const categoryIdsParam = searchParams.get('categoryIds')
  const gender = searchParams.get('gender')
  const ageId = searchParams.get('ageId')
  const rank = searchParams.get('rank')
  const recordType = searchParams.get('recordType')

  // Filter through the joined athlete row instead of resolving athlete IDs
  // first. The preliminary select was capped at 1,000 rows by PostgREST,
  // which silently removed valid competitors from gender-wide rankings.
  const teamIds = (teamIdsParam ?? '')
    .split(',')
    .map((id) => parseInt(id))
    .filter((id) => Number.isFinite(id))
  if (teamIds.length === 0 && team) {
    const { data: td } = await supabaseServer
      .from('mst_team')
      .select('id')
      .eq('name', team)
      .single()
    if (!td) return NextResponse.json({ results: [] })
    teamIds.push(td.id)
  }

  let query = supabaseServer
    .from('dt_result_person')
    .select(`
      id, rank, time_display, time_seconds, dive_time, points, is_meet_record, is_japan_record, is_world_record, lane, meet_record_seconds,
      player_id,
      dt_player_person!inner(name, gender, mst_team!inner(name)),
      mst_category!inner(name, distance),
      mst_age!inner(name),
      mst_event!inner(round, pool_type)
    `)
    .order('time_seconds', { ascending: true, nullsFirst: false })
    .limit(2000)

  if (eventId) query = query.eq('event_id', parseInt(eventId))
  if (athleteId) query = query.eq('player_id', parseInt(athleteId))
  if (teamIds.length > 0) query = query.in('dt_player_person.team_id', teamIds)
  if (gender) query = query.eq('dt_player_person.gender', gender)
  const categoryIds = (categoryIdsParam ?? '')
    .split(',')
    .map((id) => parseInt(id))
    .filter((id) => Number.isFinite(id))
  if (categoryIds.length > 0) query = query.in('category_id', categoryIds)
  else if (categoryId) query = query.eq('category_id', parseInt(categoryId))
  if (ageId) query = query.eq('age_id', parseInt(ageId))
  if (rank) query = query.eq('rank', parseInt(rank))
  if (recordType === '大会新') query = query.eq('is_meet_record', true).eq('is_japan_record', false).eq('is_world_record', false)
  else if (recordType === '日本新') query = query.eq('is_japan_record', true)
  else if (recordType === '世界新') query = query.eq('is_world_record', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ results: [], error: error.message })
  return NextResponse.json({ results: data ?? [] })
}
