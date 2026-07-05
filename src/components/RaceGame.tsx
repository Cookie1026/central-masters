'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { TeamOption } from '@/types'

const RACER_COLORS = [
  '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa',
  '#facc15', '#2dd4bf', '#e879f9', '#94a3b8', '#fb7185',
]
const MAX_RACERS = 10
const SPEED_OPTIONS = [1, 2, 5, 10, 20] as const

type StrokeFilter = 'all' | '自由形' | '背泳ぎ' | '平泳ぎ' | 'バタフライ'

const STROKE_OPTIONS: { value: StrokeFilter; label: string; emoji: string }[] = [
  { value: 'all',      label: '縛りなし',   emoji: '🎮' },
  { value: '自由形',   label: '自由形',     emoji: '🏊' },
  { value: '背泳ぎ',   label: '背泳ぎ',     emoji: '🔄' },
  { value: '平泳ぎ',   label: '平泳ぎ',     emoji: '🐸' },
  { value: 'バタフライ', label: 'バタフライ', emoji: '🦋' },
]

interface Racer {
  key: string
  name: string
  team: string
  categoryName: string
  stroke: string
  distance: number
  timeSeconds: number
  color: string
  rank: number | null
  resultId: number
  meetRound: number
  ageName: string
}

interface RaceCandidate {
  id: number
  event_id: number
  player_id: number
  category_id: number
  age_id: number
  race_number: number | null
  rank: number | null
  time_seconds: number | string | null
  time_display: string | null
  is_meet_record: boolean
  dt_player_person: {
    id: number
    name: string
    gender: string
    team_id: number
    mst_team: { id: number; name: string }
  }
  mst_category: {
    id: number
    name: string
    stroke: string | null
    distance: number | null
  }
  mst_age: { id: number; name: string }
  mst_event: { id: number; round: number; pool_type: string }
}

interface FinishResult {
  racer: Racer
  finishOrder: number
  gapSeconds: number
}

function fmtTime(s: number): string {
  if (s <= 0) return '0.00'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${sec.toFixed(2).padStart(5, '0')}` : s.toFixed(2)
}

function getInitials(name: string): string {
  return name.slice(-2)
}

function getStrokeEmoji(stroke: string): string {
  switch (stroke) {
    case '自由形':    return '🏊'
    case '背泳ぎ':    return '🔄'
    case '平泳ぎ':    return '🐸'
    case 'バタフライ': return '🦋'
    case 'メドレー':   return '🎯'
    default:          return '🏊'
  }
}

function teamDisplayName(name: string): string {
  return name.replace(/^セ・/, '')
}

interface Props {
  teams: TeamOption[]
}

export default function RaceGame({ teams }: Props) {
  const [selectedRacers, setSelectedRacers] = useState<Racer[]>([])
  const [strokeFilter, setStrokeFilter] = useState<StrokeFilter>('all')
  const [teamFilter, setTeamFilter]       = useState(0)
  const [nameFilter, setNameFilter]       = useState('')
  const [candidates, setCandidates]       = useState<RaceCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const [quickMode, setQuickMode] = useState<'browse' | 'records' | 'near' | 'actual'>('browse')
  const [expandedPlayers, setExpandedPlayers] = useState<Set<number>>(new Set())
  const [poolLength, setPoolLength]       = useState<25 | 50>(25)
  const [speed, setSpeed]                 = useState<typeof SPEED_OPTIONS[number]>(5)
  const [raceControl, setRaceControl]     = useState<'step' | 'full'>('step')
  const [phase, setPhase]                 = useState<'setup' | 'running' | 'paused' | 'finished'>('setup')
  const [finishResults, setFinishResults] = useState<FinishResult[]>([])
  const [elapsedDisplay, setElapsedDisplay] = useState(0)

  // Refs for direct DOM animation (no React state updates in tick loop)
  const swimmerRefs  = useRef<(HTMLDivElement | null)[]>([])
  const lapLabelRefs = useRef<(HTMLSpanElement | null)[]>([])
  const timeRefs     = useRef<(HTMLSpanElement | null)[]>([])
  const racersRef    = useRef<Racer[]>([])
  const speedRef     = useRef(speed)
  const poolRef      = useRef(poolLength)
  const startTsRef   = useRef(0)
  const elapsedBaseRef = useRef(0)
  const animRef      = useRef(0)
  const runningRef   = useRef(false)

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => teamDisplayName(a.name).localeCompare(teamDisplayName(b.name), 'ja')),
    [teams],
  )
  const baseRacer = selectedRacers[0] ?? null

  const loadCandidates = useCallback(async (
    mode: 'browse' | 'records' | 'near' | 'actual' = quickMode,
  ) => {
    if ((mode === 'near' || mode === 'actual') && !baseRacer) return
    setCandidatesLoading(true)
    setCandidateError('')
    const params = new URLSearchParams({ mode })
    if (mode === 'browse' || mode === 'records') {
      params.set('stroke', strokeFilter)
      if (teamFilter) params.set('teamId', String(teamFilter))
      if (nameFilter.trim()) params.set('name', nameFilter.trim())
    } else if (baseRacer) {
      params.set('baseResultId', String(baseRacer.resultId))
    }
    try {
      const response = await fetch(`/api/race-game?${params}`)
      const data = await response.json() as { results?: RaceCandidate[]; error?: string }
      if (!response.ok || data.error) throw new Error(data.error ?? '候補を取得できませんでした')
      setCandidates(data.results ?? [])
      setExpandedPlayers(new Set())
    } catch (error) {
      setCandidates([])
      setCandidateError(error instanceof Error ? error.message : '候補を取得できませんでした')
    } finally {
      setCandidatesLoading(false)
    }
  }, [baseRacer, nameFilter, quickMode, strokeFilter, teamFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCandidates(quickMode), nameFilter ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [loadCandidates, nameFilter, quickMode, strokeFilter, teamFilter])

  const groupedCandidates = useMemo(() => {
    const groups = new Map<number, { player: RaceCandidate['dt_player_person']; results: RaceCandidate[] }>()
    for (const result of candidates) {
      const current = groups.get(result.player_id)
      if (current) current.results.push(result)
      else groups.set(result.player_id, { player: result.dt_player_person, results: [result] })
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        results: group.results.sort((a, b) =>
          b.mst_event.round - a.mst_event.round || Number(a.time_seconds) - Number(b.time_seconds)
        ),
      }))
      .sort((a, b) => a.player.name.localeCompare(b.player.name, 'ja'))
  }, [candidates])

  const addRacer = (r: RaceCandidate) => {
    if (selectedRacers.length >= MAX_RACERS) return
    const key = `${r.id}`
    if (selectedRacers.some((s) => s.key === key)) return
    const dist = r.mst_category.distance ?? poolLength
    const t    = Number(r.time_seconds ?? 0)
    if (!t || !dist) return
    const racer: Racer = {
      key,
      name:         r.dt_player_person.name,
      team:         r.dt_player_person.mst_team.name,
      categoryName: r.mst_category.name,
      stroke:       r.mst_category.stroke ?? '',
      distance:     dist,
      timeSeconds:  t,
      color:        RACER_COLORS[selectedRacers.length],
      rank:         r.rank,
      resultId:     r.id,
      meetRound:    r.mst_event.round,
      ageName:      r.mst_age.name,
    }
    setSelectedRacers((prev) => [...prev, racer])
  }

  const addActualRace = () => {
    const racers = candidates.slice(0, MAX_RACERS).map((result, index): Racer => ({
      key: `${result.id}`,
      name: result.dt_player_person.name,
      team: result.dt_player_person.mst_team.name,
      categoryName: result.mst_category.name,
      stroke: result.mst_category.stroke ?? '',
      distance: result.mst_category.distance ?? poolLength,
      timeSeconds: Number(result.time_seconds),
      color: RACER_COLORS[index],
      rank: result.rank,
      resultId: result.id,
      meetRound: result.mst_event.round,
      ageName: result.mst_age.name,
    }))
    setSelectedRacers(racers)
  }

  const removeRacer = (key: string) => {
    setSelectedRacers((prev) => {
      const next = prev.filter((r) => r.key !== key)
      return next.map((r, i) => ({ ...r, color: RACER_COLORS[i] }))
    })
  }

  const reset = useCallback(() => {
    cancelAnimationFrame(animRef.current)
    runningRef.current = false
    elapsedBaseRef.current = 0
    setPhase('setup')
    setFinishResults([])
    setElapsedDisplay(0)
  }, [])

  const tick = useCallback((ts: number) => {
    if (!runningRef.current) return
    const elapsed = elapsedBaseRef.current + (ts - startTsRef.current) / 1000 * speedRef.current
    const racers  = racersRef.current
    const pool    = poolRef.current
    const remainingFinishTimes = racers
      .map((racer) => racer.timeSeconds)
      .filter((time) => time > elapsedBaseRef.current + 0.0001)
      .sort((a, b) => a - b)
    const nextFinishTime = raceControl === 'full'
      ? remainingFinishTimes[remainingFinishTimes.length - 1]
      : remainingFinishTimes[0]
    const displayElapsed = nextFinishTime != null ? Math.min(elapsed, nextFinishTime) : elapsed

    for (let i = 0; i < racers.length; i++) {
      const racer      = racers[i]
      const swimSpeed  = racer.distance / racer.timeSeconds
      const distCovered = displayElapsed * swimSpeed

      if (distCovered >= racer.distance) {
        // Clamp swimmer exactly at finish line
        // finLap odd → swimmer ended at right wall (100%); even → left wall (0%)
        const finLap = Math.floor(racer.distance / pool)
        const finX   = finLap % 2 === 1 ? 100 : 0
        const el = swimmerRefs.current[i]
        if (el) el.style.left = `calc(${finX}% - 16px)`
      } else {
        const lapFrac  = distCovered / pool
        const lapNum   = Math.floor(lapFrac)
        const posInLap = lapFrac - lapNum
        const xPct     = lapNum % 2 === 0 ? posInLap * 100 : (1 - posInLap) * 100
        const el = swimmerRefs.current[i]
        if (el) el.style.left = `calc(${xPct}% - 16px)`

        const totalLaps = Math.ceil(racer.distance / pool)
        const lapEl = lapLabelRefs.current[i]
        if (lapEl) lapEl.textContent = totalLaps > 1 ? `${lapNum + 1}/${totalLaps}周` : ''
      }

      const timeEl = timeRefs.current[i]
      if (timeEl) timeEl.textContent = fmtTime(Math.min(displayElapsed, racer.timeSeconds))
    }

    setElapsedDisplay(displayElapsed)

    if (nextFinishTime != null && elapsed >= nextFinishTime) {
      const winner = racers.reduce((best, r) => r.timeSeconds < best.timeSeconds ? r : best)
      const fr: FinishResult[] = racers
        .filter((racer) => racer.timeSeconds <= nextFinishTime + 0.0001)
        .slice()
        .sort((a, b) => a.timeSeconds - b.timeSeconds)
        .map((r, idx) => ({
          racer:       r,
          finishOrder: idx + 1,
          gapSeconds:  r.timeSeconds - winner.timeSeconds,
        }))
      cancelAnimationFrame(animRef.current)
      runningRef.current = false
      setFinishResults(fr)
      elapsedBaseRef.current = nextFinishTime
      setPhase(fr.length === racers.length ? 'finished' : 'paused')
      return
    }

    animRef.current = requestAnimationFrame(tick)
  }, [raceControl])

  const startRace = useCallback(() => {
    if (selectedRacers.length < 1) return
    racersRef.current  = selectedRacers
    speedRef.current   = speed
    poolRef.current    = poolLength
    startTsRef.current = performance.now()
    elapsedBaseRef.current = 0
    runningRef.current = true
    setPhase('running')
    setElapsedDisplay(0)
    animRef.current = requestAnimationFrame(tick)
  }, [selectedRacers, speed, poolLength, tick])

  const continueRace = useCallback(() => {
    if (phase !== 'paused') return
    startTsRef.current = performance.now()
    runningRef.current = true
    setPhase('running')
    animRef.current = requestAnimationFrame(tick)
  }, [phase, tick])

  const restartRace = useCallback(() => {
    cancelAnimationFrame(animRef.current)
    racersRef.current = selectedRacers
    speedRef.current = speed
    poolRef.current = poolLength
    startTsRef.current = performance.now()
    elapsedBaseRef.current = 0
    runningRef.current = true
    setFinishResults([])
    setElapsedDisplay(0)
    setPhase('running')
    animRef.current = requestAnimationFrame(tick)
  }, [poolLength, selectedRacers, speed, tick])

  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => () => cancelAnimationFrame(animRef.current), [])

  const isRunning  = phase === 'running'
  const isPaused   = phase === 'paused'
  const isFinished = phase === 'finished'
  const isRaceView = isRunning || isPaused || isFinished
  const displayRacers = isRaceView ? racersRef.current : selectedRacers

  return (
    <div className="p-4 pb-24 space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          🏊 ライバルレースゲーム
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">倍速:</span>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                speed === s ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
              onClick={() => { setSpeed(s); speedRef.current = s }}
            >
              {s}x
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-2">プール:</span>
          {([25, 50] as const).map((pl) => (
            <button
              key={pl}
              disabled={isRunning}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                poolLength === pl
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40'
              }`}
              onClick={() => { setPoolLength(pl); poolRef.current = pl }}
            >
              {pl}m
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-2">進行:</span>
          <button
            disabled={isRunning}
            onClick={() => setRaceControl('step')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              raceControl === 'step' ? 'bg-sky-700 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            ⏸ ゴールごと
          </button>
          <button
            disabled={isRunning}
            onClick={() => setRaceControl('full')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              raceControl === 'full' ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            ▶ 完全レース
          </button>
        </div>
      </div>

      {/* ── Setup ── */}
      {phase === 'setup' && (
        <div className="space-y-3">

          {/* Step 1: Stroke type */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
              STEP 1 — レース種類を選ぶ
            </p>
            <div className="flex flex-wrap gap-2">
              {STROKE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStrokeFilter(opt.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    strokeFilter === opt.value
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-900/40'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            {strokeFilter === 'all' && (
              <p className="text-[10px] text-slate-600 mt-2">
                異なる種目の選手を混在できるドリームレースモード。現実ではありえない夢の対決！
              </p>
            )}
          </div>

          {/* Step 2 & 3: Candidate list + Selected */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* Candidate list */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
              STEP 2 — 選手を選ぶ{' '}
                <span className="normal-case text-slate-600 font-normal">（最大{MAX_RACERS}名）</span>
              </p>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {([
                  ['browse', '🔎 選手を探す'],
                  ['records', '🏆 大会新'],
                  ['near', '⚡ 近いタイム'],
                  ['actual', '🎬 実レース再現'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    disabled={(mode === 'near' || mode === 'actual') && !baseRacer}
                    onClick={() => setQuickMode(mode)}
                    className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors disabled:opacity-30 ${
                      quickMode === mode
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(quickMode === 'near' || quickMode === 'actual') && baseRacer && (
                <div className="mb-3 rounded-lg border border-violet-500/20 bg-violet-950/20 px-3 py-2 text-[10px] text-violet-200">
                  基準：{baseRacer.name}・第{baseRacer.meetRound}回 {baseRacer.categoryName}
                  {quickMode === 'near' ? `・${fmtTime(baseRacer.timeSeconds)}に近い順` : 'の同じ組を再現'}
                </div>
              )}
              {/* Filters */}
              {(quickMode === 'browse' || quickMode === 'records') && (
                <div className="flex gap-2 mb-3">
                  <select
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-sky-600"
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(Number(e.target.value))}
                  >
                    <option value={0}>全チーム</option>
                    {sortedTeams.map((team) => (
                      <option key={team.id} value={team.id}>{teamDisplayName(team.name)}</option>
                    ))}
                  </select>
                  <input
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-600"
                    placeholder="選手名…"
                    value={nameFilter}
                    onChange={(e) => setNameFilter(e.target.value)}
                  />
                </div>
              )}
              {/* List */}
              <div className="h-72 overflow-y-auto space-y-1 pr-1">
                {candidatesLoading && (
                  <p className="text-center text-slate-500 text-xs py-8">候補を読み込み中…</p>
                )}
                {!candidatesLoading && candidateError && (
                  <p className="text-center text-rose-400 text-xs py-8">{candidateError}</p>
                )}
                {!candidatesLoading && quickMode === 'actual' && candidates.length > 0 && (
                  <button
                    onClick={addActualRace}
                    className="mb-2 w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-600"
                  >
                    このレースの{Math.min(candidates.length, MAX_RACERS)}名をまとめて選択
                  </button>
                )}
                {!candidatesLoading && groupedCandidates.map((group) => {
                  const isOpen = expandedPlayers.has(group.player.id)
                    || quickMode === 'near'
                    || quickMode === 'actual'
                    || group.results.length === 1
                  return (
                    <div key={group.player.id} className="overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/40">
                      <button
                        onClick={() => setExpandedPlayers((previous) => {
                          const next = new Set(previous)
                          if (next.has(group.player.id)) next.delete(group.player.id)
                          else next.add(group.player.id)
                          return next
                        })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
                      >
                        <span className="text-xs">{isOpen ? '▾' : '▸'}</span>
                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">{group.player.name}</span>
                        <span className="truncate text-[10px] text-slate-500">{teamDisplayName(group.player.mst_team.name)}</span>
                        <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500">{group.results.length}</span>
                      </button>
                      {isOpen && (
                        <div className="border-t border-slate-800 py-1">
                          {group.results.map((result) => {
                            const key = `${result.id}`
                            const already = selectedRacers.some((racer) => racer.key === key)
                            const full = selectedRacers.length >= MAX_RACERS
                            return (
                              <button
                                key={key}
                                disabled={already || full}
                                onClick={() => addRacer(result)}
                                className={`flex w-full items-center gap-2 py-1.5 pl-8 pr-3 text-left text-[11px] transition-colors ${
                                  already
                                    ? 'bg-sky-900/30 text-sky-300'
                                    : full
                                      ? 'cursor-not-allowed opacity-30'
                                      : 'text-slate-300 hover:bg-slate-800'
                                }`}
                              >
                                <span>{result.is_meet_record ? '🏆' : getStrokeEmoji(result.mst_category.stroke ?? '')}</span>
                                <span className="min-w-0 flex-1 truncate">
                                  第{result.mst_event.round}回　{result.mst_category.name}
                                  <span className="ml-1 text-slate-600">{result.mst_age.name}</span>
                                </span>
                                <span className="shrink-0 font-mono text-slate-200">{fmtTime(Number(result.time_seconds))}</span>
                                {already && <span className="text-sky-400">✓</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!candidatesLoading && !candidateError && candidates.length === 0 && (
                  <p className="text-center text-slate-600 text-xs py-8">
                    {quickMode === 'near' || quickMode === 'actual'
                      ? '先に基準にする記録を1つ選んでください'
                      : strokeFilter !== 'all'
                        ? `${strokeFilter}の記録が見つかりません`
                        : '候補なし'}
                  </p>
                )}
              </div>
            </div>

            {/* Selected racers + Start button */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 flex flex-col">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                出場選手{' '}
                <span className="normal-case text-slate-600 font-normal">{selectedRacers.length}/{MAX_RACERS}</span>
              </p>
              <div className="flex-1 space-y-2 min-h-[120px]">
                {selectedRacers.length === 0 && (
                  <p className="text-slate-600 text-xs text-center py-8">← 左から選手をクリックして追加</p>
                )}
                {selectedRacers.map((racer) => (
                  <div key={racer.key} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/60">
                    <span
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-900"
                      style={{ background: racer.color }}
                    >
                      {getInitials(racer.name)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{racer.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {getStrokeEmoji(racer.stroke)} 第{racer.meetRound}回 {racer.categoryName} · {fmtTime(racer.timeSeconds)}
                      </div>
                    </div>
                    <button
                      className="text-slate-600 hover:text-rose-400 text-xs px-1"
                      onClick={() => removeRacer(racer.key)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                disabled={selectedRacers.length < 1}
                onClick={startRace}
                className="mt-4 w-full py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-lg shadow-sky-900/40"
              >
                🏁 スタート！
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Race Track ── */}
      {isRaceView && (
        <div className="rounded-xl border border-slate-700/60 overflow-hidden">

          {/* Track header */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800/60 border-b border-slate-700/40">
            <div className="text-xs text-slate-400">
              {isRunning ? (
                <span className="text-emerald-400 font-bold animate-pulse">
                  ▶ RACE · {raceControl === 'full' ? '完全レース' : 'ゴールごと'}
                </span>
              ) : isPaused ? (
                <span className="text-sky-400 font-bold">⏸ ゴール待機</span>
              ) : (
                <span className="text-amber-400 font-bold">🏁 FINISH</span>
              )}
              <span className="ml-3 font-mono text-slate-300">
                {fmtTime(elapsedDisplay)}
                {isRunning && (
                  <span className="text-slate-600 ml-1 text-[10px]">経過 ({speed}x)</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">倍速</span>
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                        speed === s ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                      onClick={() => { setSpeed(s); speedRef.current = s }}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
              {isPaused && (
                <button
                  className="text-xs px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold"
                  onClick={continueRace}
                >
                  ▶ 続行
                </button>
              )}
              <button
                className="text-xs px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white"
                onClick={restartRace}
              >
                ↻ 再実行
              </button>
              <button
                className="text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                onClick={reset}
              >
                ← 戻る
              </button>
            </div>
          </div>

          {/* Pool lanes */}
          <div className="bg-slate-950 px-4 py-3 space-y-2">
            <div className="flex text-[9px] text-slate-600 font-mono mb-1">
              <span className="flex-none w-20" />
              <span className="flex-1 text-left pl-1">START</span>
              <span className="flex-none pr-1">FINISH</span>
            </div>

            {displayRacers.map((racer, i) => {
              const totalLaps = Math.ceil(racer.distance / poolLength)
              const finishedRow = finishResults.find((result) => result.racer.key === racer.key)
              const isWinner = finishResults[0]?.racer.key === racer.key
              return (
                <div key={racer.key} className="flex items-center gap-2">
                  {/* Lane label */}
                  <div className="flex-none w-20 flex items-center gap-1.5">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-900"
                      style={{ background: racer.color }}
                    >
                      {getInitials(racer.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[9px] text-slate-300 truncate leading-tight">{racer.name.slice(0, 4)}</div>
                      <span
                        ref={(el) => { lapLabelRefs.current[i] = el }}
                        className="text-[8px] text-slate-600 leading-tight"
                      >
                        {totalLaps > 1 ? `1/${totalLaps}周` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Pool lane */}
                  <div
                    className="flex-1 relative rounded overflow-hidden"
                    style={{
                      height: '36px',
                      background: `linear-gradient(180deg, rgba(${hexToRgb(racer.color)},0.05) 0%, rgba(${hexToRgb(racer.color)},0.02) 100%)`,
                      border: `1px solid rgba(${hexToRgb(racer.color)},0.15)`,
                    }}
                  >
                    {/* Lap dividers */}
                    {totalLaps > 1 && Array.from({ length: totalLaps - 1 }).map((_, li) => (
                      <div
                        key={li}
                        className="absolute top-0 bottom-0 w-px"
                        style={{
                          left: `${((li + 1) / totalLaps) * 100}%`,
                          borderLeft: '1px dashed rgba(100,116,139,0.25)',
                        }}
                      />
                    ))}

                    {/* Swimmer */}
                    <div
                      ref={(el) => { swimmerRefs.current[i] = el }}
                      className="absolute top-1/2 -translate-y-1/2 transition-none"
                      style={{ left: 'calc(0% - 16px)', width: '32px', height: '28px' }}
                    >
                      <div
                        className="w-full h-full rounded-full flex items-center justify-center text-[13px] shadow-md"
                        style={{ background: racer.color }}
                      >
                        {getStrokeEmoji(racer.stroke)}
                      </div>
                    </div>

                    {/* Finish wall */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1"
                      style={{ background: `rgba(${hexToRgb(racer.color)},0.4)` }}
                    />
                  </div>

                  {/* Time */}
                  <div className="flex-none w-16 text-right">
                    <span
                      ref={(el) => { timeRefs.current[i] = el }}
                      className="font-mono text-xs text-slate-400"
                    >
                      {fmtTime(racer.timeSeconds)}
                    </span>
                    {finishedRow && (
                      <div className="text-[9px] text-slate-600 mt-0.5">
                        {isWinner
                          ? <span className="text-amber-400 font-bold">🥇 1位</span>
                          : <span className="text-rose-400">+{finishedRow.gapSeconds.toFixed(2)}s</span>
                        }
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Finish results */}
          {(isPaused || isFinished) && finishResults.length > 0 && (
            <div className="border-t border-slate-700/50 px-4 py-3 bg-slate-900/40">
              <p className="text-xs font-bold text-amber-400 mb-2">🏁 レース結果</p>
              <div className="space-y-1.5">
                {finishResults.map((fr) => (
                  <div key={fr.racer.key} className="flex items-center gap-3 text-xs">
                    <span className="w-5 text-center font-bold text-slate-500">{fr.finishOrder}</span>
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-900 shrink-0"
                      style={{ background: fr.racer.color }}
                    >
                      {getInitials(fr.racer.name)}
                    </span>
                    <span className="flex-1 text-slate-200 truncate font-medium">{fr.racer.name}</span>
                    <span className="text-slate-500 truncate text-[10px] shrink-0">{fr.racer.categoryName}</span>
                    <span className="font-mono text-white shrink-0">{fmtTime(fr.racer.timeSeconds)}</span>
                    {fr.gapSeconds > 0
                      ? <span className="font-mono text-rose-400 shrink-0">+{fr.gapSeconds.toFixed(2)}s</span>
                      : <span className="text-amber-400 shrink-0">🥇</span>
                    }
                  </div>
                ))}
              </div>
              {isPaused && (
                <button
                  className="mt-3 w-full py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                  onClick={continueRace}
                >
                  ▶ 続行 — 次の選手がゴールするまで
                </button>
              )}
              <button
                className="mt-2 w-full py-2 rounded-lg text-xs font-bold bg-violet-700 hover:bg-violet-600 text-white transition-colors"
                onClick={restartRace}
              >
                ↻ 同じメンバーでレース再実行
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'setup' && (
        <p className="text-[10px] text-slate-600 text-center">
          実際の記録タイムでライバルとのレースを再現。倍速モードで400mも快適に楽しめます。
        </p>
      )}
    </div>
  )
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}
