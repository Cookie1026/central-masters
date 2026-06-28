export interface MeetOption {
  id: number
  round: number
  pool_type: string
  date: string | null
  name: string | null
  venue: string | null
}

export interface EventOption {
  id: number
  name: string
  distance: number | null
  type: string
}

export interface AgeGroupOption {
  id: number
  name: string
  min_age: number
}

export interface TeamOption {
  id: number
  name: string
  prefecture: string | null
}

export interface AthleteOption {
  id: number
  name: string
  gender: string
  age_name?: string | null
  min_age?: number | null
  total_points?: number | null
}

export interface RelayMember {
  swim_order: number
  split_seconds: number | null
  dive_time: number | null
  player_id: number
  is_meet_record: boolean
  is_japan_record: boolean
  is_world_record: boolean
  dt_player_person: { name: string; gender: string } | null
}

export interface RelayResult {
  id: number
  rank: number | null
  time_display: string | null
  time_seconds: string | null
  team_points: string | null
  age_group_label: string | null
  is_meet_record: boolean
  meet_record_seconds: string | null
  mst_team: { name: string }
  mst_category: { name: string; gender: string }
  mst_event: { round: number; pool_type: string }
  mst_age: { name: string } | null
  dt_player_relay: RelayMember[]
}

export interface IndividualResult {
  id: number
  rank: number | null
  time_display: string | null
  time_seconds: string | null
  dive_time: string | null
  points: string | null
  is_meet_record: boolean
  is_japan_record: boolean
  is_world_record: boolean
  lane: string | null
  player_id: number
  meet_record_seconds: string | null
  dt_player_person: {
    name: string
    gender: string
    mst_team: { name: string }
  }
  mst_category: {
    name: string
    distance: number | null
  }
  mst_age: { name: string }
  mst_event: { round: number; pool_type: string }
}

export interface AthleteHistoryIndividual {
  event: string
  age_group: string
  time_display: string | null
  time_seconds: string | null
  meet_record_seconds: string | null
  rank: number | null
  points: number | null
  is_meet_record: boolean
}

export interface AthleteHistoryRelay {
  event: string
  age_group: string | null
  time_display: string | null
  rank: number | null
  team_points: number | null
  is_meet_record: boolean
}

export interface AthleteHistoryMeet {
  round: number
  pool_type: string
  date: string | null
  individual: AthleteHistoryIndividual[]
  relay: AthleteHistoryRelay[]
}

export interface TeamStanding {
  rank: number | null
  total_points: string | null
  calculated_points: string | null
  male_points: string | null
  female_points: string | null
  mixed_points: string | null
  mst_team: { id: number; name: string }
  mst_event?: { id: number; round: number; pool_type: string; date: string | null }
}
