'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatEventDisplay } from '@/lib/event-display'

interface CandidateDetail {
  name: string
  seconds: number
  source: 'individual' | 'relay'
}

interface RelayMember {
  swim_order: number
  stroke: string
  name: string
  splitSeconds: number | null
}

interface OptimalMember {
  swim_order: number
  stroke: string
  name: string
  splitSeconds: number
  source: 'individual' | 'relay'
}

interface CandidateInfo {
  order: number
  stroke: string
  count: number
  candidates: CandidateDetail[]
}

interface OptimizedRelay {
  categoryName: string
  ageGroup: string
  relayStroke: string
  actualRank: number | null
  actualTeamTime: number
  actualPoints: number
  actualMembers: RelayMember[]
  optimalRank: number
  optimalTime: number
  optimalPoints: number
  optimalMembers: OptimalMember[]
  pointsGain: number
  isCurrentOptimal: boolean
  firstPlaceTime: number | null
  fieldTimes: number[]
  candidatesPerOrder: CandidateInfo[]
}

interface RelayOptimizeResult {
  optimizations: OptimizedRelay[]
  totalActualPoints: number
  totalOptimalPoints: number
  totalGain: number
  teamRankings: { rank: number; total_points: number; mst_team: { name: string } }[]
}

interface HistoryRelay {
  rank: number | null
  time_seconds: number
  mst_event: { id: number; round: number }
  mst_category: { id: number; name: string }
}

function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '－'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2)
}

function rankToPoints(r: number): number {
  return Math.max(0, 11 - r)
}

const STROKE_SHORT: Record<string, string> = {
  '背泳ぎ': 'Back',
  '平泳ぎ': 'Breast',
  'バタフライ': 'Fly',
  '自由形': 'Free',
}

interface Props {
  eventId: number
  teamId: number
  teamName: string
  meetRound: number
}

// ─── A: Gap chart section ────────────────────────────────────────────────────

function GapChartSection({ optimizations }: { optimizations: OptimizedRelay[] }) {
  const rows = optimizations.filter((o) => o.firstPlaceTime != null)
  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-yellow-700/30 bg-yellow-950/10 p-4 space-y-5">
      <div className="flex items-center gap-2">
        <span className="w-1 h-4 rounded bg-yellow-400 shrink-0" />
        <h3 className="text-sm font-bold text-white">1位との差分チャート</h3>
      </div>

      {rows.map((opt, i) => {
        const first = opt.firstPlaceTime!
        const relayCount = opt.actualMembers.length || 4
        const gap = opt.optimalTime - first
        const maxTime = Math.max(opt.actualTeamTime, first) * 1.03
        const barPct = (t: number) => `${Math.round((t / maxTime) * 100)}%`
        const alreadyFirst = opt.optimalRank === 1

        return (
          <div key={i} className="space-y-1">
            <div className="text-[11px] font-bold text-slate-200">
              {formatEventDisplay(opt.categoryName)}
              <span className="text-slate-500 ml-2 font-normal">{opt.ageGroup}</span>
            </div>

            {/* Actual team time */}
            <div className="flex items-center gap-2 text-[10px]">
              <span className="w-10 text-right shrink-0 text-slate-500">実績</span>
              <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                <div
                  className="h-full bg-slate-500/70 rounded flex items-center px-1.5 transition-all"
                  style={{ width: barPct(opt.actualTeamTime) }}
                >
                  <span className="font-mono text-white whitespace-nowrap text-[9px]">{formatTime(opt.actualTeamTime)}</span>
                </div>
              </div>
              <span className="w-8 text-slate-500 shrink-0">
                {opt.actualRank != null ? `${opt.actualRank}位` : '－'}
              </span>
            </div>

            {/* Optimal team time (only if different) */}
            {opt.optimalTime < opt.actualTeamTime && (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="w-10 text-right shrink-0 text-emerald-400">最適</span>
                <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-600/70 rounded flex items-center px-1.5 transition-all"
                    style={{ width: barPct(opt.optimalTime) }}
                  >
                    <span className="font-mono text-white whitespace-nowrap text-[9px]">{formatTime(opt.optimalTime)}</span>
                  </div>
                </div>
                <span className="w-8 text-emerald-400 shrink-0">{opt.optimalRank}位</span>
              </div>
            )}

            {/* 1st place */}
            <div className="flex items-center gap-2 text-[10px]">
              <span className="w-10 text-right shrink-0 text-amber-400">🥇1位</span>
              <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                <div
                  className="h-full bg-amber-500/70 rounded flex items-center px-1.5 transition-all"
                  style={{ width: barPct(first) }}
                >
                  <span className="font-mono text-white whitespace-nowrap text-[9px]">{formatTime(first)}</span>
                </div>
              </div>
              <span className="w-8 text-amber-400 shrink-0">1位</span>
            </div>

            {/* Gap label */}
            <div className="pl-12 text-[10px] mt-0.5">
              {alreadyFirst ? (
                <span className="text-emerald-400 font-semibold">最適化メンバーで1位達成可能！</span>
              ) : gap > 0 ? (
                <span className="text-amber-400/80">
                  最適化後でも1位まで{' '}
                  <span className="font-bold text-amber-300">{gap.toFixed(2)}秒</span>
                  差　／　1人あたり{' '}
                  <span className="font-bold text-amber-300">{(gap / relayCount).toFixed(2)}秒</span>
                  {' '}縮めれば達成
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold">最適化後1位タイム以下！</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── D: Historical trend section ─────────────────────────────────────────────

function HistorySection({ history, currentEventId }: { history: HistoryRelay[]; currentEventId: number }) {
  // Group by category name
  const grouped = useMemo(() => {
    const map = new Map<string, HistoryRelay[]>()
    for (const r of history) {
      const key = (r.mst_category as { name: string }).name
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    // Sort each group by round ascending
    for (const [, arr] of map) {
      arr.sort((a, b) => (a.mst_event as { round: number }).round - (b.mst_event as { round: number }).round)
    }
    return map
  }, [history])

  if (grouped.size === 0) return null

  return (
    <div className="rounded-xl border border-sky-800/30 bg-sky-950/10 p-4 space-y-5">
      <div className="flex items-center gap-2">
        <span className="w-1 h-4 rounded bg-sky-400 shrink-0" />
        <h3 className="text-sm font-bold text-white">大会ごとのタイム推移</h3>
      </div>

      {[...grouped.entries()].map(([catName, entries]) => {
        if (entries.length < 2) return null
        const times = entries.map((e) => e.time_seconds)
        const minT = Math.min(...times)
        const maxT = Math.max(...times)
        const range = maxT - minT || 1
        const improvement = maxT - minT

        return (
          <div key={catName} className="space-y-2">
            <div className="text-[11px] font-bold text-slate-200">
              {formatEventDisplay(catName)}
            </div>
            {/* Sparkline */}
            <div className="relative h-10">
              <svg
                className="w-full h-full"
                viewBox={`0 0 ${entries.length * 48} 40`}
                preserveAspectRatio="none"
              >
                {/* Line connecting dots */}
                <polyline
                  points={entries.map((e, idx) => {
                    const x = idx * 48 + 24
                    const y = 4 + ((e.time_seconds - minT) / range) * 28
                    return `${x},${y}`
                  }).join(' ')}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeOpacity="0.5"
                />
                {/* Dots */}
                {entries.map((e, idx) => {
                  const x = idx * 48 + 24
                  const y = 4 + ((e.time_seconds - minT) / range) * 28
                  const isCurrent = (e.mst_event as { id: number }).id === currentEventId
                  const rank = e.rank
                  const dotColor = rank === 1 ? '#f59e0b' : rank != null && rank <= 3 ? '#34d399' : '#38bdf8'
                  return (
                    <circle
                      key={idx}
                      cx={x}
                      cy={y}
                      r={isCurrent ? 5 : 3.5}
                      fill={dotColor}
                      fillOpacity={isCurrent ? 1 : 0.75}
                      stroke={isCurrent ? '#fff' : 'none'}
                      strokeWidth="1.5"
                    />
                  )
                })}
              </svg>
            </div>
            {/* Labels */}
            <div className="flex items-end gap-0" style={{ justifyContent: 'space-around' }}>
              {entries.map((e, idx) => {
                const round = (e.mst_event as { round: number }).round
                const isCurrent = (e.mst_event as { id: number }).id === currentEventId
                return (
                  <div key={idx} className="flex flex-col items-center gap-0.5 min-w-0" style={{ width: `${100 / entries.length}%` }}>
                    <span className={`font-mono text-[10px] leading-tight ${isCurrent ? 'text-sky-200 font-bold' : 'text-slate-300'}`}>
                      {formatTime(e.time_seconds)}
                    </span>
                    <span className={`text-[10px] leading-tight ${isCurrent ? 'text-sky-400 font-bold' : 'text-slate-400'}`}>
                      第{round}回
                    </span>
                    {e.rank != null && (
                      <span className={`text-[9px] leading-tight font-semibold ${e.rank === 1 ? 'text-amber-400' : e.rank <= 3 ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {e.rank}位
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Trend summary */}
            {improvement > 0.01 && (
              <div className="text-xs text-sky-300">
                最速比 <span className="font-bold">{improvement.toFixed(2)}秒</span> 短縮
                （{formatTime(maxT)} → {formatTime(minT)}）
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Per-relay card (B + C included) ─────────────────────────────────────────

function RelayCard({ opt }: { opt: OptimizedRelay }) {
  const [open, setOpen] = useState(false)
  const [showSwap, setShowSwap] = useState(false)
  const gain = opt.pointsGain
  const improved = gain > 0
  const same = opt.isCurrentOptimal
  const isMedley = opt.relayStroke.includes('メドレー')
  const totalCandidates = opt.candidatesPerOrder.reduce((s, c) => s + c.count, 0)

  // C: Swap simulator state — default = optimal members
  const [swapMap, setSwapMap] = useState<Record<number, string>>(() =>
    Object.fromEntries(opt.optimalMembers.map((m) => [m.swim_order, m.name]))
  )

  const swapTime = useMemo(() => {
    return opt.candidatesPerOrder.reduce((total, orderInfo) => {
      const selectedName = swapMap[orderInfo.order]
      const found = orderInfo.candidates.find((c) => c.name === selectedName)
      return total + (found?.seconds ?? 0)
    }, 0)
  }, [swapMap, opt.candidatesPerOrder])

  const swapRank = useMemo(() => {
    if (!opt.fieldTimes || opt.fieldTimes.length === 0) return null
    let r = opt.fieldTimes.length + 1
    for (let i = 0; i < opt.fieldTimes.length; i++) {
      if (swapTime <= opt.fieldTimes[i]) { r = i + 1; break }
    }
    return r
  }, [swapTime, opt.fieldTimes])

  const swapPoints = swapRank != null ? rankToPoints(swapRank) : 0

  return (
    <div className={`rounded-xl border overflow-hidden ${improved ? 'border-emerald-700/40' : 'border-slate-700/40'}`}>
      {/* Header */}
      <button
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${improved ? 'bg-emerald-950/40 hover:bg-emerald-950/60' : 'bg-slate-800/60 hover:bg-slate-700/60'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-white">{formatEventDisplay(opt.categoryName)}</span>
            <span className="text-[10px] text-slate-400">{opt.ageGroup}</span>
            {same && <span className="text-[10px] text-emerald-400 font-semibold">✓ 最適</span>}
            {opt.candidatesPerOrder.some((c) => c.candidates.length > 1) && (
              <span className="text-[9px] text-purple-300 bg-purple-900/50 border border-purple-700/50 px-1.5 py-0.5 rounded-full font-semibold">
                交代シミュ可
              </span>
            )}
            {totalCandidates === 0 && (
              <span className="text-[9px] text-slate-500 bg-slate-800/60 border border-slate-700/50 px-1.5 py-0.5 rounded-full">
                個人タイムなし
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            実績: {opt.actualRank != null ? `${opt.actualRank}位` : '－'}（{opt.actualPoints}pt）
            {improved && (
              <span className="ml-2 text-emerald-400 font-semibold">
                → 最適化で {opt.optimalRank}位（{opt.optimalPoints}pt）
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {improved && <span className="text-sm font-black text-emerald-300">+{gain}pt</span>}
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="bg-slate-900/40">
          {/* Actual vs optimal member grid */}
          <div className="px-4 py-3 grid gap-4 sm:grid-cols-2">
            {/* Actual members */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 mb-1">実際のメンバー</p>
              <p className="text-[9px] text-slate-600 mb-2">※タイムは25m通過スプリット</p>
              <div className="space-y-1">
                {opt.actualMembers.map((m) => (
                  <div key={m.swim_order} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 w-4 text-center text-slate-500 font-bold">{m.swim_order}</span>
                    {isMedley && (
                      <span className="shrink-0 text-[9px] text-sky-400 bg-sky-950/60 px-1 rounded font-semibold">
                        {STROKE_SHORT[m.stroke] ?? m.stroke}
                      </span>
                    )}
                    <span className="flex-1 text-slate-200 truncate">{m.name}</span>
                    <span className="font-mono text-slate-500 shrink-0 text-[10px]">
                      {m.splitSeconds ? formatTime(m.splitSeconds) : '－'}
                    </span>
                  </div>
                ))}
                <div className="border-t border-slate-700/40 pt-1 flex justify-between text-xs font-bold">
                  <span className="text-slate-300">合計タイム</span>
                  <span className="font-mono text-white">{formatTime(opt.actualTeamTime)}</span>
                </div>
              </div>
            </div>

            {/* Optimal members */}
            <div>
              <p className="text-[10px] font-bold text-emerald-400 mb-1">
                最適メンバー
                <span className="text-slate-500 font-normal ml-1">（個人タイム候補{totalCandidates}名）</span>
              </p>
              {totalCandidates === 0 && (
                <p className="text-[9px] text-slate-600 mb-2">同距離・同種目の個人タイムがある選手がいません</p>
              )}
              <div className="space-y-1">
                {opt.optimalMembers.map((m) => (
                  <div key={m.swim_order} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 w-4 text-center text-slate-500 font-bold">{m.swim_order}</span>
                    {isMedley && (
                      <span className="shrink-0 text-[9px] text-sky-400 bg-sky-950/60 px-1 rounded font-semibold">
                        {STROKE_SHORT[m.stroke] ?? m.stroke}
                      </span>
                    )}
                    <span className={`flex-1 truncate ${same ? 'text-slate-200' : 'text-emerald-200'}`}>{m.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-slate-400">{formatTime(m.splitSeconds)}</span>
                      {m.source === 'individual' && (
                        <span className="text-[9px] text-sky-500 bg-sky-950/50 px-1 rounded">個人</span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="border-t border-slate-700/40 pt-1 flex justify-between text-xs font-bold">
                  <span className={improved ? 'text-emerald-300' : 'text-slate-300'}>合計</span>
                  <span className={`font-mono ${improved ? 'text-emerald-300' : 'text-white'}`}>
                    {formatTime(opt.optimalTime)}
                    {improved && opt.optimalTime < opt.actualTeamTime && (
                      <span className="text-[10px] text-emerald-400 ml-1">
                        (-{formatTime(opt.actualTeamTime - opt.optimalTime)})
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {isMedley && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {opt.candidatesPerOrder.map((c) => (
                    <span key={c.order} className="text-[9px] text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">
                      {c.order}({STROKE_SHORT[c.stroke] ?? c.stroke}) {c.count}名
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* B: Improvement analysis */}
          {opt.firstPlaceTime != null && (
            <div className="mx-4 mb-3 rounded-lg border border-amber-800/30 bg-amber-950/20 px-4 py-3">
              <p className="text-[10px] font-bold text-amber-400 mb-2">1位を目指す目標タイム</p>
              {(() => {
                const first = opt.firstPlaceTime!
                const gap = opt.optimalTime - first
                const relayCount = opt.actualMembers.length || 4
                const perPerson = gap / relayCount
                const actualGap = opt.actualTeamTime - first
                return (
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">大会1位タイム</span>
                      <span className="font-mono text-amber-300 font-bold">{formatTime(first)}</span>
                    </div>
                    {opt.optimalTime < opt.actualTeamTime && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">最適化後の差</span>
                        <span className={`font-mono font-bold ${gap <= 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                          {gap <= 0 ? '達成！' : `あと ${gap.toFixed(2)}秒`}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-400">現状の差</span>
                      <span className="font-mono text-slate-300">{actualGap > 0 ? `あと ${actualGap.toFixed(2)}秒` : '達成済み'}</span>
                    </div>
                    {gap > 0 && (
                      <div className="mt-2 pt-2 border-t border-amber-800/20 flex items-start gap-1">
                        <span className="text-amber-400">↗</span>
                        <span className="text-amber-300/80 leading-relaxed">
                          最適編成なら{' '}<span className="font-bold text-amber-300">1人あたり {perPerson.toFixed(2)}秒</span>{' '}縮めれば1位達成
                        </span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* C: Swap simulator */}
          {opt.candidatesPerOrder.some((c) => c.candidates.length >= 1) && (
            <div className="mx-4 mb-3 rounded-lg border border-purple-800/30 bg-purple-950/20 px-4 py-3">
              <button
                className="w-full flex items-center justify-between text-[10px] font-bold text-purple-400"
                onClick={() => setShowSwap((v) => !v)}
              >
                <span>メンバー交代シミュレーター</span>
                <span>{showSwap ? '▲' : '▼'}</span>
              </button>
              {showSwap && (
                <div className="mt-3 space-y-2">
                  {opt.candidatesPerOrder.map((orderInfo) => {
                    const hasAlts = orderInfo.candidates.length > 1
                    const selectedCand = orderInfo.candidates.find((c) => c.name === swapMap[orderInfo.order])
                    return (
                      <div key={orderInfo.order} className="flex items-center gap-2 text-[10px]">
                        <span className="shrink-0 w-4 text-center text-slate-500 font-bold">{orderInfo.order}</span>
                        {isMedley && (
                          <span className="shrink-0 text-[9px] text-sky-400 bg-sky-950/60 px-1 rounded">
                            {STROKE_SHORT[orderInfo.stroke] ?? orderInfo.stroke}
                          </span>
                        )}
                        {hasAlts ? (
                          <select
                            className="flex-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[10px] px-1.5 py-0.5 cursor-pointer"
                            value={swapMap[orderInfo.order] ?? ''}
                            onChange={(e) => setSwapMap((prev) => ({ ...prev, [orderInfo.order]: e.target.value }))}
                          >
                            {orderInfo.candidates.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}  {formatTime(c.seconds)}  {c.source === 'individual' ? '（個人）' : '（リレー）'}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="flex-1 text-slate-500 truncate">
                            {orderInfo.candidates[0]?.name ?? '－'}
                            <span className="ml-1 text-slate-600">（候補1名のみ）</span>
                          </span>
                        )}
                        <span className="font-mono text-slate-400 shrink-0 w-12 text-right">
                          {formatTime(selectedCand?.seconds ?? orderInfo.candidates[0]?.seconds ?? 0)}
                        </span>
                      </div>
                    )
                  })}

                  {/* Swap result */}
                  <div className="mt-3 pt-2 border-t border-slate-700/40 space-y-1">
                    <div className="flex justify-between text-[10px] font-bold">
                      <span className="text-purple-300">シミュレーション合計</span>
                      <span className={`font-mono ${swapTime < opt.optimalTime ? 'text-emerald-300' : swapTime > opt.actualTeamTime ? 'text-rose-400' : 'text-purple-300'}`}>
                        {formatTime(swapTime)}
                      </span>
                    </div>
                    {swapRank != null && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-500">推定順位</span>
                        <span className={`font-bold ${swapRank === 1 ? 'text-amber-400' : swapRank <= 3 ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {swapRank}位（{rankToPoints(swapRank)}pt）
                        </span>
                      </div>
                    )}
                    {opt.firstPlaceTime != null && swapTime > opt.firstPlaceTime && (
                      <div className="text-[10px] text-slate-500">
                        1位まで あと{' '}
                        <span className="font-bold text-amber-400">{(swapTime - opt.firstPlaceTime).toFixed(2)}秒</span>
                      </div>
                    )}
                    {opt.firstPlaceTime != null && swapTime <= opt.firstPlaceTime && (
                      <div className="text-[10px] text-emerald-400 font-bold">このメンバー構成で1位タイム達成！</div>
                    )}
                    <button
                      className="text-[9px] text-slate-600 hover:text-slate-400 mt-1"
                      onClick={() => setSwapMap(Object.fromEntries(opt.optimalMembers.map((m) => [m.swim_order, m.name])))}
                    >
                      最適メンバーにリセット
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function RelayOptimizer({ eventId, teamId, teamName, meetRound }: Props) {
  const [data, setData] = useState<RelayOptimizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRelay[]>([])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/relay-optimize?eventId=${eventId}&teamId=${teamId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setData(null) }
        else setData(d)
      })
      .catch(() => setError('データの取得に失敗しました'))
      .finally(() => setLoading(false))
  }, [eventId, teamId])

  useEffect(() => {
    fetch(`/api/relay-history?teamId=${teamId}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setHistory(d.relays ?? []) })
      .catch(() => {})
  }, [teamId])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
        <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        リレー最適化を計算中…
      </div>
    )
  }
  if (error) {
    return <p className="text-center py-12 text-rose-400 text-sm">{error}</p>
  }
  if (!data) return null

  const { optimizations, totalActualPoints, totalOptimalPoints, totalGain, teamRankings } = data

  const currentRankRow = teamRankings.find((r) => {
    const n = (r.mst_team as { name: string }).name
    return teamName.includes(n) || n.includes(teamName.split(/[　\s]/)[0])
  })
  const currentTotalPts = Number(currentRankRow?.total_points ?? 0)
  const hypotheticalPts = currentTotalPts + totalGain
  let hypotheticalRank = 1
  for (const r of teamRankings) {
    if (Number(r.total_points) > hypotheticalPts) hypotheticalRank++
  }

  const hasGains = optimizations.some((o) => o.pointsGain > 0)

  return (
    <div className="space-y-6 pb-8">
      {/* Summary banner */}
      <div className={`rounded-xl border p-5 ${totalGain > 0 ? 'border-emerald-700/50 bg-emerald-950/30' : 'border-slate-700 bg-slate-800/40'}`}>
        <h3 className="text-sm font-bold text-white mb-3">
          {teamName} 第{meetRound}回 リレー最適化シミュレーション
        </h3>
        {totalGain > 0 ? (
          <>
            <p className="text-2xl font-black text-emerald-300 mb-1">
              +{totalGain}pt 追加獲得可能！
            </p>
            <p className="text-sm text-slate-300 mb-2">
              実際の得点: <span className="font-bold text-white">{totalActualPoints}pt</span>
              　→　最適化後: <span className="font-bold text-emerald-300">{totalOptimalPoints}pt</span>
            </p>
            {currentRankRow && (
              <p className="text-sm text-slate-300">
                現在の総合順位: <span className="font-bold text-white">{currentRankRow.rank}位</span>
                　→　最適化後の推定順位: <span className="font-bold text-emerald-300">{hypotheticalRank}位</span>
                <span className="text-xs text-slate-500 ml-2">（リレー得点のみ変更の場合）</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-emerald-300 font-bold">
            すべてのリレーで既に最適なメンバー構成です！
          </p>
        )}
      </div>

      {!hasGains && (
        <p className="text-xs text-slate-500 text-center">
          ※ 個人競技のタイムデータが不足している競技は計算できません
        </p>
      )}

      {/* A: Gap chart */}
      <GapChartSection optimizations={optimizations} />

      {/* B+C: Per-relay breakdown */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">競技別詳細分析</h3>
        </div>
        {optimizations.map((opt, i) => (
          <RelayCard key={i} opt={opt} />
        ))}
      </div>

      {/* D: Historical trend */}
      <HistorySection history={history} currentEventId={eventId} />

      {/* Context note */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-3">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※ メドレーリレーは泳順（背泳ぎ→平泳ぎ→バタフライ→フリー）を考慮した上で最適な組み合わせを計算します。
          個人競技のタイムをスプリットタイムとして使用しています。実際のリレー飛込タイムは考慮していません。
          あくまでも参考値としてご活用ください。
        </p>
      </div>
    </div>
  )
}
