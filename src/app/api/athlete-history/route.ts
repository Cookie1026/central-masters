import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

type MeetEntry = {
  round: number
  pool_type: string
  date: string | null
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
  }[]
  relay: {
    event: string
    age_group: string | null
    time_display: string | null
    rank: number | null
    team_points: number | null
    is_meet_record: boolean
    disqualification_code: string | null
    is_withdrawal: boolean
  }[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const athleteId = searchParams.get('athleteId')
  if (!athleteId) return NextResponse.json({ meets: [] })

  const aid = parseInt(athleteId)
  if (!Number.isFinite(aid)) return NextResponse.json({ meets: [] })

  const [{ data: athlete }, { data: indData }, { data: memberData }] = await Promise.all([
    supabaseServer
      .from('dt_player_person')
      .select('id, name, gender, mst_team!inner(name)')
      .eq('id', aid)
      .maybeSingle(),
    supabaseServer
      .from('dt_result_person')
      .select(
        'rank, time_display, time_seconds, meet_record_seconds, points, is_meet_record, disqualification_code, is_withdrawal, mst_event!inner(round, pool_type, date), mst_category!inner(name), mst_age!inner(name)',
      )
      .eq('player_id', aid),
    supabaseServer.from('dt_player_relay').select('relay_result_id').eq('player_id', aid),
  ])

  const relayIds = memberData?.map((m) => m.relay_result_id) ?? []
  let relayData: Record<string, unknown>[] = []
  if (relayIds.length > 0) {
    const { data } = await supabaseServer
      .from('dt_result_relay')
      .select(
        'rank, time_display, team_points, is_meet_record, disqualification_code, is_withdrawal, age_group_label, mst_event!inner(round, pool_type, date), mst_category!inner(name), mst_age(name)',
      )
      .in('id', relayIds)
    relayData = (data ?? []) as Record<string, unknown>[]
  }

  const meetMap = new Map<number, MeetEntry>()
  const getOrCreate = (round: number, pool_type: string, date: string | null): MeetEntry => {
    if (!meetMap.has(round)) meetMap.set(round, { round, pool_type, date, individual: [], relay: [] })
    return meetMap.get(round)!
  }

  for (const r of indData ?? []) {
    const ev = r.mst_event as unknown as { round: number; pool_type: string; date: string | null }
    const cat = r.mst_category as unknown as { name: string }
    const age = r.mst_age as unknown as { name: string }
    getOrCreate(ev.round, ev.pool_type, ev.date).individual.push({
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
    })
  }

  for (const r of relayData) {
    const ev = r['mst_event'] as { round: number; pool_type: string; date: string | null }
    const cat = r['mst_category'] as { name: string }
    getOrCreate(ev.round, ev.pool_type, ev.date).relay.push({
      event: cat.name,
      age_group: ((r['mst_age'] as { name: string } | null)?.name ?? (r['age_group_label'] as string | null)) ?? null,
      time_display: (r['time_display'] as string | null) ?? null,
      rank: (r['rank'] as number | null) ?? null,
      team_points:
        r['team_points'] != null ? parseFloat(String(r['team_points'])) : null,
      is_meet_record: Boolean(r['is_meet_record']),
      disqualification_code: (r['disqualification_code'] as string | null) ?? null,
      is_withdrawal: Boolean(r['is_withdrawal']),
    })
  }

  const meets = [...meetMap.values()]
    .sort((a, b) => b.round - a.round)
    .map((m) => ({
      ...m,
      individual: m.individual.sort(
        (a, b) => parseFloat(String(a.time_seconds ?? 99999)) - parseFloat(String(b.time_seconds ?? 99999)),
      ),
    }))

  return NextResponse.json({ athlete, meets })
}
