import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')
  const team = searchParams.get('team')
  const teamIdsParam = searchParams.get('teamIds')
  const athleteId = searchParams.get('athleteId')
  const gender = searchParams.get('gender')
  const categoryIdsParam = searchParams.get('categoryIds')
  const ageGroupLabelParam = searchParams.get('ageGroupLabel')
  const rank = searchParams.get('rank')
  const recordType = searchParams.get('recordType')

  if (!eventId && !team && !teamIdsParam && !athleteId && !recordType) return NextResponse.json({ results: [] })

  let query = supabaseServer
    .from('dt_result_relay')
    .select(`
      id, rank, time_display, time_seconds, team_points, age_group_label, is_meet_record, meet_record_seconds,
      mst_team!inner(name),
      mst_category!inner(name, gender, stroke),
      mst_event!inner(round, pool_type),
      mst_age(name),
      dt_player_relay(swim_order, split_seconds, dive_time, player_id, is_meet_record, is_japan_record, is_world_record, dt_player_person(name, gender))
    `)
    .order('time_seconds', { ascending: true, nullsFirst: false })
    .limit(500)

  if (eventId) query = query.eq('event_id', parseInt(eventId))

  if (athleteId) {
    const { data: memberData } = await supabaseServer
      .from('dt_player_relay')
      .select('relay_result_id')
      .eq('player_id', parseInt(athleteId))
    const relayIds = memberData?.map((m) => m.relay_result_id) ?? []
    if (relayIds.length === 0) return NextResponse.json({ results: [] })
    query = query.in('id', relayIds)
  } else if (team || teamIdsParam) {
    const teamIds = (teamIdsParam ?? '')
      .split(',')
      .map((id) => parseInt(id))
      .filter((id) => Number.isFinite(id))
    if (teamIds.length > 0) {
      query = query.in('team_id', teamIds)
    } else if (team) {
    const { data: td } = await supabaseServer
      .from('mst_team')
      .select('id')
      .eq('name', team)
      .single()
    if (!td) return NextResponse.json({ results: [] })
    query = query.eq('team_id', td.id)
    }
  }

  if (categoryIdsParam) {
    const categoryIds = categoryIdsParam.split(',').map((id) => parseInt(id)).filter((id) => Number.isFinite(id))
    if (categoryIds.length > 0) query = query.in('category_id', categoryIds)
    // The UI groups the same relay name across genders, so categoryIds can
    // contain both the men's and women's category IDs. Keep the selected
    // gender constraint even when explicit category IDs were supplied.
    if (gender) query = query.eq('mst_category.gender', gender)
  } else if (gender) {
    const { data: cats } = await supabaseServer
      .from('mst_category')
      .select('id')
      .eq('type', 'リレー')
      .eq('gender', gender)
    const catIds = cats?.map((c) => c.id) ?? []
    if (catIds.length > 0) query = query.in('category_id', catIds)
    else return NextResponse.json({ results: [] })
  }

  if (ageGroupLabelParam) {
    // Older short-course imports use U+301C (〜), while the current UI uses
    // U+FF5E (～). Accept both so valid relay rows are not hidden.
    const ageGroupLabels = [
      ageGroupLabelParam,
      ageGroupLabelParam.replaceAll('～', '〜'),
      ageGroupLabelParam.replaceAll('〜', '～'),
    ]
    query = query.in('age_group_label', [...new Set(ageGroupLabels)])
  }
  if (rank) query = query.eq('rank', parseInt(rank))

  if (recordType === '大会新') {
    query = query.eq('is_meet_record', true)
  } else if (recordType === '日本新' || recordType === '世界新') {
    const flagCol = recordType === '日本新' ? 'is_japan_record' : 'is_world_record'
    const { data: memberRows } = await supabaseServer
      .from('dt_player_relay')
      .select('relay_result_id')
      .eq(flagCol, true)
    const relayIds = memberRows?.map((m) => m.relay_result_id) ?? []
    if (relayIds.length === 0) return NextResponse.json({ results: [] })
    query = query.in('id', relayIds)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ results: [], error: error.message })

  const { data: relayMaster } = await supabaseServer
    .from('mst_medley_relay')
    .select('relay_stroke, swim_order, stroke')

  const strokeByRelayOrder = new Map(
    (relayMaster ?? []).map((row) => [`${row.relay_stroke}:${row.swim_order}`, row.stroke]),
  )

  const results = (data ?? []).map((r) => {
    const category = Array.isArray(r.mst_category) ? r.mst_category[0] : r.mst_category
    return {
      ...r,
      dt_player_relay: [...(r.dt_player_relay ?? [])]
        .sort((a, b) => (a.swim_order ?? 0) - (b.swim_order ?? 0))
        .map((member) => ({
          ...member,
          stroke: strokeByRelayOrder.get(`${category?.stroke}:${member.swim_order}`)
            ?? (category?.stroke?.includes('フリーリレー') ? '自由形' : null),
        })),
    }
  })

  return NextResponse.json({ results })
}
