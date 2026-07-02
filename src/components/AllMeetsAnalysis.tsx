'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import type { TeamStanding } from '@/types'

interface Props {
  standings: TeamStanding[]
  onRoundSelect: (eventId: number) => void
  focusTeamName: string
  onTeamSelect?: (teamName: string) => void
}

// Same logic as SearchApp.tsx
function teamDisplayName(name: string): string {
  const trimmed = name.trim()
  const withoutCentral = trimmed.startsWith('セ・')
    ? trimmed.slice(2)
    : trimmed.endsWith('・セ')
      ? trimmed.slice(0, -2)
      : trimmed
  return withoutCentral.replace(/^ザパス/, 'ザバス')
}

function formatPoints(pts: number): string {
  return Number.isInteger(pts) ? String(pts) : pts.toFixed(1)
}

function isFocusTeam(name: string, focusTeamName: string): boolean {
  const focusBase = focusTeamName.split(/[　\s]/)[0]
  return focusTeamName.includes(name) || name.includes(focusBase)
}

const RANK_ICONS = ['①', '②', '③']

// ── SVG multi-team rank chart ──────────────────────────────────
function MultiTeamRankChart({
  teamData,
  rounds,
  focusTeamName,
  onRoundSelect,
  allRoundEvents,
}: {
  teamData: { name: string; displayName: string; color: string; rankByRound: Map<number, number> }[]
  rounds: number[]
  focusTeamName: string
  onRoundSelect: (eventId: number) => void
  allRoundEvents: Map<number, number>
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgW, setSvgW] = useState(720)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const obs = new ResizeObserver((e) => setSvgW(e[0].contentRect.width || 720))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const px = (n: number) => {
    const boosted = svgW > 500 ? n * 1.4 : n
    return Math.round((boosted / svgW) * 720)
  }

  const W = 720, H = 240, padX = 48, padTop = 24, padBot = 52
  const maxRank = Math.max(...teamData.flatMap((t) => [...t.rankByRound.values()]), 5)
  const xFor = (idx: number) =>
    rounds.length <= 1 ? W / 2 : padX + (idx / (rounds.length - 1)) * (W - padX * 2)
  const yFor = (rank: number) =>
    padTop + ((rank - 1) / Math.max(maxRank - 1, 1)) * (H - padTop - padBot)

  const gridRanks = [1, Math.ceil(maxRank / 2), maxRank].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-60">
      {gridRanks.map((r) => {
        const y = yFor(r)
        return (
          <g key={r}>
            <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />
            <text x={padX - 6} y={y + 4} textAnchor="end" fill="#64748b" fontSize={px(11)}>{r}位</text>
          </g>
        )
      })}
      {teamData.map((team) => {
        const pts = rounds
          .map((r, i) => ({ r, i, rank: team.rankByRound.get(r) }))
          .filter((p): p is { r: number; i: number; rank: number } => p.rank != null)
        if (pts.length < 2) return null
        const d = pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${xFor(p.i)},${yFor(p.rank)}`).join(' ')
        const focus = isFocusTeam(team.name, focusTeamName)
        return (
          <path
            key={team.name}
            d={d}
            fill="none"
            stroke={team.color}
            strokeWidth={focus ? px(3) : px(1.5)}
            strokeOpacity={focus ? 1 : 0.6}
          />
        )
      })}
      {teamData.map((team) =>
        rounds.map((r, i) => {
          const rank = team.rankByRound.get(r)
          if (rank == null) return null
          const x = xFor(i), y = yFor(rank)
          const focus = isFocusTeam(team.name, focusTeamName)
          return (
            <g key={`${team.name}-${r}`}>
              <circle cx={x} cy={y} r={focus ? px(5) : px(3)} fill={team.color} strokeWidth={0} />
              {(focus || rank === 1) && (
                <text x={x} y={y - px(7)} textAnchor="middle" fill={team.color} fontSize={px(11)} fontWeight="700">
                  {rank}位
                </text>
              )}
            </g>
          )
        })
      )}
      {/* Round labels — clickable */}
      {rounds.map((r, i) => {
        const eid = allRoundEvents.get(r)
        return (
          <g
            key={r}
            onClick={eid ? () => onRoundSelect(eid) : undefined}
            style={{ cursor: eid ? 'pointer' : 'default' }}
          >
            <rect x={xFor(i) - 22} y={H - padBot + 6} width={44} height={18} fill="transparent" />
            <text
              x={xFor(i)}
              y={H - padBot + 18}
              textAnchor="middle"
              fill={eid ? '#93c5fd' : '#64748b'}
              fontSize={px(11)}
              fontWeight={eid ? '600' : '400'}
              textDecoration={eid ? 'underline' : 'none'}
            >
              第{r}回
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function AllMeetsAnalysis({ standings, onRoundSelect, focusTeamName, onTeamSelect }: Props) {
  const [activeView, setActiveView] = useState<'table' | 'analysis'>('table')

  const { teamMap, rounds, allRoundEvents } = useMemo(() => {
    const map = new Map<string, { displayName: string; rankByRound: Map<number, number>; pointsByRound: Map<number, number> }>()
    const roundSet = new Set<number>()
    const eventByRound = new Map<number, number>()

    for (const s of standings) {
      const name = s.mst_team.name
      if (!map.has(name)) map.set(name, { displayName: teamDisplayName(name), rankByRound: new Map(), pointsByRound: new Map() })
      const round = s.mst_event?.round ?? 0
      if (round > 0) {
        roundSet.add(round)
        eventByRound.set(round, (s.mst_event as { id: number }).id)
        map.get(name)!.rankByRound.set(round, s.rank ?? 999)
        map.get(name)!.pointsByRound.set(round, Number(s.total_points ?? 0))
      }
    }
    const sortedRounds = [...roundSet].sort((a, b) => a - b)
    return { teamMap: map, rounds: sortedRounds, allRoundEvents: eventByRound }
  }, [standings])

  // Columns in table: newest → oldest
  const reversedRounds = [...rounds].reverse()

  const teamStats = useMemo(() => {
    const stats = [...teamMap.entries()].map(([name, data]) => {
      const ranks = [...data.rankByRound.values()].filter((r) => r < 999)
      const firstRound = rounds[0]
      const lastRound = rounds[rounds.length - 1]
      const firstRank = data.rankByRound.get(firstRound) ?? null
      const lastRank = data.rankByRound.get(lastRound) ?? null
      const avgRank = ranks.length > 0 ? ranks.reduce((s, r) => s + r, 0) / ranks.length : 999
      const bestRank = ranks.length > 0 ? Math.min(...ranks) : 999
      const totalPoints = [...data.pointsByRound.values()].reduce((s, p) => s + p, 0)
      const latestPoints = data.pointsByRound.get(lastRound) ?? 0
      const rankImprovement = firstRank != null && lastRank != null ? firstRank - lastRank : null
      const participated = ranks.length
      return { name, ...data, avgRank, bestRank, totalPoints, latestPoints, firstRank, lastRank, rankImprovement, participated }
    })
    return stats.sort((a, b) => a.avgRank - b.avgRank)
  }, [teamMap, rounds])

  const latestRound = rounds[rounds.length - 1]
  const focusTeam = teamStats.find((t) => isFocusTeam(t.name, focusTeamName))
  const focusDisplay = focusTeam?.displayName ?? focusTeamName

  const top1 = teamStats[0]
  const mostImproved = [...teamStats].sort((a, b) => (b.rankImprovement ?? -999) - (a.rankImprovement ?? -999))[0]
  const mostConsistent = [...teamStats].sort((a, b) => {
    const stdA = calcStd([...a.rankByRound.values()].filter((r) => r < 999))
    const stdB = calcStd([...b.rankByRound.values()].filter((r) => r < 999))
    return stdA - stdB
  })[0]

  const focusLatestRank = focusTeam?.rankByRound.get(latestRound) ?? null
  const focusLatestPts = focusTeam?.pointsByRound.get(latestRound) ?? 0
  const top1LatestPts = teamStats.find((t) => t.name === top1?.name)?.pointsByRound.get(latestRound) ?? 0
  const ptsGapTo1st = top1LatestPts - focusLatestPts

  const CHART_COLORS = ['#f97316', '#a855f7', '#22c55e', '#ec4899', '#eab308', '#14b8a6', '#60a5fa', '#fb923c', '#34d399', '#c084fc']
  const top10 = teamStats.slice(0, 10)
  if (focusTeam && !top10.find((t) => t.name === focusTeam.name)) top10.push(focusTeam)
  const chartTeams = top10.map((t, i) => {
    const focus = isFocusTeam(t.name, focusTeamName)
    return { ...t, color: focus ? '#fbbf24' : CHART_COLORS[i % CHART_COLORS.length] }
  })

  return (
    <div className="max-w-5xl mx-auto pb-8">
      {/* ── Glowing sticky title banner ── */}
      <div className="sticky top-0 z-10 mb-6">
        <div className="relative rounded-xl overflow-hidden border border-amber-500/50 shadow-xl shadow-amber-500/15">
          {/* animated shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-amber-950/60 to-slate-900" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(251,191,36,0.12),transparent_70%)] animate-pulse" />
          <div className="relative px-5 py-4 flex items-center gap-3">
            <span className="text-2xl leading-none">🏊</span>
            <h2 className="text-base font-black tracking-wide bg-gradient-to-r from-amber-200 via-white to-amber-200 bg-clip-text text-transparent">
              {focusDisplay}　全大会分析
            </h2>
          </div>
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1 mb-6">
        {(['table', 'analysis'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${
              activeView === v
                ? 'bg-sky-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {v === 'table' ? '全チーム順位推移表' : 'チーム分析'}
          </button>
        ))}
      </div>

      {/* ── Table view ── */}
      {activeView === 'table' && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-sky-950/80 to-indigo-950/80">
            <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
            <h3 className="text-sm font-bold text-sky-100">全チーム順位推移表</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: `${240 + rounds.length * 64}px` }}>
              <thead>
                <tr className="bg-slate-900/50 border-b border-slate-700">
                  <th className="px-2 py-2 text-center text-slate-500 font-medium sticky left-0 bg-slate-900/80 w-8">#</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-medium sticky left-8 bg-slate-900/80">チーム</th>
                  <th className="px-2 py-2 text-center text-slate-400 font-medium">avg</th>
                  {reversedRounds.map((r) => (
                    <th key={r} className="px-2 py-2 text-center text-slate-400 font-medium whitespace-nowrap">
                      第{r}回
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamStats.map((t, rowIdx) => {
                  const focus = isFocusTeam(t.name, focusTeamName)
                  const rankIcon = rowIdx < 3 ? RANK_ICONS[rowIdx] : null
                  return (
                    <tr
                      key={t.name}
                      className={`border-t border-slate-700/40 ${focus ? 'bg-amber-950/30' : rowIdx % 2 === 0 ? 'bg-slate-800/40' : ''}`}
                    >
                      <td className={`px-2 py-2 text-center font-bold sticky left-0 ${focus ? 'bg-amber-950/60 text-amber-400' : 'bg-slate-900/70 text-slate-600'}`}>
                        {rankIcon ? (
                          <span className={`text-sm ${rowIdx === 0 ? 'text-amber-400' : rowIdx === 1 ? 'text-slate-300' : 'text-amber-700'}`}>
                            {rankIcon}
                          </span>
                        ) : (
                          <span className="text-slate-600">{rowIdx + 1}</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 font-medium sticky left-8 ${focus ? 'text-amber-300 bg-amber-950/60 ring-1 ring-inset ring-amber-600/40' : 'text-slate-200 bg-slate-900/70'} whitespace-nowrap`}>
                        {onTeamSelect ? (
                          <button
                            className="hover:text-sky-300 hover:underline transition-colors text-left"
                            onClick={() => onTeamSelect(t.name)}
                          >
                            {t.displayName}
                          </button>
                        ) : (
                          t.displayName
                        )}
                        {focus && <span className="ml-1.5 text-[9px] text-amber-500">◀</span>}
                      </td>
                      <td className={`px-2 py-2 text-center font-mono font-bold ${focus ? 'text-amber-300' : 'text-slate-300'}`}>
                        {t.avgRank.toFixed(1)}
                      </td>
                      {reversedRounds.map((r) => {
                        const rank = t.rankByRound.get(r)
                        const pts = t.pointsByRound.get(r)
                        return (
                          <td key={r} className="px-2 py-2 text-center">
                            {rank != null && rank < 999 ? (
                              <button
                                className={`text-xs font-bold ${rank <= 3 ? 'text-amber-400' : focus ? 'text-amber-200' : 'text-slate-300'} hover:underline`}
                                onClick={() => {
                                  const eid = allRoundEvents.get(r)
                                  if (eid) onRoundSelect(eid)
                                }}
                                title={pts ? `${formatPoints(pts)}pt` : undefined}
                              >
                                {rank}位
                              </button>
                            ) : (
                              <span className="text-slate-700">－</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Analysis view ── */}
      {activeView === 'analysis' && (
        <div className="space-y-8">
          {/* Insights */}
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
              チーム分析レポート
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <InsightCard
                emoji="👑"
                title="最強チームは？"
                color="amber"
                body={
                  top1
                    ? `${top1.displayName}が全大会を通じて平均${top1.avgRank.toFixed(1)}位でトップ。` +
                      (focusTeam && top1.name === focusTeam.name
                        ? `${focusDisplay}がその筆頭です！`
                        : `${focusDisplay}の平均順位は${focusTeam?.avgRank.toFixed(1) ?? '?'}位。`)
                    : 'データなし'
                }
              />
              <InsightCard
                emoji="📈"
                title={`${focusDisplay}の推移`}
                color={focusTeam && (focusTeam.rankImprovement ?? 0) > 0 ? 'emerald' : 'slate'}
                body={
                  focusTeam
                    ? focusTeam.rankImprovement != null && focusTeam.rankImprovement > 0
                      ? `第${rounds[0]}回の${focusTeam.firstRank}位から第${latestRound}回の${focusTeam.lastRank}位まで${focusTeam.rankImprovement}ランク上昇！着実に成長しています。`
                      : focusTeam.rankImprovement != null && focusTeam.rankImprovement < 0
                        ? `第${rounds[0]}回から${Math.abs(focusTeam.rankImprovement)}ランクダウン。巻き返しが期待されます。`
                        : `第${rounds[0]}回から同順位を維持。安定した実力の証です。`
                    : 'データなし'
                }
              />
              <InsightCard
                emoji="🏆"
                title="1位との差は？"
                color="sky"
                body={
                  focusLatestRank != null
                    ? focusLatestRank === 1
                      ? `第${latestRound}回は堂々の1位！次回大会も首位キープを目指しましょう。`
                      : `第${latestRound}回は${focusLatestRank}位。1位の${top1?.displayName ?? '?'}とは約${formatPoints(ptsGapTo1st)}ptの差。`
                    : '最新大会のデータなし'
                }
              />
              <InsightCard
                emoji="🚀"
                title="最も躍進したチーム"
                color="purple"
                body={
                  mostImproved && (mostImproved.rankImprovement ?? 0) > 0
                    ? `${mostImproved.displayName}が第${rounds[0]}回${mostImproved.firstRank}位→第${latestRound}回${mostImproved.lastRank}位と${mostImproved.rankImprovement}ランクアップ。注目のライバルチームです。`
                    : `大きな順位変動はなく、上位は安定した顔ぶれです。`
                }
              />
              <InsightCard
                emoji="🛡️"
                title="最も安定したチーム"
                color="indigo"
                body={
                  mostConsistent
                    ? `${mostConsistent.displayName}が毎大会ほぼ同順位で安定した強さを誇ります。一貫した底上げ戦略が他チームには必要です。`
                    : 'データなし'
                }
              />
              <InsightCard
                emoji="💡"
                title={`${focusDisplay}が伸びるには`}
                color="rose"
                body={`上位チームとの差は主に参加人数と競技カバー率にあります。リレー競技でのメンバー組み合わせ最適化が次回大会の得点アップの近道。「リレー最適化」タブで試してみましょう！`}
              />
            </div>
          </div>

          {/* Multi-team rank chart */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
              <h3 className="text-sm font-bold text-white">チーム別 大会順位推移（上位{chartTeams.length}チーム）</h3>
            </div>
            <p className="text-[10px] text-slate-500 mb-3">{focusDisplay}は黄色。第〇回をクリックすると大会データへ移動。</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
              {chartTeams.map((t) => (
                <span key={t.name} className="text-[10px] flex items-center gap-1">
                  <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                  <span style={{ color: t.color }}>{t.displayName}</span>
                </span>
              ))}
            </div>
            <MultiTeamRankChart
              teamData={chartTeams}
              rounds={rounds}
              focusTeamName={focusTeamName}
              onRoundSelect={onRoundSelect}
              allRoundEvents={allRoundEvents}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────
function calcStd(values: number[]): number {
  if (values.length === 0) return 0
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length)
}

function InsightCard({ emoji, title, color, body }: { emoji: string; title: string; color: string; body: string }) {
  const colorMap: Record<string, string> = {
    amber: 'border-amber-700/40 bg-amber-950/20',
    emerald: 'border-emerald-700/40 bg-emerald-950/20',
    sky: 'border-sky-700/40 bg-sky-950/20',
    purple: 'border-purple-700/40 bg-purple-950/20',
    indigo: 'border-indigo-700/40 bg-indigo-950/20',
    rose: 'border-rose-700/40 bg-rose-950/20',
    slate: 'border-slate-700/40 bg-slate-800/40',
  }
  const titleMap: Record<string, string> = {
    amber: 'text-amber-300', emerald: 'text-emerald-300', sky: 'text-sky-300',
    purple: 'text-purple-300', indigo: 'text-indigo-300', rose: 'text-rose-300', slate: 'text-slate-300',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] ?? colorMap.slate}`}>
      <div className={`text-xs font-bold mb-1.5 ${titleMap[color] ?? titleMap.slate}`}>
        {emoji} {title}
      </div>
      <p className="text-xs text-slate-300 leading-relaxed">{body}</p>
    </div>
  )
}
