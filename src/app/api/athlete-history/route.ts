import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

type MeetEntry = {
  event_id: number
  round: number
  pool_type: string
  date: string | null
  athlete_points: number
  team_total_points: number | null
  contribution_percent: number | null
  individual: {
    event: string
    age_group: string
    time_display: string | null
    time_seconds: string | null
    meet_record_seconds: string | null
    rank: number | null
    points: number | null
    is_meet_record: boolean
    disqualification_code: string | null
    is_withdrawal: boolean
    next_rank: number | null
    next_rank_gap_seconds: number | null
    category_id: number
    age_id: number
  }[]
  relay: {
    event: string
    age_group: string | null
    time_display: string | null
    time_seconds: string | null
    rank: number | null
    team_points: number | null
    is_meet_record: boolean
    disqualification_code: string | null
    is_withdrawal: boolean
    swim_order: number | null
    stroke: string | null
    split_seconds: number | null
    dive_time: number | null
  }[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const athleteId = searchParams.get('athleteId')
  if (!athleteId) return NextResponse.json({ meets: [] })

  const aid = parseInt(athleteId)
  if (!Number.isFinite(aid)) return NextResponse.json({ meets: [] })

  const [{ data: athlete }, { data: indData }, { data: memberData }, { data: relayMaster }] = await Promise.all([
    supabaseServer
      .from('dt_player_person')
      .select('id, name, gender, mst_team!inner(id, name)')
      .eq('id', aid)
      .maybeSingle(),
    supabaseServer
      .from('dt_result_person')
      .select(
        'event_id, category_id, age_id, rank, time_display, time_seconds, meet_record_seconds, points, is_meet_record, disqualification_code, is_withdrawal, mst_event!inner(round, pool_type, date), mst_category!inner(name), mst_age!inner(name)',
      )
      .eq('player_id', aid),
    supabaseServer
      .from('dt_player_relay')
      .select('relay_result_id, swim_order, split_seconds, dive_time')
      .eq('player_id', aid),
    supabaseServer
      .from('mst_medley_relay')
      .select('relay_stroke, swim_order, stroke'),
  ])
  const strokeByRelayOrder = new Map(
    (relayMaster ?? []).map((row) => [`${row.relay_stroke}:${row.swim_order}`, row.stroke]),
  )

  const relayIds = memberData?.map((m) => m.relay_result_id) ?? []
  let relayData: Record<string, unknown>[] = []
  if (relayIds.length > 0) {
    const { data } = await supabaseServer
      .from('dt_result_relay')
      .select(
        'id, event_id, rank, time_display, time_seconds, team_points, is_meet_record, disqualification_code, is_withdrawal, age_group_label, mst_event!inner(round, pool_type, date), mst_category!inner(name, stroke), mst_age(name)',
      )
      .in('id', relayIds)
    relayData = (data ?? []) as Record<string, unknown>[]
  }

  const eventIds = [...new Set([
    ...(indData ?? []).map((row) => row.event_id),
    ...relayData.map((row) => Number(row['event_id'])),
  ])].filter(Number.isFinite)
  const team = athlete?.mst_team as unknown as { id: number; name: string } | null
  const [{ data: comparableResults }, { data: teamRankings }] = await Promise.all([
    eventIds.length > 0
      ? supabaseServer
          .from('dt_result_person')
          .select('event_id, category_id, age_id, rank, time_seconds')
          .in('event_id', eventIds)
          .not('rank', 'is', null)
          .not('time_seconds', 'is', null)
      : Promise.resolve({ data: [] }),
    eventIds.length > 0 && team?.id
      ? supabaseServer
          .from('dt_ranking_team')
          .select('event_id, total_points')
          .in('event_id', eventIds)
          .eq('team_id', team.id)
      : Promise.resolve({ data: [] }),
  ])
  const comparableMap = new Map<string, { rank: number; seconds: number }[]>()
  for (const row of comparableResults ?? []) {
    const key = `${row.event_id}:${row.category_id}:${row.age_id}`
    const list = comparableMap.get(key) ?? []
    list.push({ rank: Number(row.rank), seconds: Number(row.time_seconds) })
    comparableMap.set(key, list)
  }
  const teamTotalByEvent = new Map(
    (teamRankings ?? []).map((row) => [
      row.event_id,
      Number(row.total_points),
    ]),
  )

  const meetMap = new Map<number, MeetEntry>()
  const getOrCreate = (event_id: number, round: number, pool_type: string, date: string | null): MeetEntry => {
    if (!meetMap.has(round)) meetMap.set(round, {
      event_id,
      round,
      pool_type,
      date,
      athlete_points: 0,
      team_total_points: teamTotalByEvent.get(event_id) ?? null,
      contribution_percent: null,
      individual: [],
      relay: [],
    })
    return meetMap.get(round)!
  }

  for (const r of indData ?? []) {
    const ev = r.mst_event as unknown as { round: number; pool_type: string; date: string | null }
    const cat = r.mst_category as unknown as { name: string }
    const age = r.mst_age as unknown as { name: string }
    const targetRank = r.rank == null ? null : Number(r.rank)
    const targetSeconds = r.time_seconds == null ? null : Number(r.time_seconds)
    const comparable = comparableMap.get(`${r.event_id}:${r.category_id}:${r.age_id}`) ?? []
    const nextResult = targetRank == null
      ? null
      : comparable
          .filter((item) => item.rank < targetRank && Number.isFinite(item.seconds))
          .sort((a, b) => b.rank - a.rank || b.seconds - a.seconds)[0] ?? null
    getOrCreate(r.event_id, ev.round, ev.pool_type, ev.date).individual.push({
      event: cat.name,
      age_group: age.name,
      time_display: r.time_display,
      time_seconds: r.time_seconds,
      meet_record_seconds: r.meet_record_seconds,
      rank: r.rank,
      points: r.points !== null && r.points !== undefined ? parseFloat(String(r.points)) : null,
      is_meet_record: r.is_meet_record,
      disqualification_code: (r.disqualification_code as string | null) ?? null,
      is_withdrawal: Boolean(r.is_withdrawal),
      next_rank: nextResult?.rank ?? null,
      next_rank_gap_seconds: nextResult && targetSeconds != null
        ? Math.max(0, targetSeconds - nextResult.seconds)
        : null,
      category_id: r.category_id,
      age_id: r.age_id,
    })
  }

  for (const r of relayData) {
    const ev = r['mst_event'] as { round: number; pool_type: string; date: string | null }
    const cat = r['mst_category'] as { name: string; stroke: string | null }
    const member = memberData?.find((entry) => entry.relay_result_id === r['id'])
    getOrCreate(Number(r['event_id']), ev.round, ev.pool_type, ev.date).relay.push({
      event: cat.name,
      age_group: ((r['mst_age'] as { name: string } | null)?.name ?? (r['age_group_label'] as string | null)) ?? null,
      time_display: (r['time_display'] as string | null) ?? null,
      time_seconds: (r['time_seconds'] as string | null) ?? null,
      rank: (r['rank'] as number | null) ?? null,
      team_points:
        r['team_points'] != null ? parseFloat(String(r['team_points'])) : null,
      is_meet_record: Boolean(r['is_meet_record']),
      disqualification_code: (r['disqualification_code'] as string | null) ?? null,
      is_withdrawal: Boolean(r['is_withdrawal']),
      swim_order: member?.swim_order ?? null,
      stroke: member
        ? strokeByRelayOrder.get(`${cat.stroke}:${member.swim_order}`)
          ?? (cat.stroke?.includes('フリーリレー') ? '自由形' : null)
        : null,
      split_seconds: member?.split_seconds != null ? Number(member.split_seconds) : null,
      dive_time: member?.dive_time != null ? Number(member.dive_time) : null,
    })
  }

  const meets = [...meetMap.values()]
    .sort((a, b) => b.round - a.round)
    .map((m) => {
      const athletePoints =
        m.individual.reduce((sum, result) => sum + (result.points ?? 0), 0) +
        m.relay.reduce((sum, result) => sum + (result.team_points ?? 0) / 4, 0)
      return {
        ...m,
        athlete_points: athletePoints,
        contribution_percent: m.team_total_points && m.team_total_points > 0
          ? athletePoints / m.team_total_points * 100
          : null,
        individual: m.individual.map(({ category_id: _categoryId, age_id: _ageId, ...result }) => result).sort(
        (a, b) => parseFloat(String(a.time_seconds ?? 99999)) - parseFloat(String(b.time_seconds ?? 99999)),
      ),
      }
    })

  return NextResponse.json({ athlete, meets })
}
