'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import type { TeamStanding } from '@/types'

interface Props {
  standings: TeamStanding[]
  onRoundSelect: (eventId: number) => void
  focusTeamName: string
}

function teamDisplayName(name: string): string {
  return name.replace(/^(株式会社|有限会社|一般社団法人|公益財団法人)\s*/, '')
}

function formatPoints(pts: number): string {
  return Number.isInteger(pts) ? String(pts) : pts.toFixed(1)
}

// ── SVG multi-team rank chart ──────────────────────────────────
function MultiTeamRankChart({
  teamData,
  rounds,
  focusTeamName,
  onRoundSelect,
}: {
  teamData: { name: string; displayName: string; color: string; rankByRound: Map<number, number> }[]
  rounds: number[]
  focusTeamName: string
  onRoundSelect: (eventId: number) => void
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
  const px = (n: number) => Math.round((n / svgW) * 720)

  const W = 720, H = 240, padX = 44, padTop = 24, padBot = 48
  const maxRank = Math.max(...teamData.flatMap((t) => [...t.rankByRound.values()]), 5)
  const xFor = (idx: number) =>
    rounds.length <= 1 ? W / 2 : padX + (idx / (rounds.length - 1)) * (W - padX * 2)
  const yFor = (rank: number) =>
    padTop + ((rank - 1) / Math.max(maxRank - 1, 1)) * (H - padTop - padBot)

  // grid lines
  const gridRanks = [1, Math.ceil(maxRank / 2), maxRank].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-60">
      {gridRanks.map((r) => {
        const y = yFor(r)
        return (
          <g key={r}>
            <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />
            <text x={padX - 6} y={y + 3} textAnchor="end" fill="#64748b" fontSize={px(10)}>{r}位</text>
          </g>
        )
      })}
      {/* lines */}
      {teamData.map((team) => {
        const pts = rounds
          .map((r, i) => ({ r, i, rank: team.rankByRound.get(r) }))
          .filter((p): p is { r: number; i: number; rank: number } => p.rank != null)
        if (pts.length < 2) return null
        const d = pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${xFor(p.i)},${yFor(p.rank)}`).join(' ')
        const isFocus = focusTeamName.includes(team.name) || team.name.includes(focusTeamName.split(/[　\s]/)[0])
        return (
          <path
            key={team.name}
            d={d}
            fill="none"
            stroke={team.color}
            strokeWidth={isFocus ? px(3) : px(1.5)}
            strokeOpacity={isFocus ? 1 : 0.6}
          />
        )
      })}
      {/* dots + labels */}
      {teamData.map((team) =>
        rounds.map((r, i) => {
          const rank = team.rankByRound.get(r)
          if (rank == null) return null
          const x = xFor(i), y = yFor(rank)
          const isFocus = focusTeamName.includes(team.name) || team.name.includes(focusTeamName.split(/[　\s]/)[0])
          const isFirst = rank === 1
          return (
            <g key={`${team.name}-${r}`}>
              <circle cx={x} cy={y} r={isFocus ? px(5) : px(3)} fill={team.color} strokeWidth={0} />
              {(isFocus || isFirst) && (
                <text x={x} y={y - px(7)} textAnchor="middle" fill={team.color} fontSize={px(10)} fontWeight="700">
                  {rank}位
                </text>
              )}
            </g>
          )
        })
      )}
      {/* x-axis labels */}
      {rounds.map((r, i) => (
        <text key={r} x={xFor(i)} y={H - px(4)} textAnchor="middle" fill="#64748b" fontSize={px(10)}>
          第{r}回
        </text>
      ))}
    </svg>
  )
}

// ── Bar chart for latest round points ─────────────────────────
function PointsBarChart({
  teams,
  focusTeamName,
}: {
  teams: { name: string; displayName: string; points: number }[]
  focusTeamName: string
}) {
  const maxPts = Math.max(...teams.map((t) => t.points), 1)
  const FOCUS_COLOR = '#fbbf24'
  const OTHER_COLOR = '#3b82f6'
  return (
    <div className="space-y-1.5">
      {teams.map((t, i) => {
        const isFocus = focusTeamName.includes(t.name) || t.name.includes(focusTeamName.split(/[　\s]/)[0])
        const pct = (t.points / maxPts) * 100
        return (
          <div key={t.name} className="flex items-center gap-2 text-xs">
            <span className={`w-5 shrink-0 text-right font-semibold ${isFocus ? 'text-amber-300' : 'text-slate-400'}`}>
              {i + 1}
            </span>
            <span className={`w-28 shrink-0 truncate ${isFocus ? 'text-amber-200 font-bold' : 'text-slate-300'}`}>
              {t.displayName}
            </span>
            <div className="flex-1 bg-slate-700 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: isFocus ? FOCUS_COLOR : OTHER_COLOR }}
              />
            </div>
            <span className={`w-16 shrink-0 text-right font-mono ${isFocus ? 'text-amber-300 font-bold' : 'text-slate-400'}`}>
              {formatPoints(t.points)}pt
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function AllMeetsAnalysis({ standings, onRoundSelect, focusTeamName }: Props) {
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
    return stats.filter((t) => t.participated >= 3).sort((a, b) => a.avgRank - b.avgRank)
  }, [teamMap, rounds])

  const latestRound = rounds[rounds.length - 1]
  const latestStandings = teamStats
    .filter((t) => t.pointsByRound.has(latestRound))
    .sort((a, b) => b.latestPoints - a.latestPoints)
    .slice(0, 20)

  const focusTeam = teamStats.find((t) => focusTeamName.includes(t.name) || t.name.includes(focusTeamName.split(/[　\s]/)[0]))
  const top1 = teamStats[0]
  const mostImproved = [...teamStats].sort((a, b) => (b.rankImprovement ?? -999) - (a.rankImprovement ?? -999))[0]
  const mostConsistent = [...teamStats].sort((a, b) => {
    const stdA = calcStd([...a.rankByRound.values()].filter((r) => r < 999))
    const stdB = calcStd([...b.rankByRound.values()].filter((r) => r < 999))
    return stdA - stdB
  })[0]

  // Focus team vs 1st place gap
  const focusLatestRank = focusTeam?.rankByRound.get(latestRound) ?? null
  const focusLatestPts = focusTeam?.pointsByRound.get(latestRound) ?? 0
  const top1LatestPts = latestStandings[0]?.latestPoints ?? 0
  const ptsGapTo1st = top1LatestPts - focusLatestPts

  // Top 10 teams for chart (always include focus team)
  const CHART_COLORS = ['#f97316', '#a855f7', '#22c55e', '#ec4899', '#eab308', '#14b8a6', '#60a5fa', '#fb923c', '#34d399', '#c084fc']
  const top10 = teamStats.slice(0, 10)
  if (focusTeam && !top10.find((t) => t.name === focusTeam.name)) top10.push(focusTeam)
  const chartTeams = top10.map((t, i) => {
    const isFocus = focusTeamName.includes(t.name) || t.name.includes(focusTeamName.split(/[　\s]/)[0])
    return { ...t, color: isFocus ? '#fbbf24' : CHART_COLORS[i % CHART_COLORS.length] }
  })

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-8">
      {/* ── Header ── */}
      <div className="rounded-xl border border-sky-800/50 bg-gradient-to-r from-sky-950/60 to-indigo-950/60 p-5">
        <h2 className="text-base font-bold text-white mb-1">全大会チーム分析</h2>
        <p className="text-xs text-slate-400">第{rounds[0]}回〜第{latestRound}回（全{rounds.length}大会）の全チーム順位・得点を分析します</p>
        <p className="text-[10px] text-slate-600 mt-0.5">※ 3大会以上参加チームのみ集計対象</p>
      </div>

      {/* ── Insights ── */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          おおたか目線の分析レポート
        </h3>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* 最強チーム */}
          <InsightCard
            emoji="👑"
            title="最強チームは？"
            color="amber"
            body={`${top1?.displayName ?? '不明'}が全大会を通じて平均順位${top1 ? top1.avgRank.toFixed(1) : '?'}位でトップ。${focusTeam && top1?.name === focusTeam.name ? 'それはおおたかです！' : `おおたかの平均順位は${focusTeam?.avgRank.toFixed(1) ?? '?'}位。`}`}
          />

          {/* おおたかの伸び */}
          <InsightCard
            emoji="📈"
            title="おおたかの成長"
            color={focusTeam && (focusTeam.rankImprovement ?? 0) > 0 ? 'emerald' : 'slate'}
            body={
              focusTeam
                ? focusTeam.rankImprovement != null && focusTeam.rankImprovement > 0
                  ? `第${rounds[0]}回の${focusTeam.firstRank}位から第${latestRound}回の${focusTeam.lastRank}位まで${focusTeam.rankImprovement}ランク上昇！着実に成長中です。`
                  : focusTeam.rankImprovement != null && focusTeam.rankImprovement < 0
                    ? `第${rounds[0]}回から${Math.abs(focusTeam.rankImprovement)}ランクダウン。今後の巻き返しに期待！`
                    : `第${rounds[0]}回から同順位を維持。安定した実力の証です。`
                : 'データなし'
            }
          />

          {/* 1位への道 */}
          <InsightCard
            emoji="🏆"
            title="1位になるには？"
            color="sky"
            body={
              focusLatestRank != null
                ? focusLatestRank === 1
                  ? `第${latestRound}回は堂々の1位！次回も首位死守を目指しましょう！`
                  : `第${latestRound}回は${focusLatestRank}位。1位の${latestStandings[0]?.displayName ?? '?'}とは約${formatPoints(ptsGapTo1st)}ptの差。リレーや上位種目の強化が鍵です。`
                : '最新大会のデータなし'
            }
          />

          {/* 最も上昇したチーム */}
          <InsightCard
            emoji="🚀"
            title="最も躍進したチーム"
            color="purple"
            body={
              mostImproved && (mostImproved.rankImprovement ?? 0) > 0
                ? `${mostImproved.displayName}が${mostImproved.firstRank}位→${mostImproved.lastRank}位と${mostImproved.rankImprovement}ランクアップ。おおたかが追いかけるライバルです。`
                : `大きな順位変動はなく、上位は安定した顔ぶれです。`
            }
          />

          {/* 安定チーム */}
          <InsightCard
            emoji="🛡️"
            title="最も安定したチーム"
            color="indigo"
            body={
              mostConsistent
                ? `${mostConsistent.displayName}が毎大会ほぼ同順位で安定した強さを誇ります。おおたかとしては一貫した底上げ戦略が必要。`
                : 'データなし'
            }
          />

          {/* リレー強化ポイント */}
          <InsightCard
            emoji="💡"
            title="おおたかが伸びるヒント"
            color="rose"
            body={`上位チームとの差は主に参加人数と種目カバー率にあります。特にリレー種目でのメンバー組み合わせ最適化が次回大会での得点アップの近道です。「リレー最適化」タブで試してみましょう！`}
          />
        </div>
      </div>

      {/* ── Multi-team rank chart ── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">チーム別 大会順位推移（上位{chartTeams.length}チーム）</h3>
        </div>
        <p className="text-[10px] text-slate-500 mb-3">グラフ上側ほど上位。おおたかは黄色。</p>
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
        />
      </div>

      {/* ── Latest round points bar chart ── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">第{latestRound}回 得点ランキング（上位{latestStandings.length}チーム）</h3>
        </div>
        <PointsBarChart
          teams={latestStandings.map((t) => ({ name: t.name, displayName: t.displayName, points: t.latestPoints }))}
          focusTeamName={focusTeamName}
        />
      </div>

      {/* ── Rank history table ── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-sky-950/80 to-indigo-950/80">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          <h3 className="text-sm font-bold text-sky-100">全チーム順位推移表</h3>
          <span className="text-[10px] text-slate-500 ml-2">（3大会以上参加チーム）</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: `${200 + rounds.length * 64}px` }}>
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-700">
                <th className="px-3 py-2 text-left text-slate-400 font-medium sticky left-0 bg-slate-900/80">チーム</th>
                <th className="px-2 py-2 text-center text-slate-400 font-medium">avg</th>
                {rounds.map((r) => (
                  <th key={r} className="px-2 py-2 text-center text-slate-400 font-medium whitespace-nowrap">
                    第{r}回
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamStats.map((t, rowIdx) => {
                const isFocus = focusTeamName.includes(t.name) || t.name.includes(focusTeamName.split(/[　\s]/)[0])
                return (
                  <tr
                    key={t.name}
                    className={`border-t border-slate-700/40 ${isFocus ? 'bg-amber-950/30' : rowIdx % 2 === 0 ? 'bg-slate-800/40' : ''}`}
                  >
                    <td className={`px-3 py-2 font-medium sticky left-0 ${isFocus ? 'text-amber-300 bg-amber-950/60' : 'text-slate-200 bg-slate-900/70'} whitespace-nowrap`}>
                      {t.displayName}
                    </td>
                    <td className={`px-2 py-2 text-center font-mono font-bold ${isFocus ? 'text-amber-300' : 'text-slate-300'}`}>
                      {t.avgRank.toFixed(1)}
                    </td>
                    {rounds.map((r) => {
                      const rank = t.rankByRound.get(r)
                      const pts = t.pointsByRound.get(r)
                      return (
                        <td key={r} className="px-2 py-2 text-center">
                          {rank != null && rank < 999 ? (
                            <button
                              className={`text-xs font-bold ${rank <= 3 ? 'text-amber-400' : isFocus ? 'text-amber-200' : 'text-slate-300'} hover:underline`}
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
