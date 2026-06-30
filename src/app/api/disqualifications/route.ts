import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

function firstRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')
  // '' .split(',') → [''] → Number('') = 0 なので空文字列ガードが必要
  const rawTeamIds = searchParams.get('teamIds') ?? ''
  const teamIds = rawTeamIds
    ? rawTeamIds.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
    : []
  const gender = searchParams.get('gender')

  const rulesRequest = supabaseServer
    .from('mst_disqualification')
    .select('id, category, code, description')
    .order('id')

  let individualRequest = supabaseServer
    .from('dt_result_person')
    .select(`
      id, lane, disqualification_code, is_withdrawal,
      dt_player_person!inner(id, name, gender, team_id, mst_team!inner(name)),
      mst_category!inner(name),
      mst_age!inner(name),
      mst_event!inner(id, round, pool_type)
    `)
    .is('rank', null)
    .is('time_seconds', null)
    .order('event_id', { ascending: false })
    .limit(1000)

  let relayRequest = supabaseServer
    .from('dt_result_relay')
    .select(`
      id, disqualification_code, is_withdrawal,
      mst_team!inner(id, name),
      mst_category!inner(name, gender),
      mst_age(name),
      mst_event!inner(id, round, pool_type),
      dt_player_relay(swim_order, dt_player_person!inner(id, name, gender))
    `)
    .is('rank', null)
    .is('time_seconds', null)
    .order('event_id', { ascending: false })
    .limit(1000)

  if (eventId) {
    individualRequest = individualRequest.eq('event_id', Number(eventId))
    relayRequest = relayRequest.eq('event_id', Number(eventId))
  }
  if (teamIds.length > 0) {
    individualRequest = individualRequest.in('dt_player_person.team_id', teamIds)
    relayRequest = relayRequest.in('team_id', teamIds)
  }
  if (gender) {
    individualRequest = individualRequest.eq('dt_player_person.gender', gender)
    relayRequest = relayRequest.eq('mst_category.gender', gender)
  }

  const [rulesResult, individualResult, relayResult] = await Promise.all([
    rulesRequest,
    individualRequest,
    relayRequest,
  ])

  const error = rulesResult.error ?? individualResult.error ?? relayResult.error
  if (error) {
    return NextResponse.json(
      { rules: [], offenders: [], error: error.message },
      { status: 500 },
    )
  }

  const offenders = [
    ...(individualResult.data ?? []).map((row) => {
      const person = firstRelation(row.dt_player_person)
      const team = firstRelation(person.mst_team)
      const category = firstRelation(row.mst_category)
      const age = firstRelation(row.mst_age)
      const meet = firstRelation(row.mst_event)
      return {
        id: `individual-${row.id}`,
        type: '個人',
        name: person.name,
        gender: person.gender,
        team: team.name,
        event: category.name,
        ageGroup: age.name,
        meet,
        lane: row.lane,
        disqualificationCode: row.disqualification_code ?? null,
        isWithdrawal: row.is_withdrawal ?? false,
        playerId: (person as { id?: number }).id ?? null,
      }
    }),
    ...(relayResult.data ?? []).map((row) => {
      const team = firstRelation(row.mst_team)
      const category = firstRelation(row.mst_category)
      const age = firstRelation(row.mst_age)
      const meet = firstRelation(row.mst_event)
      const memberRows = (row.dt_player_relay as {
        swim_order: number
        dt_player_person: { id: number; name: string; gender: string } | { id: number; name: string; gender: string }[]
      }[] | null) ?? []
      const members = [...memberRows]
        .sort((a, b) => (a.swim_order ?? 0) - (b.swim_order ?? 0))
        .map((p) => {
          const person = Array.isArray(p.dt_player_person) ? p.dt_player_person[0] : p.dt_player_person
          return person
            ? { id: person.id, name: person.name, gender: person.gender }
            : null
        })
        .filter((person): person is { id: number; name: string; gender: string } => person !== null)
      return {
        id: `relay-${row.id}`,
        type: 'リレー',
        name: team.name,
        gender: category.gender,
        team: team.name,
        event: category.name,
        ageGroup: age?.name ?? '',
        meet,
        lane: null,
        disqualificationCode: row.disqualification_code ?? null,
        isWithdrawal: row.is_withdrawal ?? false,
        members,
      }
    }),
  ].sort((a, b) => b.meet.round - a.meet.round || a.event.localeCompare(b.event, 'ja'))

  return NextResponse.json({
    rules: rulesResult.data ?? [],
    offenders,
  })
}
