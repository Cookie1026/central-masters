'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { IndividualResult } from '@/types'

const RACER_COLORS = ['#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa']
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

interface Props {
  results: IndividualResult[]
}

export default function RaceGame({ results }: Props) {
  const [selectedRacers, setSelectedRacers] = useState<Racer[]>([])
  const [strokeFilter, setStrokeFilter] = useState<StrokeFilter>('all')
  const [teamFilter, setTeamFilter]       = useState('')
  const [nameFilter, setNameFilter]       = useState('')
  const [poolLength, setPoolLength]       = useState<25 | 50>(25)
  const [speed, setSpeed]                 = useState<typeof SPEED_OPTIONS[number]>(5)
  const [phase, setPhase]                 = useState<'setup' | 'running' | 'finished'>('setup')
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
  const animRef      = useRef(0)
  const runningRef   = useRef(false)

  // Unique teams from results
  const teams = [...new Set(
    results.map((r) => r.dt_player_person?.mst_team?.name ?? '').filter(Boolean)
  )].sort()

  // Filtered candidates
  const candidates = results.filter((r) => {
    const name   = r.dt_player_person?.name ?? ''
    const team   = r.dt_player_person?.mst_team?.name ?? ''
    const stroke = (r.mst_category as unknown as { stroke?: string })?.stroke ?? ''
    const t      = Number(r.time_seconds ?? 0)
    if (!t) return false
    if (strokeFilter !== 'all' && stroke !== strokeFilter) return false
    if (teamFilter && team !== teamFilter) return false
    if (nameFilter && !name.includes(nameFilter)) return false
    return true
  })

  // Auto-detect pool length from first result
  useEffect(() => {
    if (results.length > 0) {
      const pt = (results[0].mst_event as { pool_type?: string })?.pool_type ?? ''
      const pl: 25 | 50 = pt === '長水路' ? 50 : 25
      setPoolLength(pl)
      poolRef.current = pl
    }
  }, [results])

  const addRacer = (r: IndividualResult) => {
    if (selectedRacers.length >= 5) return
    const key = `${r.id}`
    if (selectedRacers.some((s) => s.key === key)) return
    const dist = r.mst_category?.distance ?? poolLength
    const t    = Number(r.time_seconds ?? 0)
    if (!t || !dist) return
    const racer: Racer = {
      key,
      name:         r.dt_player_person?.name ?? '?',
      team:         r.dt_player_person?.mst_team?.name ?? '',
      categoryName: r.mst_category?.name ?? '',
      stroke:       (r.mst_category as unknown as { stroke?: string })?.stroke ?? '',
      distance:     dist,
      timeSeconds:  t,
      color:        RACER_COLORS[selectedRacers.length],
      rank:         r.rank,
    }
    setSelectedRacers((prev) => [...prev, racer])
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
    setPhase('setup')
    setFinishResults([])
    setElapsedDisplay(0)
  }, [])

  const tick = useCallback((ts: number) => {
    if (!runningRef.current) return
    const elapsed = (ts - startTsRef.current) / 1000 * speedRef.current
    const racers  = racersRef.current
    const pool    = poolRef.current

    let anyFinished = false

    for (let i = 0; i < racers.length; i++) {
      const racer      = racers[i]
      const swimSpeed  = racer.distance / racer.timeSeconds
      const distCovered = elapsed * swimSpeed

      if (distCovered >= racer.distance) {
        anyFinished = true
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
      if (timeEl) timeEl.textContent = fmtTime(Math.min(elapsed, racer.timeSeconds))
    }

    setElapsedDisplay(elapsed)

    if (anyFinished) {
      const winner = racers.reduce((best, r) => r.timeSeconds < best.timeSeconds ? r : best)
      const fr: FinishResult[] = racers
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
      setPhase('finished')
      return
    }

    animRef.current = requestAnimationFrame(tick)
  }, [])

  const startRace = useCallback(() => {
    if (selectedRacers.length < 1) return
    racersRef.current  = selectedRacers
    speedRef.current   = speed
    poolRef.current    = poolLength
    startTsRef.current = performance.now()
    runningRef.current = true
    setPhase('running')
    setElapsedDisplay(0)
    animRef.current = requestAnimationFrame(tick)
  }, [selectedRacers, speed, poolLength, tick])

  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => () => cancelAnimationFrame(animRef.current), [])

  const isRunning  = phase === 'running'
  const isFinished = phase === 'finished'
  const displayRacers = isRunning || isFinished ? racersRef.current : selectedRacers

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
                <span className="normal-case text-slate-600 font-normal">（最大5名）</span>
              </p>
              {/* Filters */}
              <div className="flex gap-2 mb-3">
                <select
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-sky-600"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                >
                  <option value="">全チーム</option>
                  {teams.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-600"
                  placeholder="名前で絞り込み…"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                />
              </div>
              {/* List */}
              <div className="h-52 overflow-y-auto space-y-0.5 pr-1">
                {candidates.slice(0, 150).map((r) => {
                  const key    = `${r.id}`
                  const already = selectedRacers.some((s) => s.key === key)
                  const full   = selectedRacers.length >= 5
                  const t      = Number(r.time_seconds ?? 0)
                  const stroke = (r.mst_category as unknown as { stroke?: string })?.stroke ?? ''
                  return (
                    <button
                      key={key}
                      disabled={already || full}
                      onClick={() => addRacer(r)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-colors text-xs ${
                        already
                          ? 'bg-sky-900/30 text-sky-400 cursor-default'
                          : full
                          ? 'opacity-30 cursor-not-allowed text-slate-400'
                          : 'hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      <span className="text-sm leading-none shrink-0">{getStrokeEmoji(stroke)}</span>
                      <span className="truncate font-medium flex-1">{r.dt_player_person?.name}</span>
                      <span className="text-slate-500 shrink-0 text-[10px] max-w-[100px] truncate">
                        {r.mst_category?.name}
                      </span>
                      <span className="font-mono text-slate-300 shrink-0">{fmtTime(t)}</span>
                      {already && <span className="text-sky-500 shrink-0 text-[10px]">✓</span>}
                    </button>
                  )
                })}
                {candidates.length === 0 && (
                  <p className="text-center text-slate-600 text-xs py-8">
                    {strokeFilter !== 'all'
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
                <span className="normal-case text-slate-600 font-normal">{selectedRacers.length}/5</span>
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
                        {getStrokeEmoji(racer.stroke)} {racer.categoryName} · {fmtTime(racer.timeSeconds)}
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
      {(isRunning || isFinished) && (
        <div className="rounded-xl border border-slate-700/60 overflow-hidden">

          {/* Track header */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800/60 border-b border-slate-700/40">
            <div className="text-xs text-slate-400">
              {isRunning ? (
                <span className="text-emerald-400 font-bold animate-pulse">▶ RACE</span>
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
              const isWinner  = isFinished && finishResults[0]?.racer.key === racer.key
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
                    {isFinished && (
                      <div className="text-[9px] text-slate-600 mt-0.5">
                        {isWinner
                          ? <span className="text-amber-400 font-bold">🥇 1位</span>
                          : <span className="text-rose-400">+{(finishResults.find(f => f.racer.key === racer.key)?.gapSeconds ?? 0).toFixed(2)}s</span>
                        }
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Finish results */}
          {isFinished && finishResults.length > 0 && (
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
              <button
                className="mt-3 w-full py-2 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                onClick={reset}
              >
                ← もう一度レースする
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
