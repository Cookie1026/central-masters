import { supabase } from '@/lib/supabase'
import { supabaseServer } from '@/lib/supabase-server'
import SearchApp from '@/components/SearchApp'
import type { MeetOption, EventOption, AgeGroupOption, TeamOption } from '@/types'

async function loadOptions() {
  const [meetsRes, indEventsRes, relEventsRes, ageGroupsRes, teamsRes, relAgeLabelsRes] =
    await Promise.all([
      supabase
        .from('mst_event')
        .select('id, round, pool_type, date, name, venue')
        .order('round', { ascending: false }),
      supabase
        .from('mst_category')
        .select('id, name, distance, type')
        .eq('type', '個人')
        .order('distance', { ascending: true, nullsFirst: false }),
      supabase
        .from('mst_category')
        .select('id, name, distance, type')
        .eq('type', 'リレー')
        .order('name'),
      supabase.from('mst_age').select('id, name, min_age').eq('type', '個人').order('min_age'),
      supabase.from('mst_team').select('id, name, prefecture').order('name'),
      supabase.from('mst_age').select('name, min_age').eq('type', 'リレー').order('min_age'),
    ])

  const relayAgeGroups: string[] = (relAgeLabelsRes.data ?? []).map((r) => r.name)

  return {
    meets: (meetsRes.data ?? []) as MeetOption[],
    events: [
      ...(indEventsRes.data ?? []),
      ...(relEventsRes.data ?? []),
    ] as EventOption[],
    ageGroups: (ageGroupsRes.data ?? []) as AgeGroupOption[],
    teams: (teamsRes.data ?? []) as TeamOption[],
    relayAgeGroups,
  }
}

export default async function Page() {
  const { meets, events, ageGroups, teams, relayAgeGroups } = await loadOptions()

  const defaultTeamName = teams.find((t) => t.name.includes('おおたか'))?.name ?? ''

  return (
    <SearchApp
      meets={meets}
      events={events}
      ageGroups={ageGroups}
      relayAgeGroups={relayAgeGroups}
      teams={teams}
      defaultTeamName={defaultTeamName}
    />
  )
}
