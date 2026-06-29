import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

function firstRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')
  const teamIds = (searchParams.get('teamIds') ?? '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite)
  const gender = searchParams.get('gender')

  const rulesRequest = supabaseServer
    .from('mst_disqualification')
    .select('id, category, code, description')
    .order('id')

  let individualRequest = supabaseServer
    .from('dt_result_person')
    .select(`
      id, lane,
      dt_player_person!inner(name, gender, team_id, mst_team!inner(name)),
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
      id,
      mst_team!inner(id, name),
      mst_category!inner(name, gender),
      mst_age(name),
      mst_event!inner(id, round, pool_type)
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
      }
    }),
    ...(relayResult.data ?? []).map((row) => {
      const team = firstRelation(row.mst_team)
      const category = firstRelation(row.mst_category)
      const age = firstRelation(row.mst_age)
      const meet = firstRelation(row.mst_event)
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
      }
    }),
  ].sort((a, b) => b.meet.round - a.meet.round || a.event.localeCompare(b.event, 'ja'))

  return NextResponse.json({
    rules: rulesResult.data ?? [],
    offenders,
  })
}
