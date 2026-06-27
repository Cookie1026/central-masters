'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type {
  MeetOption,
  EventOption,
  AgeGroupOption,
  TeamOption,
  AthleteOption,
  IndividualResult,
  RelayResult,
  RelayMember,
  AthleteHistoryMeet,
} from '@/types'

interface Props {
  meets: MeetOption[]
  events: EventOption[]
  ageGroups: AgeGroupOption[]
  relayAgeGroups: string[]
  teams: TeamOption[]
  defaultTeamName: string
}

type TeamGroup = TeamOption & { ids: number[]; displayName: string }
type EventGroup = EventOption & { ids: number[] }

// Strip セ・ / ・セ prefix/suffix for display
function teamDisplayName(name: string): string {
  const trimmed = name.trim()
  const withoutCentral = trimmed.startsWith('セ・')
    ? trimmed.slice(2)
    : trimmed.endsWith('・セ')
      ? trimmed.slice(0, -2)
      : trimmed
  return withoutCentral.replace(/^ザパス/, 'ザバス')
}

function normalizeOptionName(name: string): string {
  return teamDisplayName(name).replace(/\s+/g, '')
}

const PREF_ORDER = ['千葉', '東京', '埼玉', '神奈川', '栃木', '群馬', '福島', '兵庫']

function genderDisplay(gender: string): string {
  if (gender === '男子') return '男性'
  if (gender === '女子') return '女性'
  return gender
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function formatSplitTime(seconds: number | null | undefined): string {
  if (seconds == null) return ''
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return ''
  if (s < 60) return s.toFixed(2)
  const m = Math.floor(s / 60)
  const rem = (s % 60).toFixed(2).padStart(5, '0')
  return `${m}:${rem}`
}

function formatDiffTime(meetRecordSec: string | null, timeSec: string | null): string {
  if (!meetRecordSec || !timeSec) return ''
  const rec = parseFloat(meetRecordSec)
  const t = parseFloat(timeSec)
  if (!Number.isFinite(rec) || !Number.isFinite(t)) return ''
  const diff = rec - t
  const abs = Math.abs(diff)
  const formatted = formatSplitTime(abs)
  if (!formatted) return '±0.00'
  return diff >= 0 ? `+${formatted}` : `-${formatted}`
}

type SortField = 'rank' | 'name' | 'gender' | 'meet_round' | 'team' | 'event' | 'age' | 'time' | 'dive' | 'points' | 'meet_record' | 'diff'
type RelaySortField = 'meet_round' | 'team' | 'rank' | 'event' | 'gender' | 'age' | 'time' | 'points' | 'meet_record' | 'diff'

const sel =
  'w-full bg-slate-700/70 border border-slate-600 text-slate-100 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 cursor-pointer'
const lbl = 'block text-[10px] font-bold text-cyan-600 uppercase tracking-widest mb-1'

const RANK_BADGE: Record<number, string> = {
  1: 'bg-gradient-to-b from-yellow-200 to-amber-500 text-amber-900 shadow shadow-amber-400/60',
  2: 'bg-gradient-to-b from-slate-200 to-slate-400 text-slate-700 shadow shadow-slate-400/60',
  3: 'bg-gradient-to-b from-amber-500 to-amber-800 text-amber-100 shadow shadow-amber-700/60',
}

function RankBadge({ n }: { n: number }) {
  return (
    <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[7px] font-black flex-shrink-0 ${RANK_BADGE[n]}`}>
      {n}
    </span>
  )
}

function RankSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const options = [
    { value: '', label: 'すべて' },
    ...[1,2,3,4,5,6,7,8,9,10].map((n) => ({ value: String(n), label: `${n}位` })),
  ]
  const selected = options.find((o) => o.value === value) ?? options[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${sel} flex items-center justify-between gap-1`}
      >
        <span className="flex items-center gap-1">
          {value && Number(value) <= 3 && <RankBadge n={Number(value)} />}
          {selected.label}
        </span>
        <span className="text-slate-400 text-[10px] ml-1">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-0.5 bg-slate-800 border border-slate-600 rounded shadow-xl overflow-hidden">
          {options.map((o) => {
            const n = Number(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full flex items-center gap-1.5 px-2.5 py-1 text-sm text-left hover:bg-slate-700 transition-colors ${o.value === value ? 'bg-slate-700 text-white' : 'text-slate-300'}`}
              >
                {o.value && n <= 3 && <RankBadge n={n} />}
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SortTh<T extends string>({
  children,
  field,
  current,
  dir,
  onSort,
  className = '',
}: {
  children: React.ReactNode
  field: T
  current: T
  dir: 'asc' | 'desc'
  onSort: (f: T) => void
  className?: string
}) {
  const active = current === field
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-xs cursor-pointer select-none hover:bg-sky-800/50 transition-colors whitespace-nowrap align-top ${active ? 'text-sky-200' : 'text-slate-300'} ${className}`}
      onClick={() => onSort(field)}
    >
      {children}
      <span className={`ml-1 text-[9px] ${active ? 'text-sky-400' : 'opacity-25'}`}>
        {active ? (dir === 'asc' ? '△' : '▽') : '△▽'}
      </span>
    </th>
  )
}

export default function SearchApp({
  meets,
  events,
  ageGroups,
  relayAgeGroups,
  teams,
  defaultTeamName,
}: Props) {
  const defaultMeetId = meets[0]?.id ?? null

  const [meetId, setMeetId] = useState<number | null>(defaultMeetId)
  const [teamKey, setTeamKey] = useState(defaultTeamName ? normalizeOptionName(defaultTeamName) : '')
  const [athleteId, setAthleteId] = useState<number | null>(null)
  const [eventKey, setEventKey] = useState('')
  const [gender, setGender] = useState('')
  const [ageValue, setAgeValue] = useState('')
  const [rankFilter, setRankFilter] = useState('')
  const [recordType, setRecordType] = useState('')

  // Derived from ageValue: "ind:{id}" for individual, "rel:{label}" for relay
  const ageGroupId = ageValue.startsWith('ind:') ? parseInt(ageValue.slice(4)) : null
  const relayAgeLabel = ageValue.startsWith('rel:') ? ageValue.slice(4) : null

  const [athletes, setAthletes] = useState<AthleteOption[]>([])
  const [results, setResults] = useState<IndividualResult[]>([])
  const [relayResults, setRelayResults] = useState<RelayResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)

  const [sortField, setSortField] = useState<SortField>('time')

  type ColKey = 'meet_round' | 'team' | 'event' | 'age' | 'time' | 'dive' | 'record' | 'rank' | 'points' | 'diff'
  const COL_DEFS: { key: ColKey; label: string }[] = [
    { key: 'meet_round',   label: '大会回' },
    { key: 'team',         label: 'チーム' },
    { key: 'event',        label: '競技名' },
    { key: 'age',          label: '年齢区分' },
    { key: 'time',         label: 'タイム' },
    { key: 'dive',         label: '飛込' },
    { key: 'record',       label: '新記録' },
    { key: 'rank',         label: '順位' },
    { key: 'points',       label: '得点' },
    { key: 'diff',         label: '大会新差' },
  ]
  const ALL_COLS = new Set<ColKey>(COL_DEFS.map((c) => c.key))
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(ALL_COLS)
  const toggleCol = (key: ColKey, checked: boolean) => {
    setVisibleCols((prev) => {
      const next = new Set(prev)
      checked ? next.add(key) : next.delete(key)
      return next
    })
  }
  const vis = (key: ColKey) => visibleCols.has(key)

  type RelayColKey = 'relay_meet_round' | 'relay_team' | 'relay_event' | 'relay_age' | 'relay_gender' | 'relay_time' | 'relay_record' | 'relay_rank' | 'relay_points' | 'relay_diff'
  const RELAY_COL_DEFS: { key: RelayColKey; label: string }[] = [
    { key: 'relay_meet_round',  label: '大会回' },
    { key: 'relay_team',        label: 'チーム' },
    { key: 'relay_event',       label: '競技名' },
    { key: 'relay_age',         label: '年齢区分' },
    { key: 'relay_gender',      label: '性別' },
    { key: 'relay_time',        label: 'タイム' },
    { key: 'relay_record',      label: '新記録' },
    { key: 'relay_rank',        label: '順位' },
    { key: 'relay_points',      label: '得点' },
    { key: 'relay_diff',        label: '大会新差' },
  ]
  const ALL_RELAY_COLS = new Set<RelayColKey>(RELAY_COL_DEFS.map((c) => c.key))
  const [relayVisibleCols, setRelayVisibleCols] = useState<Set<RelayColKey>>(ALL_RELAY_COLS)
  const toggleRelayCol = (key: RelayColKey, checked: boolean) => {
    setRelayVisibleCols((prev) => {
      const next = new Set(prev)
      checked ? next.add(key) : next.delete(key)
      return next
    })
  }
  const relVis = (key: RelayColKey) => relayVisibleCols.has(key)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [athleteForHistory, setAthleteForHistory] = useState<{ id: number; name: string; gender: string; teamName: string } | null>(null)
  const [athleteHistory, setAthleteHistory] = useState<AthleteHistoryMeet[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Resizable columns (desktop)
  const [leftW, setLeftW] = useState(240)
  const [rightW, setRightW] = useState(300)
  const drag = useRef<{ side: 'l' | 'r'; x0: number; w0: number } | null>(null)

  const uniqueTeams = useMemo<TeamGroup[]>(() => {
    const map = new Map<string, TeamGroup>()
    for (const t of teams) {
      const key = normalizeOptionName(t.name)
      const existing = map.get(key)
      if (existing) {
        existing.ids.push(t.id)
      } else {
        map.set(key, { ...t, ids: [t.id], displayName: teamDisplayName(t.name) })
      }
    }
    return [...map.values()].sort((a, b) => {
      const aOotaka = a.displayName.includes('おおたか')
      const bOotaka = b.displayName.includes('おおたか')
      if (aOotaka && !bOotaka) return -1
      if (!aOotaka && bOotaka) return 1
      const aIdx = a.prefecture ? PREF_ORDER.indexOf(a.prefecture) : -1
      const bIdx = b.prefecture ? PREF_ORDER.indexOf(b.prefecture) : -1
      const aOrder = aIdx >= 0 ? aIdx : PREF_ORDER.length
      const bOrder = bIdx >= 0 ? bIdx : PREF_ORDER.length
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.displayName.localeCompare(b.displayName, 'ja')
    })
  }, [teams])

  const teamGroups = useMemo(() => {
    const groups: { pref: string | null; teams: TeamGroup[] }[] = []
    for (const t of uniqueTeams) {
      const pref = t.prefecture ?? null
      const last = groups[groups.length - 1]
      if (last && last.pref === pref) {
        last.teams.push(t)
      } else {
        groups.push({ pref, teams: [t] })
      }
    }
    return groups
  }, [uniqueTeams])

  const uniqueEvents = useMemo<EventGroup[]>(() => {
    const map = new Map<string, EventGroup>()
    for (const e of events) {
      const key = e.name.trim()
      const existing = map.get(key)
      if (existing) {
        existing.ids.push(e.id)
      } else {
        map.set(key, { ...e, ids: [e.id] })
      }
    }
    return [...map.values()]
  }, [events])

  const currentMeet = meets.find((m) => m.id === meetId)

  const filteredEvents = useMemo<EventGroup[]>(() => {
    if (!currentMeet || currentMeet.pool_type !== '長水路') return uniqueEvents
    return uniqueEvents.filter(
      (e) => !e.name.startsWith('25m') && !e.name.startsWith('4×25m'),
    )
  }, [uniqueEvents, currentMeet])

  const visibleAgeGroups = useMemo(() => {
    const hasExplicit90s = ageGroups.some((a) => a.name === '90～94歳')
    return ageGroups
      .filter((a) => !(hasExplicit90s && a.name === '90歳以上'))
      .filter((a, i, arr) => arr.findIndex((x) => x.name === a.name) === i)
  }, [ageGroups])

  const defaultTeamKey = useMemo(() => {
    if (!defaultTeamName) return ''
    return normalizeOptionName(defaultTeamName)
  }, [defaultTeamName])

  useEffect(() => {
    setTeamKey(defaultTeamKey)
  }, [defaultTeamKey])

  // 大会切替時、選択中種目が非表示になったらクリア
  useEffect(() => {
    if (eventKey && !filteredEvents.some((e) => e.ids.join(',') === eventKey)) {
      setEventKey('')
    }
  }, [filteredEvents, eventKey])

  const selectedTeam = uniqueTeams.find((t) => normalizeOptionName(t.name) === teamKey)
  const selectedTeamIds = selectedTeam?.ids ?? []
  const selectedTeamIdsKey = selectedTeamIds.join(',')
  const selectedEvent = filteredEvents.find((e) => e.ids.join(',') === eventKey)
  const selectedEventIds = selectedEvent?.ids ?? []
  const selectedEventIdsKey = selectedEventIds.join(',')

  // Sort individual results
  const sortedResults = useMemo(() => {
    if (!results.length) return results
    return [...results].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'rank':
          cmp = (a.rank ?? 9999) - (b.rank ?? 9999)
          break
        case 'meet_round':
          cmp = (a.mst_event.round ?? 0) - (b.mst_event.round ?? 0)
          break
        case 'name':
          cmp = a.dt_player_person.name.localeCompare(b.dt_player_person.name, 'ja')
          break
        case 'gender':
          cmp = a.dt_player_person.gender.localeCompare(b.dt_player_person.gender)
          break
        case 'team':
          cmp = a.dt_player_person.mst_team.name.localeCompare(b.dt_player_person.mst_team.name, 'ja')
          break
        case 'event':
          cmp = a.mst_category.name.localeCompare(b.mst_category.name, 'ja')
          break
        case 'age':
          cmp = a.mst_age.name.localeCompare(b.mst_age.name, 'ja')
          break
        case 'time':
          cmp = (parseFloat(String(a.time_seconds)) || 9999) - (parseFloat(String(b.time_seconds)) || 9999)
          break
        case 'dive':
          cmp = (parseFloat(String(a.dive_time)) || 9999) - (parseFloat(String(b.dive_time)) || 9999)
          break
        case 'points':
          cmp = (parseFloat(String(b.points)) || 0) - (parseFloat(String(a.points)) || 0)
          break
        case 'meet_record':
          cmp = (parseFloat(String(a.meet_record_seconds)) || 9999) - (parseFloat(String(b.meet_record_seconds)) || 9999)
          break
        case 'diff': {
          const da = parseFloat(String(a.meet_record_seconds)) - parseFloat(String(a.time_seconds))
          const db = parseFloat(String(b.meet_record_seconds)) - parseFloat(String(b.time_seconds))
          cmp = (Number.isFinite(da) ? da : -9999) - (Number.isFinite(db) ? db : -9999)
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [results, sortField, sortDir])

  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }, [sortField])

  const [relaySortField, setRelaySortField] = useState<RelaySortField>('time')
  const [relaySortDir, setRelaySortDir] = useState<'asc' | 'desc'>('asc')

  const handleRelaySort = useCallback((field: RelaySortField) => {
    if (field === relaySortField) {
      setRelaySortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setRelaySortField(field)
      setRelaySortDir('asc')
    }
  }, [relaySortField])

  const sortedRelayResults = useMemo(() => {
    if (!relayResults.length) return relayResults
    return [...relayResults].sort((a, b) => {
      let cmp = 0
      switch (relaySortField) {
        case 'meet_round':
          cmp = (a.mst_event.round ?? 0) - (b.mst_event.round ?? 0)
          break
        case 'team':
          cmp = a.mst_team.name.localeCompare(b.mst_team.name, 'ja')
          break
        case 'rank':
          cmp = (a.rank ?? 9999) - (b.rank ?? 9999)
          break
        case 'event':
          cmp = a.mst_category.name.localeCompare(b.mst_category.name, 'ja')
          break
        case 'gender':
          cmp = a.mst_category.gender.localeCompare(b.mst_category.gender)
          break
        case 'age':
          cmp = (a.mst_age?.name ?? a.age_group_label ?? '').localeCompare(b.mst_age?.name ?? b.age_group_label ?? '', 'ja')
          break
        case 'time':
          cmp = (parseFloat(String(a.time_seconds)) || 9999) - (parseFloat(String(b.time_seconds)) || 9999)
          break
        case 'points':
          cmp = (parseFloat(String(b.team_points)) || 0) - (parseFloat(String(a.team_points)) || 0)
          break
        case 'meet_record':
          cmp = (parseFloat(String(a.meet_record_seconds)) || 9999) - (parseFloat(String(b.meet_record_seconds)) || 9999)
          break
        case 'diff': {
          const da = parseFloat(String(a.meet_record_seconds)) - parseFloat(String(a.time_seconds))
          const db = parseFloat(String(b.meet_record_seconds)) - parseFloat(String(b.time_seconds))
          cmp = (Number.isFinite(da) ? da : -9999) - (Number.isFinite(db) ? db : -9999)
          break
        }
      }
      return relaySortDir === 'asc' ? cmp : -cmp
    })
  }, [relayResults, relaySortField, relaySortDir])

  const fetchAthleteHistory = useCallback((id: number, name: string, genderStr: string, teamName?: string) => {
    setAthleteForHistory({ id, name, gender: genderStr, teamName: teamName ?? '' })
    setAthleteHistory(null)
    setHistoryLoading(true)
    fetch(`/api/athlete-history?athleteId=${id}`)
      .then((res) => res.json())
      .then((data: { meets: AthleteHistoryMeet[] }) => {
        setAthleteHistory(data.meets ?? [])
        setHistoryLoading(false)
      })
      .catch(() => setHistoryLoading(false))
  }, [])

  const handleAthleteClick = useCallback((r: IndividualResult) => {
    fetchAthleteHistory(r.player_id, r.dt_player_person.name, r.dt_player_person.gender, r.dt_player_person.mst_team.name)
  }, [fetchAthleteHistory])

  const handleRelayMemberClick = useCallback((m: RelayMember) => {
    fetchAthleteHistory(m.player_id, m.dt_player_person?.name ?? '', m.dt_player_person?.gender ?? '')
  }, [fetchAthleteHistory])

  // 名前重複排除 + 女性→男性・年齢昇順（APIのソートを保持しつつ重複除去）
  const uniqueAthletes = useMemo(() => {
    const seen = new Set<string>()
    return [...athletes]
      .sort((a, b) => {
        // 女子を先に
        if (a.gender !== b.gender) return a.gender === '女子' ? -1 : 1
        // 年齢区分昇順
        const ageA = (a as AthleteOption).min_age ?? 999
        const ageB = (b as AthleteOption).min_age ?? 999
        if (ageA !== ageB) return ageA - ageB
        return a.name.localeCompare(b.name, 'ja')
      })
      .filter((a) => {
        if (seen.has(a.name)) return false
        seen.add(a.name)
        return true
      })
  }, [athletes])

  // Cascade: team + meet → athletes
  useEffect(() => {
    if (!selectedTeam || !meetId) {
      setAthletes([])
      return
    }
    let cancelled = false
    const p = new URLSearchParams()
    p.set('teamIds', selectedTeamIdsKey)
    p.set('eventId', String(meetId))
    fetch(`/api/athletes?${p}`)
      .then((r) => r.json())
      .then((data: AthleteOption[]) => {
        if (!cancelled) {
          setAthletes(Array.isArray(data) ? data : [])
          setAthleteId(null)
        }
      })
    return () => { cancelled = true }
  }, [selectedTeam, selectedTeamIdsKey, meetId])

  // Search (individual + relay)
  useEffect(() => {
    const hasFilter = selectedTeam || athleteId || eventKey || gender || ageValue || rankFilter || recordType
    if (!hasFilter) {
      setResults([])
      setRelayResults([])
      setLoading(false)
      return
    }
    setLoading(true)

    const p = new URLSearchParams()
    if (meetId) p.set('eventId', String(meetId))
    if (athleteId) p.set('athleteId', String(athleteId))
    else if (selectedTeamIdsKey) p.set('teamIds', selectedTeamIdsKey)
    if (selectedEventIdsKey) p.set('categoryIds', selectedEventIdsKey)
    if (gender) p.set('gender', gender)
    if (ageGroupId) p.set('ageId', String(ageGroupId))
    if (relayAgeLabel) p.set('ageGroupLabel', relayAgeLabel)
    if (rankFilter) p.set('rank', rankFilter)
    if (recordType) p.set('recordType', recordType)

    let cancelled = false
    const selectedEventType = selectedEvent?.type ?? null
    // リレー年齢区分選択時 or 混合選択時は個人スキップ。リレー種目選択またはフィルタなしの場合はリレー取得
    const doIndividual = relayAgeLabel === null && gender !== '混合'
    const doRelay = (relayAgeLabel !== null || !eventKey || selectedEventType === 'リレー' || gender === '混合')

    Promise.all([
      doIndividual
        ? fetch(`/api/search?${p}`).then((r) => r.json())
        : Promise.resolve({ results: [] }),
      doRelay
        ? fetch(`/api/relay?${p}`).then((r) => r.json())
        : Promise.resolve({ results: [] }),
    ])
      .then(([ind, rel]) => {
        if (!cancelled) {
          setResults(ind.results ?? [])
          setRelayResults(rel.results ?? [])
          setLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [meetId, selectedTeam, selectedTeamIdsKey, athleteId, eventKey, selectedEventIdsKey, gender, ageValue, rankFilter, recordType])

  // Drag resize
  const startDrag = useCallback(
    (side: 'l' | 'r', e: React.MouseEvent) => {
      e.preventDefault()
      drag.current = { side, x0: e.clientX, w0: side === 'l' ? leftW : rightW }
    },
    [leftW, rightW],
  )

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return
      const dx = e.clientX - drag.current.x0
      if (drag.current.side === 'l') setLeftW(Math.max(180, Math.min(420, drag.current.w0 + dx)))
      else setRightW(Math.max(160, Math.min(380, drag.current.w0 - dx)))
    }
    const up = () => { drag.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  const handleClear = () => {
    setMeetId(defaultMeetId)
    setTeamKey(defaultTeamKey)  // おおたかに戻す
    setAthleteId(null)
    setEventKey('')
    setGender('')
    setAgeValue('')
    setRankFilter('')
    setRecordType('')
  }

  const showTeamColumn = !selectedTeam  // チーム列は絞り込みなしのときのみ表示

  // ── Filter panel ─────────────────────────────────────────────
  const filterPanel = (
    <div className="flex flex-col gap-3.5 p-4">
      <div>
        <label className={lbl}>大会回数</label>
        <select
          className={sel}
          value={meetId ?? ''}
          onChange={(e) => setMeetId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">すべて</option>
          {meets.map((m) => (
            <option key={m.id} value={m.id}>
              第{m.round}回（{m.pool_type}）
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={lbl}>チーム</label>
        <select
          className={sel}
          value={teamKey}
          onChange={(e) => { setTeamKey(e.target.value); setAthleteId(null) }}
        >
          <option value="">すべて</option>
          {(() => {
            let counter = 0
            return teamGroups.map(({ pref, teams }) => (
              <optgroup key={pref ?? '__null__'} label={`─── ${pref ?? 'その他'} ───`}>
                {teams.map((t) => {
                  counter++
                  return (
                    <option key={normalizeOptionName(t.name)} value={normalizeOptionName(t.name)}>
                      {String(counter).padStart(3, '0')} {t.displayName}
                    </option>
                  )
                })}
              </optgroup>
            ))
          })()}
        </select>
      </div>

      <div>
        <label className={lbl}>選手名</label>
        {!teamKey ? (
          <select className={sel} disabled>
            <option>チームを選択してください</option>
          </select>
        ) : (
          <select
            className={sel}
            style={{ background: '#333b47' }}
            value={athleteId ?? ''}
            onChange={(e) => setAthleteId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">すべて</option>
            {(['女子', '男子'] as const).map((g) => {
              const list = uniqueAthletes.filter((a) => a.gender === g)
              if (!list.length) return null
              return (
                <optgroup
                  key={g}
                  label={`─── ${g === '女子' ? '女性' : '男性'} ───`}
                  style={{ color: g === '女子' ? '#ff4444' : '#4488ff' }}
                >
                  {list.map((a) => (
                    <option key={a.id} value={a.id} style={{ color: 'white' }}>
                      {a.name}{(a as AthleteOption).age_name ? ` (${(a as AthleteOption).age_name})` : ''}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        )}
      </div>

      <div>
          <label className={lbl}>競技名</label>
        <select
          className={sel}
          value={eventKey}
          onChange={(e) => setEventKey(e.target.value)}
        >
          <option value="">すべて</option>
          <optgroup label="── 個人 ──">
            {filteredEvents
              .filter((e) => e.type === '個人')
              .map((e) => (
                <option key={e.ids.join(',')} value={e.ids.join(',')}>
                  {e.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="── リレー ──">
            {filteredEvents
              .filter((e) => e.type === 'リレー')
              .map((e) => (
                <option key={e.ids.join(',')} value={e.ids.join(',')}>
                  {e.name}
                </option>
              ))}
          </optgroup>
        </select>
      </div>

      <div>
        <label className={lbl}>性別</label>
        <select className={sel} value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">すべて</option>
          <option value="男子">男子</option>
          <option value="女子">女子</option>
          <option value="混合">混合（リレー）</option>
        </select>
      </div>

      <div>
        <label className={lbl}>年齢区分</label>
        <select
          className={sel}
          value={ageValue}
          onChange={(e) => setAgeValue(e.target.value)}
        >
          <option value="">すべて</option>
          <optgroup label="── 個人 ──">
            {visibleAgeGroups.map((a) => (
              <option key={a.id} value={`ind:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
          {relayAgeGroups.length > 0 && (
            <optgroup label="── リレー ──">
              {relayAgeGroups.map((label) => (
                <option key={label} value={`rel:${label}`}>
                  {label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div>
        <label className={lbl}>順位</label>
        <RankSelect value={rankFilter} onChange={setRankFilter} />
      </div>

      <div>
        <label className={lbl}>新記録</label>
        <select className={sel} value={recordType} onChange={(e) => setRecordType(e.target.value)}>
          <option value="">すべて</option>
          <option value="大会新">大会新</option>
          <option value="日本新">日本新</option>
          <option value="世界新">世界新</option>
        </select>
      </div>

      <button
        onClick={handleClear}
        className="mt-0.5 w-full rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-1.5 transition-colors"
      >
        クリア
      </button>

      <div className="mt-3">
        <p className="text-[9px] font-bold text-cyan-700 uppercase tracking-widest mb-1">個人列</p>
        <div className="grid grid-cols-2 gap-1">
          {COL_DEFS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibleCols.has(key)}
                onChange={(e) => toggleCol(key, e.target.checked)}
                className="accent-sky-500 cursor-pointer"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mb-1 mt-2">リレー列</p>
        <div className="grid grid-cols-2 gap-1">
          {RELAY_COL_DEFS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={relayVisibleCols.has(key)}
                onChange={(e) => toggleRelayCol(key, e.target.checked)}
                className="accent-indigo-500 cursor-pointer"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  )

  // ── Tournament title ─────────────────────────────────────────
  const tournamentTitle = currentMeet && (
    <div className="px-4 pt-3 pb-2.5 border-b border-slate-700/60 shrink-0">
      <h2 className="text-sm font-bold bg-gradient-to-r from-sky-300 via-cyan-200 to-blue-300 bg-clip-text text-transparent">
        {currentMeet.name ?? `第${currentMeet.round}回セントラルスポーツマスターズフェスティバル水泳競技会`}
      </h2>
      <div className="flex flex-wrap gap-3 mt-0.5">
        {currentMeet.date && (
          <span className="text-xs text-slate-400">{formatDate(currentMeet.date)}</span>
        )}
        {currentMeet.venue && (
          <span className="text-xs text-slate-400">{currentMeet.venue}</span>
        )}
        <span className="text-xs text-sky-600/70">{currentMeet.pool_type}</span>
      </div>
    </div>
  )

  // ── Individual results table ─────────────────────────────────
  const selectedAthlete = athleteId ? uniqueAthletes.find((a) => a.id === athleteId) : null
  const contextChips: { label: string; color: string }[] = []
  if (currentMeet) contextChips.push({ label: `第${currentMeet.round}回`, color: 'text-slate-400' })
  if (selectedTeam) contextChips.push({ label: selectedTeam.displayName, color: 'text-cyan-400' })
  if (selectedAthlete) contextChips.push({ label: selectedAthlete.name, color: 'text-sky-300' })
  if (gender) contextChips.push({ label: gender, color: 'text-slate-300' })
  if (ageValue) {
    const ageLabel = ageValue.startsWith('ind:')
      ? (visibleAgeGroups.find((a) => `ind:${a.id}` === ageValue)?.name ?? ageValue)
      : ageValue.replace('rel:', '')
    contextChips.push({ label: ageLabel, color: 'text-slate-300' })
  }
  if (rankFilter) contextChips.push({ label: `${rankFilter}位`, color: 'text-slate-300' })
  if (recordType) contextChips.push({ label: recordType, color: 'text-amber-400' })

  const individualTable = sortedResults.length > 0 && (
    <div>
      <div className="flex items-start justify-between mb-2 gap-2">
        <div>
          <span className="text-sm font-bold text-white">個人成績</span>
          {contextChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              {contextChips.map((chip, i) => (
                <span key={i} className={`text-xs font-medium ${chip.color}`}>
                  {i > 0 && <span className="text-slate-600 mr-2">|</span>}
                  {chip.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-slate-400 shrink-0 mt-0.5">
          {sortedResults.length}件{sortedResults.length >= 500 ? '（上限）' : ''}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-sky-900/40">
        <table className="w-full text-sm" style={{ minWidth: '520px' }}>
          <thead>
            <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left border-b border-sky-800/40">
              <th className="px-3 py-2.5 font-semibold text-xs w-8 text-center text-slate-400 align-top">#</th>
              {vis('meet_round') && <SortTh field="meet_round" current={sortField} dir={sortDir} onSort={handleSort}>大会回</SortTh>}
              {vis('team') && <SortTh field="team" current={sortField} dir={sortDir} onSort={handleSort}>チーム</SortTh>}
              <SortTh field="name" current={sortField} dir={sortDir} onSort={handleSort}>選手名</SortTh>
              <SortTh field="gender" current={sortField} dir={sortDir} onSort={handleSort}>性別</SortTh>
              {vis('event') && <SortTh field="event" current={sortField} dir={sortDir} onSort={handleSort}>競技名</SortTh>}
              {vis('age') && <SortTh field="age" current={sortField} dir={sortDir} onSort={handleSort}>年齢区分</SortTh>}
              {vis('time') && <SortTh field="time" current={sortField} dir={sortDir} onSort={handleSort}>タイム</SortTh>}
              {vis('dive') && <SortTh field="dive" current={sortField} dir={sortDir} onSort={handleSort}>飛込</SortTh>}
              {vis('record') && <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-center">新記録</th>}
              {vis('rank') && <SortTh field="rank" current={sortField} dir={sortDir} onSort={handleSort} className="text-right">順位</SortTh>}
              {vis('points') && <SortTh field="points" current={sortField} dir={sortDir} onSort={handleSort} className="text-right">得点</SortTh>}
              {vis('diff') && <SortTh field="diff" current={sortField} dir={sortDir} onSort={handleSort} className="text-right">大会新差</SortTh>}
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((r, i) => {
              const isMale = r.dt_player_person.gender === '男子'
              return (
                <tr
                key={r.id}
                className="bg-sky-950/60 hover:bg-sky-900/50 transition-colors"
              >
                <td className="px-3 py-2 text-center text-slate-500 text-xs">{i + 1}</td>
                {vis('meet_round') && <td className="px-3 py-2 text-slate-400 text-xs text-center whitespace-nowrap">第{r.mst_event.round}回</td>}
                {vis('team') && <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{teamDisplayName(r.dt_player_person.mst_team.name)}</td>}
                <td
                  className={`px-3 py-2 font-medium whitespace-nowrap cursor-pointer hover:underline transition-colors ${isMale ? 'text-sky-300 hover:text-sky-100' : 'text-red-400 hover:text-red-200'}`}
                  onClick={() => handleAthleteClick(r)}
                >
                  {r.dt_player_person.name}
                </td>
                <td className={`px-3 py-2 text-xs whitespace-nowrap font-medium ${isMale ? 'text-sky-400' : 'text-red-500'}`}>
                  {genderDisplay(r.dt_player_person.gender)}
                </td>
                {vis('event') && <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{r.mst_category.name}</td>}
                {vis('age') && <td className="px-3 py-2 text-white text-xs whitespace-nowrap">{r.mst_age.name}</td>}
                {vis('time') && (
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-white font-medium">
                    {r.time_display ?? '－'}
                  </td>
                )}
                {vis('dive') && (
                  <td className="px-3 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">
                    {r.dive_time != null ? parseFloat(r.dive_time).toFixed(2) : <span className="text-slate-700">－</span>}
                  </td>
                )}
                {vis('record') && (
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {r.is_world_record ? (
                      <span className="inline-block bg-purple-500/20 text-purple-300 text-xs px-1.5 py-0.5 rounded border border-purple-500/30">世界新</span>
                    ) : r.is_japan_record ? (
                      <span className="inline-block bg-sky-500/20 text-sky-300 text-xs px-1.5 py-0.5 rounded border border-sky-500/30">日本新</span>
                    ) : r.is_meet_record ? (
                      <span className="inline-block bg-amber-500/20 text-amber-300 text-xs px-1.5 py-0.5 rounded border border-amber-500/30">大会新</span>
                    ) : <span className="text-slate-700">－</span>}
                  </td>
                )}
                {vis('rank') && (
                  <td className="px-3 py-2 text-right text-white text-xs whitespace-nowrap">
                    {r.rank === 1 ? (
                      <span className="inline-flex items-center gap-1 justify-end">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[8px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                        <span className="text-amber-300 font-semibold">1位</span>
                      </span>
                    ) : r.rank === 2 ? (
                      <span className="inline-flex items-center gap-1 justify-end">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[8px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                        <span className="text-slate-300 font-semibold">2位</span>
                      </span>
                    ) : r.rank === 3 ? (
                      <span className="inline-flex items-center gap-1 justify-end">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[8px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                        <span className="text-amber-600 font-semibold">3位</span>
                      </span>
                    ) : r.rank != null ? `${r.rank}位` : '－'}
                  </td>
                )}
                {vis('points') && (
                  <td className="px-3 py-2 text-right text-amber-400 text-xs font-medium">
                    {r.points ? Math.round(Number(r.points)) : <span className="text-slate-600">－</span>}
                  </td>
                )}
                {vis('diff') && (
                  <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                    {(() => {
                      const d = formatDiffTime(r.meet_record_seconds, r.time_seconds)
                      if (!d) return <span className="text-slate-600">－</span>
                      const isPositive = d.startsWith('+')
                      return <span className={isPositive ? 'text-sky-400' : 'text-rose-400'}>{d}</span>
                    })()}
                  </td>
                )}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── Relay results table ──────────────────────────────────────
  const relayTable = relayResults.length > 0 && (
    <div className="mt-6">
      <div className="flex items-start justify-between mb-2 gap-2">
        <span className="text-sm font-bold text-white">リレー成績</span>
        <span className="text-xs text-slate-400 shrink-0 mt-0.5">{relayResults.length}件</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-indigo-900/40">
        <table className="w-full text-sm" style={{ minWidth: '700px' }}>
          <thead>
            <tr className="bg-gradient-to-r from-indigo-950 to-purple-950 text-left border-b border-indigo-800/40">
              <th className="px-3 py-2.5 font-semibold text-xs w-8 text-center text-slate-400 align-top">#</th>
              {relVis('relay_meet_round') && <SortTh field="meet_round" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort}>大会回</SortTh>}
              {relVis('relay_team') && <SortTh field="team" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort}>チーム</SortTh>}
              {relVis('relay_event') && <SortTh field="event" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort}>競技名</SortTh>}
              {relVis('relay_gender') && <SortTh field="gender" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort}>性別</SortTh>}
              {relVis('relay_age') && <SortTh field="age" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort}>年齢区分</SortTh>}
              {relVis('relay_time') && <SortTh field="time" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort}>タイム</SortTh>}
              <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 align-top">メンバー</th>
              {relVis('relay_record') && <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-center align-top">新記録</th>}
              {relVis('relay_rank') && <SortTh field="rank" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort} className="text-right">順位</SortTh>}
              {relVis('relay_points') && <SortTh field="points" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort} className="text-right">得点</SortTh>}
              {relVis('relay_diff') && <SortTh field="diff" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort} className="text-right">大会新差</SortTh>}
            </tr>
          </thead>
          <tbody>
            {sortedRelayResults.map((r, i) => {
              const catGender = r.mst_category.gender
              const rowBg = catGender === '男子'
                ? 'bg-sky-950/40 hover:bg-sky-900/40'
                : catGender === '女子'
                  ? 'bg-rose-900/20 hover:bg-rose-800/30'
                  : i % 2 === 0 ? 'bg-indigo-950/40 hover:bg-indigo-900/40' : 'bg-slate-900 hover:bg-slate-800'
              const genderColor = catGender === '男子'
                ? 'text-sky-300'
                : catGender === '女子'
                  ? 'text-rose-300'
                  : 'text-purple-300'
              return (
                <tr key={r.id} className={`${rowBg} transition-colors`}>
                  <td className="px-3 py-2 text-center text-slate-500 text-xs align-top">{i + 1}</td>
                  {relVis('relay_meet_round') && <td className="px-3 py-2 text-slate-400 text-xs text-center whitespace-nowrap align-top">第{r.mst_event.round}回</td>}
                  {relVis('relay_team') && <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap align-top">{teamDisplayName(r.mst_team.name)}</td>}
                  {relVis('relay_event') && <td className="px-3 py-2 text-slate-200 text-xs whitespace-nowrap align-top">{r.mst_category.name}</td>}
                  {relVis('relay_gender') && <td className={`px-3 py-2 text-xs font-medium whitespace-nowrap align-top ${genderColor}`}>{catGender}</td>}
                  {relVis('relay_age') && <td className="px-3 py-2 text-white text-xs whitespace-nowrap align-top">{r.mst_age?.name ?? r.age_group_label ?? '－'}</td>}
                  {relVis('relay_time') && (
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-white font-medium align-top">
                      {r.time_display ?? '－'}
                    </td>
                  )}
                  <td className="px-3 py-2 align-top">
                    <div className={`grid gap-x-3 gap-y-0 ${r.dt_player_relay.length <= 2 ? 'grid-cols-2' : r.dt_player_relay.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                      {r.dt_player_relay.map((m) => {
                        const isMemberMale = m.dt_player_person?.gender === '男子'
                        const split = formatSplitTime(m.split_seconds)
                        const diveStr = m.dive_time != null
                          ? `(${m.dive_time.toFixed(2)})`
                          : null
                        const memberRecordBadge = m.is_world_record
                          ? <span className="inline-block bg-purple-500/20 text-purple-300 text-xs px-1 rounded border border-purple-500/30">世界新</span>
                          : m.is_japan_record
                          ? <span className="inline-block bg-sky-500/20 text-sky-300 text-xs px-1 rounded border border-sky-500/30">日本新</span>
                          : m.is_meet_record
                          ? <span className="inline-block bg-amber-500/20 text-amber-300 text-xs px-1 rounded border border-amber-500/30">大会新</span>
                          : null
                        return (
                          <div key={m.swim_order} className="flex flex-col min-w-0">
                            <span
                              className={`text-xs font-medium truncate cursor-pointer hover:underline transition-colors ${isMemberMale ? 'text-sky-300 hover:text-sky-100' : 'text-red-400 hover:text-red-200'}`}
                              onClick={() => handleRelayMemberClick(m)}
                            >
                              {m.dt_player_person?.name ?? `ID:${m.player_id}`}
                            </span>
                            <span className="text-xs text-white font-mono">
                              {split ?? ''}
                              {diveStr && <span className="text-gray-400"> {diveStr}</span>}
                              {memberRecordBadge && <span className="ml-1">{memberRecordBadge}</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </td>
                  {relVis('relay_record') && (
                    <td className="px-3 py-2 text-center whitespace-nowrap align-top">
                      {r.is_meet_record ? (
                        <span className="inline-block bg-amber-500/20 text-amber-300 text-xs px-1.5 py-0.5 rounded border border-amber-500/30">大会新</span>
                      ) : <span className="text-slate-700">－</span>}
                    </td>
                  )}
                  {relVis('relay_rank') && (
                    <td className="px-3 py-2 text-right text-white text-xs whitespace-nowrap align-top">
                      {r.rank === 1 ? (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[8px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                          <span className="text-amber-300 font-semibold">1位</span>
                        </span>
                      ) : r.rank === 2 ? (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[8px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                          <span className="text-slate-300 font-semibold">2位</span>
                        </span>
                      ) : r.rank === 3 ? (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[8px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                          <span className="text-amber-600 font-semibold">3位</span>
                        </span>
                      ) : r.rank != null ? `${r.rank}位` : '－'}
                    </td>
                  )}
                  {relVis('relay_points') && (
                    <td className="px-3 py-2 text-right text-amber-400 text-xs font-medium align-top">
                      {r.team_points ? Math.round(Number(r.team_points)) : <span className="text-slate-600">－</span>}
                    </td>
                  )}
                  {relVis('relay_diff') && (
                    <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap align-top">
                      {(() => {
                        const d = formatDiffTime(r.meet_record_seconds, r.time_seconds)
                        if (!d) return <span className="text-slate-600">－</span>
                        const isPositive = d.startsWith('+')
                        return <span className={isPositive ? 'text-sky-400' : 'text-rose-400'}>{d}</span>
                      })()}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── Results area ─────────────────────────────────────────────
  const resultsArea = (
    <div className="h-full overflow-y-auto flex flex-col">
      {tournamentTitle}
      <div className="p-4 flex-1">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
            <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
            検索中…
          </div>
        )}

        {!loading && !selectedTeam && !athleteId && !eventKey && !gender && !ageValue && !rankFilter && !recordType && !meetId && (
          <div className="flex flex-col items-center justify-center py-20 select-none">
            <span className="text-5xl mb-4">⚠️</span>
            <p className="text-white font-medium text-base">検索結果が多すぎるのでもっと絞り込んでください</p>
          </div>
        )}

        {!loading && (sortedResults.length >= 500) && (
          <div className="flex flex-col items-center justify-center py-20 select-none">
            <span className="text-5xl mb-4">⚠️</span>
            <p className="text-white font-medium text-base">検索結果数が多すぎて表示できません。もっと絞り込んでください</p>
          </div>
        )}

        {!loading &&
          results.length === 0 &&
          relayResults.length === 0 &&
          (selectedTeam || athleteId || eventKey || gender || ageValue || rankFilter || recordType || meetId) && (
            <p className="text-center py-12 text-slate-500 text-sm">検索結果が0件です</p>
          )}

        {!loading && (individualTable || relayTable) && (
          <div>
            {individualTable}
            {relayTable}
          </div>
        )}
      </div>
    </div>
  )

  // ── Layout ────────────────────────────────────────────────────
  return (
    <>
      {/* Desktop: 3-column resizable */}
      <div className="hidden md:flex h-full overflow-hidden">
        <div
          className="shrink-0 bg-slate-800 border-r border-slate-700 overflow-y-auto flex flex-col"
          style={{ width: leftW }}
        >
          <div className="px-4 py-2.5 border-b border-slate-700/80 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              検索フィルター
            </span>
          </div>
          {filterPanel}
        </div>

        <div
          className="w-1 shrink-0 bg-slate-700 hover:bg-sky-500 cursor-col-resize transition-colors select-none"
          onMouseDown={(e) => startDrag('l', e)}
        />

        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">{resultsArea}</div>

        <div
          className="w-1 shrink-0 bg-slate-700 hover:bg-sky-500 cursor-col-resize transition-colors select-none"
          onMouseDown={(e) => startDrag('r', e)}
        />

        <div
          className="shrink-0 bg-slate-800 border-l border-slate-700 flex flex-col"
          style={{ width: rightW }}
        >
          <div className="px-4 py-2.5 border-b border-slate-700/80 shrink-0 flex items-center justify-between">
            <span className="text-xs font-bold text-white tracking-wide">
              過去レース記録
            </span>
            {athleteForHistory && (
              <button
                onClick={() => setAthleteForHistory(null)}
                className="ml-2 text-slate-600 hover:text-slate-400 shrink-0 leading-none"
                aria-label="閉じる"
              >
                ✕
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {!athleteForHistory ? (
              <div className="p-4 text-xs text-slate-600">
                <p className="mt-1 leading-relaxed">選手名をクリックすると<br />全大会の記録が表示されます</p>
              </div>
            ) : historyLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-xs">
                <span className="w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                読込中…
              </div>
            ) : !athleteHistory || athleteHistory.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">記録が見つかりません</div>
            ) : (
              <div className="p-3 flex flex-col gap-5">
                {/* 選手名・チーム名ヘッダー */}
                <div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-base font-bold text-white">{athleteForHistory.name}</span>
                    <span className={`text-xs font-medium ${athleteForHistory.gender === '男子' ? 'text-sky-400' : 'text-rose-400'}`}>
                      {genderDisplay(athleteForHistory.gender)}
                    </span>
                  </div>
                  {athleteForHistory.teamName && (
                    <div className="text-xs text-slate-400 mt-0.5">{teamDisplayName(athleteForHistory.teamName)}</div>
                  )}
                </div>
                {athleteHistory.map((meet) => {
                  const indPts = meet.individual.reduce((s, r) => s + (r.points ?? 0), 0)
                  const relPts = meet.relay.reduce((s, r) => s + (r.team_points ?? 0), 0)
                  const totalPts = indPts + relPts
                  return (
                    <div key={meet.round}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-sky-400">第{meet.round}回（{meet.pool_type}）</span>
                        {totalPts > 0 && (
                          <span className="text-xs text-amber-400 font-medium shrink-0 ml-1">{Math.round(totalPts)}pt</span>
                        )}
                      </div>
                      {/* 個人・リレー結果テーブル */}
                      <table className="w-full text-xs">
                        <tbody>
                          {meet.individual.map((r, i) => (
                            <tr key={i} className="border-t border-slate-700/40">
                              <td className="py-1 pr-1 text-slate-100">{r.event}</td>
                              <td className="py-1 pr-2 text-white whitespace-nowrap">{r.age_group}</td>
                              <td className="py-1 pr-2 font-mono text-white whitespace-nowrap">
                                {r.time_display ?? '－'}
                                {r.is_meet_record && <span className="ml-1 text-amber-400">★</span>}
                              </td>
                              <td className="py-1 text-right whitespace-nowrap">
                                {r.rank === 1 ? (
                                  <span className="inline-flex items-center gap-0.5 justify-end">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[7px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                                    <span className="text-amber-300 font-semibold">1位</span>
                                  </span>
                                ) : r.rank === 2 ? (
                                  <span className="inline-flex items-center gap-0.5 justify-end">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[7px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                                    <span className="text-slate-300 font-semibold">2位</span>
                                  </span>
                                ) : r.rank === 3 ? (
                                  <span className="inline-flex items-center gap-0.5 justify-end">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[7px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                                    <span className="text-amber-600 font-semibold">3位</span>
                                  </span>
                                ) : r.rank != null ? (
                                  <span className="text-white">{r.rank}位</span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                          {meet.relay.map((r, i) => (
                            <tr key={`relay-${i}`} className="border-t border-slate-700/40">
                              <td className="py-1 pr-1 text-indigo-300">R {r.event}</td>
                              <td className="py-1 pr-2 text-white whitespace-nowrap">{r.age_group ?? ''}</td>
                              <td className="py-1 pr-2 font-mono text-white whitespace-nowrap">{r.time_display ?? '－'}</td>
                              <td className="py-1 text-right whitespace-nowrap">
                                {r.rank === 1 ? (
                                  <span className="inline-flex items-center gap-0.5 justify-end">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[7px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                                    <span className="text-amber-300 font-semibold">1位</span>
                                  </span>
                                ) : r.rank === 2 ? (
                                  <span className="inline-flex items-center gap-0.5 justify-end">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[7px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                                    <span className="text-slate-300 font-semibold">2位</span>
                                  </span>
                                ) : r.rank === 3 ? (
                                  <span className="inline-flex items-center gap-0.5 justify-end">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[7px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                                    <span className="text-amber-600 font-semibold">3位</span>
                                  </span>
                                ) : r.rank != null ? (
                                  <span className="text-white">{r.rank}位</span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: stacked */}
      <div className="md:hidden flex flex-col h-full overflow-hidden">
        <button
          className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 text-sm font-medium text-slate-300 shrink-0 transition-colors"
          onClick={() => setShowMobileSearch((v) => !v)}
          aria-expanded={showMobileSearch}
        >
          <span>検索フィルター</span>
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform ${showMobileSearch ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showMobileSearch && (
          <div className="bg-slate-800 border-b border-slate-700 overflow-y-auto shrink-0 max-h-[55vh]">
            {filterPanel}
          </div>
        )}

        <div className="flex-1 overflow-hidden min-h-0">{resultsArea}</div>
      </div>
    </>
  )
}
