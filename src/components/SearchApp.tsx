'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Image from 'next/image'
import { getAthleteProfile } from '@/data/athlete-profiles'
import AllMeetsAnalysis from '@/components/AllMeetsAnalysis'
import RelayOptimizer from '@/components/RelayOptimizer'
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
  TeamStanding,
  MeetRecord,
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
type MainTab = 'results' | 'team' | 'relay-optimize' | 'athlete' | 'age-rank' | 'meet-records' | 'disqualification'
type ResultFilter = 'all' | 'individual' | 'relay'
type AthleteDetailView = 'overview' | 'trends' | 'records' | 'age-rank-indiv'
type DisqualificationRule = {
  id: number
  category: string
  code: string
  description: string
}
type DisqualifiedEntry = {
  id: string
  type: string
  name: string
  gender: string
  team: string
  event: string
  ageGroup: string
  meet: { id: number; round: number; pool_type: string }
  lane: string | null
}
type AthleteHistoryIdentity = {
  id: number
  name: string
  gender: string
  mst_team: { name: string }
}
type AthleteTrend = {
  key: string
  event: string
  poolType: string
  points: {
    round: number
    seconds: number
    time: string
    rank: number | null
    meetRecordSeconds: number | null
  }[]
}
type TeamAnalysis = {
  athleteScores: { playerId: number; name: string; gender: string; points: number; races: number }[]
  totals: {
    individualPoints: number
    relayPoints: number
    officialPoints: number
    genderPoints: Record<string, number>
    relayGenderPoints: Record<string, number>
  } | null
}

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

function formatPoints(points: number): string {
  return points.toFixed(2)
}

function ageGroupLabel(age: number): string {
  const map: Record<number, string> = {
    18: '18～24歳', 25: '25～29歳', 30: '30～34歳', 35: '35～39歳',
    40: '40～44歳', 45: '45～49歳', 50: '50～54歳', 55: '55～59歳',
    60: '60～64歳', 65: '65～69歳', 70: '70～74歳', 75: '75～79歳',
    80: '80～84歳', 85: '85～89歳', 90: '90歳以上',
  }
  return age >= 100 ? `合計${age}歳以上` : (map[age] ?? `${age}歳～`)
}

function formatPointDifference(points: number): string {
  return `${points >= 0 ? '+' : ''}${formatPoints(points)}`
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

function animalAvatar(name: string, teamName: string): string {
  if (!teamName.includes('おおたか')) return '🏊'
  const animals = ['🦦', '🦊', '🐧', '🐬', '🦭', '🐻', '🐼', '🦁', '🐸', '🦉']
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return animals[hash % animals.length]
}

function AthleteTrendCard({ trend }: { trend: AthleteTrend }) {
  const [metric, setMetric] = useState<'time' | 'rank'>('time')
  const width = 320
  const height = 96
  const padX = 18
  const padY = 16
  const values = trend.points.map((point) => point.seconds)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 0.5)
  const timeCoords = trend.points.map((point, index) => {
    const x = trend.points.length === 1
      ? width / 2
      : padX + (index / (trend.points.length - 1)) * (width - padX * 2)
    const y = padY + ((point.seconds - min) / range) * (height - padY * 2)
    return { ...point, x, y }
  })
  const rankedPoints = trend.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.rank != null)
  const maxRank = Math.max(...rankedPoints.map(({ point }) => point.rank ?? 0), 3)
  const rankCoords = rankedPoints.map(({ point, index }) => {
    const x = trend.points.length === 1
      ? width / 2
      : padX + (index / (trend.points.length - 1)) * (width - padX * 2)
    const y = padY + (((point.rank ?? maxRank) - 1) / Math.max(maxRank - 1, 1)) * (height - padY * 2)
    return { ...point, x, y }
  })
  const coords = metric === 'time' ? timeCoords : rankCoords
  const best = trend.points.reduce((current, point) => point.seconds < current.seconds ? point : current)
  const first = trend.points[0]
  const latest = trend.points[trend.points.length - 1]
  const improvement = first.seconds - latest.seconds
  const recordGaps = trend.points
    .filter((point) => point.meetRecordSeconds != null && point.meetRecordSeconds > 0)
    .map((point) => ({
      ...point,
      gap: point.seconds - (point.meetRecordSeconds as number),
    }))
  const closestRecord = recordGaps.length > 0
    ? recordGaps.reduce((current, point) => point.gap < current.gap ? point : current)
    : null

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-bold text-white">{trend.event}</h3>
          <span className="text-[10px] text-sky-500">{trend.poolType}</span>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono font-semibold text-cyan-300">{best.time}</div>
          <div className="text-[10px] text-slate-500">自己ベスト</div>
        </div>
      </div>

      <div className="mb-1 flex rounded-lg bg-slate-900/70 p-0.5">
        <button
          type="button"
          onClick={() => setMetric('time')}
          className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
            metric === 'time' ? 'bg-sky-900/70 text-sky-300' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          タイム
        </button>
        <button
          type="button"
          onClick={() => setMetric('rank')}
          disabled={rankedPoints.length === 0}
          className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
            metric === 'rank'
              ? 'bg-amber-900/50 text-amber-300'
              : rankedPoints.length === 0
                ? 'cursor-not-allowed text-slate-700'
                : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          順位
        </button>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24" role="img" aria-label={`${trend.event}の${metric === 'time' ? 'タイム' : '順位'}推移`}>
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#334155" strokeWidth="1" />
        {coords.length > 1 && (
          <polyline
            points={coords.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={metric === 'time' ? '#38bdf8' : '#f59e0b'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {coords.map((point) => (
          <g key={`${point.round}-${point.seconds}`}>
            <title>
              {`第${point.round}回：${point.time}${point.rank != null ? `／${point.rank}位` : ''}`}
            </title>
            <circle
              cx={point.x}
              cy={point.y}
              r="4"
              fill={
                metric === 'time'
                  ? point.seconds === best.seconds ? '#fbbf24' : '#38bdf8'
                  : point.rank === Math.min(...rankedPoints.map(({ point: ranked }) => ranked.rank ?? 999))
                    ? '#fbbf24'
                    : '#f59e0b'
              }
            />
            {metric === 'rank' && (
              <text x={point.x} y={point.y - 7} textAnchor="middle" fill="#fbbf24" fontSize="9">
                {point.rank}位
              </text>
            )}
            <text x={point.x} y={height - 3} textAnchor="middle" fill="#64748b" fontSize="9">第{point.round}回</text>
          </g>
        ))}
      </svg>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">{trend.points.length}レース</span>
        {trend.points.length > 1 && (
          <span className={improvement > 0 ? 'text-emerald-400' : improvement < 0 ? 'text-rose-400' : 'text-slate-400'}>
            初回比 {improvement > 0 ? `${improvement.toFixed(2)}秒短縮` : improvement < 0 ? `${Math.abs(improvement).toFixed(2)}秒増` : '変化なし'}
          </span>
        )}
      </div>
      {closestRecord && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
          closestRecord.gap <= 0
            ? 'border-amber-600/40 bg-amber-950/30 text-amber-300'
            : closestRecord.gap <= 1
              ? 'border-emerald-600/40 bg-emerald-950/30 text-emerald-300'
              : 'border-slate-700 bg-slate-900/40 text-slate-400'
        }`}>
          {closestRecord.gap <= 0
            ? `大会記録を${Math.abs(closestRecord.gap).toFixed(2)}秒上回った記録あり`
            : `大会新まであと${closestRecord.gap.toFixed(2)}秒`}
        </div>
      )}
    </div>
  )
}

const OVERLAY_COLORS = ['#f97316', '#a855f7', '#22c55e', '#ec4899', '#eab308', '#14b8a6']

function TeamProgressChart({
  standings,
  overlayTeams = [],
  selectedRound,
  onRoundSelect,
  teamName,
}: {
  standings: TeamStanding[]
  overlayTeams?: { name: string; standings: TeamStanding[]; color: string }[]
  selectedRound?: number
  onRoundSelect?: (eventId: number) => void
  teamName?: string
}) {
  const [showRank, setShowRank] = useState(true)
  const [showPoints, setShowPoints] = useState(false)
  const [hiddenTeams, setHiddenTeams] = useState<Set<string>>(new Set())

  // SVG実描画幅を計測してフォントサイズをCSSピクセル単位で指定できるようにする
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgRenderedWidth, setSvgRenderedWidth] = useState(720)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setSvgRenderedWidth(entries[0].contentRect.width || 720)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // SVG座標系でのフォントサイズ計算（cssPixels → SVG units）
  // PC（幅500px超）はテキストを1.4倍にして読みやすくする。モバイルは等倍。
  const px = (cssPixels: number) => {
    const boosted = svgRenderedWidth > 500 ? cssPixels * 1.4 : cssPixels
    return Math.round((boosted / svgRenderedWidth) * 720)
  }

  const rows = standings
    .filter((standing) => standing.mst_event)
    .sort((a, b) => (a.mst_event?.round ?? 0) - (b.mst_event?.round ?? 0))

  const overlayRows = overlayTeams.map((t) => ({
    ...t,
    rows: t.standings
      .filter((s) => s.mst_event)
      .sort((a, b) => (a.mst_event?.round ?? 0) - (b.mst_event?.round ?? 0)),
  }))

  const width = 720
  const height = 210
  const padX = 42
  const padY = 24

  // X軸: 全チームの回数を統合
  const allRoundNumbers = [
    ...new Set([
      ...rows.map((r) => r.mst_event?.round ?? 0),
      ...overlayRows.flatMap((t) => t.rows.map((r) => r.mst_event?.round ?? 0)),
    ]),
  ]
    .filter((r) => r > 0)
    .sort((a, b) => a - b)

  const xForRound = (round: number) => {
    const idx = allRoundNumbers.indexOf(round)
    return allRoundNumbers.length <= 1
      ? width / 2
      : padX + (idx / (allRoundNumbers.length - 1)) * (width - padX * 2)
  }

  // 全チーム統合スケール
  const allRankValues = [
    ...rows.map((r) => r.rank ?? 0),
    ...overlayRows.flatMap((t) => t.rows.map((r) => r.rank ?? 0)),
  ].filter((r) => r > 0)
  const maxRank = Math.max(...allRankValues, 3)

  const allPointValues = [
    ...rows.map((r) => Number(r.total_points ?? 0)),
    ...overlayRows.flatMap((t) => t.rows.map((r) => Number(r.total_points ?? 0))),
  ]
  const maxPoints = Math.max(...allPointValues, 1)
  const minPoints = Math.min(...allPointValues)
  const pointRange = Math.max(maxPoints - minPoints, 1)

  const padBottom = 46
  const rankY = (rank: number) =>
    padY + ((rank - 1) / Math.max(maxRank - 1, 1)) * (height - padY - padBottom)
  const pointY = (pts: number) =>
    padY + ((maxPoints - pts) / pointRange) * (height - padY - padBottom)

  const ranks = rows.map((row) => row.rank ?? 0).filter((r) => r > 0)
  const rankCoords = rows.map((row) => ({
    row,
    x: xForRound(row.mst_event?.round ?? 0),
    y: rankY(row.rank ?? maxRank),
  }))
  const pointCoords = rows.map((row) => ({
    row,
    x: xForRound(row.mst_event?.round ?? 0),
    y: pointY(Number(row.total_points ?? 0)),
  }))

  return (
    <div className="rounded-xl border border-cyan-900/50 bg-slate-800/60 p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">{teamName ?? 'おおたか'} 大会推移</h3>
          <p className="text-[10px] text-slate-300 mt-0.5">グラフ上側ほど上位・高得点です</p>
        </div>
        <div className="flex gap-4 text-right">
          {showRank && ranks.length > 0 && (
            <div>
              <div className="text-lg font-bold text-cyan-300">最高 {Math.min(...ranks)}位</div>
              <div className="text-[10px] text-slate-500">{rows.length}大会</div>
            </div>
          )}
          {showPoints && (
            <div>
              <div className="text-lg font-bold text-amber-300">最高 {formatPoints(maxPoints)}pt</div>
              {!showRank && <div className="text-[10px] text-slate-500">{rows.length}大会</div>}
            </div>
          )}
          {!showRank && !showPoints && (
            <div className="text-[10px] text-slate-500">{rows.length}大会</div>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 items-center">
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input
            type="checkbox"
            checked={showRank}
            onChange={(e) => setShowRank(e.target.checked)}
            className="h-3.5 w-3.5 accent-cyan-400"
          />
          <span className="text-[10px] font-semibold text-cyan-300">順位</span>
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPoints}
            onChange={(e) => setShowPoints(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-400"
          />
          <span className="text-[10px] font-semibold text-amber-300">総得点</span>
        </label>
        {overlayRows.length > 0 && (
          <>
            <span className="text-slate-600 text-[10px] select-none">|</span>
            <span className="text-[10px] text-cyan-400">● {teamName ?? 'おおたか'}</span>
            {overlayRows.map((t) => {
              const hidden = hiddenTeams.has(t.name)
              return (
                <button
                  key={t.name}
                  className={`text-[10px] transition-opacity cursor-pointer select-none ${hidden ? 'opacity-30 line-through' : 'opacity-100'}`}
                  style={{ color: t.color }}
                  onClick={() => setHiddenTeams((prev) => {
                    const next = new Set(prev)
                    if (next.has(t.name)) next.delete(t.name)
                    else next.add(t.name)
                    return next
                  })}
                  title={hidden ? `${t.name}を表示` : `${t.name}を非表示`}
                >
                  ● {t.name}
                </button>
              )
            })}
          </>
        )}
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full h-52" role="img" aria-label="大会推移グラフ">
        {/* 順位グリッド（左軸） */}
        {showRank && [1, Math.ceil(maxRank / 2), maxRank]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((rank) => {
            const y = rankY(rank)
            return (
              <g key={`rg-${rank}`}>
                <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
                <text x={padX - 8} y={y + 3} textAnchor="end" fill="#64748b" fontSize={px(10)}>{rank}位</text>
              </g>
            )
          })}

        {/* 得点グリッド */}
        {showPoints && [maxPoints, (maxPoints + minPoints) / 2, minPoints]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((pt) => {
            const y = pointY(pt)
            return showRank ? (
              <text key={`pr-${pt}`} x={width - padX + 4} y={y + 3} textAnchor="start" fill="#78350f" fontSize={px(10)}>{formatPoints(pt)}pt</text>
            ) : (
              <g key={`pg-${pt}`}>
                <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
                <text x={padX - 8} y={y + 3} textAnchor="end" fill="#64748b" fontSize={px(10)}>{formatPoints(pt)}pt</text>
              </g>
            )
          })}

        {/* 比較チームライン（フォーカスチームより手前に描画） */}
        {overlayRows.filter((team) => !hiddenTeams.has(team.name)).map((team) => (
          <g key={`overlay-${team.name}`}>
            {showRank && team.rows.length > 1 && (
              <polyline
                points={team.rows.map((r) => `${xForRound(r.mst_event?.round ?? 0)},${rankY(r.rank ?? maxRank)}`).join(' ')}
                fill="none" stroke={team.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.75"
              />
            )}
            {showPoints && team.rows.length > 1 && (
              <polyline
                points={team.rows.map((r) => `${xForRound(r.mst_event?.round ?? 0)},${pointY(Number(r.total_points ?? 0))}`).join(' ')}
                fill="none" stroke={team.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.6" strokeDasharray="6 3"
              />
            )}
            {team.rows.map((r) => (
              <g key={`ov-${team.name}-${r.mst_event?.id}`}>
                <title>{`${team.name} 第${r.mst_event?.round}回：${r.rank ?? '－'}位／${formatPoints(Number(r.total_points ?? 0))}pt`}</title>
                {showRank && (
                  <circle cx={xForRound(r.mst_event?.round ?? 0)} cy={rankY(r.rank ?? maxRank)} r={4}
                    fill={team.color} stroke="#1e293b" strokeWidth="1.5" fillOpacity="0.85" />
                )}
                {showPoints && (
                  <circle cx={xForRound(r.mst_event?.round ?? 0)} cy={pointY(Number(r.total_points ?? 0))} r={4}
                    fill={team.color} stroke="#1e293b" strokeWidth="1.5" fillOpacity="0.65" />
                )}
              </g>
            ))}
          </g>
        ))}

        {/* 順位ライン（フォーカスチーム） */}
        {showRank && rankCoords.length > 1 && (
          <polyline
            points={rankCoords.map(({ x, y }) => `${x},${y}`).join(' ')}
            fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          />
        )}

        {/* 得点ライン（フォーカスチーム） */}
        {showPoints && pointCoords.length > 1 && (
          <polyline
            points={pointCoords.map(({ x, y }) => `${x},${y}`).join(' ')}
            fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          />
        )}

        {/* ドット・ラベル・クリック（フォーカスチーム） */}
        {rows.map((row, index) => {
          const selected = row.mst_event?.round === selectedRound
          const rc = rankCoords[index]
          const pc = pointCoords[index]
          const x = rc.x
          const canClick = !!onRoundSelect && row.mst_event != null
          const badgeY = showRank ? rc.y : pc.y
          const lblOff = px(14)   // ラベルとドットの距離（CSSピクセル換算で常に14px）
          const lblOffSel = px(22)
          const rankLabelY = selected
            ? (rc.y + lblOffSel >= height - px(16) ? rc.y - px(48) : rc.y + lblOffSel)
            : (rc.y - lblOff <= padY + 2 ? rc.y + lblOff : rc.y - lblOff)
          const ptsLabelY = selected
            ? (pc.y + lblOffSel >= height - px(16) ? pc.y - px(48) : pc.y + lblOffSel)
            : (pc.y - lblOff <= padY + 2 ? pc.y + lblOff : pc.y - lblOff)

          return (
            <g
              key={row.mst_event?.id}
              onClick={canClick ? () => onRoundSelect!(row.mst_event!.id) : undefined}
              style={canClick ? { cursor: 'pointer' } : undefined}
            >
              <title>{`第${row.mst_event?.round}回：${row.rank ?? '－'}位／${formatPoints(Number(row.total_points ?? 0))}pt`}</title>

              {selected && (showRank || showPoints) && (
                <>
                  <circle cx={x} cy={badgeY} r={px(11)} fill="#f59e0b" fillOpacity="0.2" />
                  <rect x={x - px(18)} y={badgeY - px(33)} width={px(36)} height={px(14)} rx={px(7)} fill="#f59e0b" />
                  <text x={x} y={badgeY - px(23)} textAnchor="middle" fill="#451a03" fontSize={px(9)} fontWeight="700">今回</text>
                </>
              )}

              {showRank && (
                <>
                  <circle cx={x} cy={rc.y} r={selected ? px(7) : px(5)}
                    fill={selected ? '#fbbf24' : '#22d3ee'}
                    stroke={selected ? '#fef3c7' : '#083344'}
                    strokeWidth={selected ? 3 : 2}
                  />
                  <text x={x} y={rankLabelY} textAnchor="middle"
                    fill={selected ? '#fbbf24' : '#a5f3fc'} fontSize={px(12)} fontWeight={selected ? '700' : '400'}>
                    {row.rank ?? '－'}位
                  </text>
                </>
              )}

              {showPoints && (
                <>
                  <circle cx={x} cy={pc.y} r={selected ? px(7) : px(5)}
                    fill={selected ? '#fbbf24' : '#f59e0b'}
                    stroke={selected ? '#fef3c7' : '#451a03'}
                    strokeWidth={selected ? 3 : 2}
                  />
                  <text x={x} y={ptsLabelY} textAnchor="middle"
                    fill={selected ? '#fbbf24' : '#fcd34d'} fontSize={px(12)} fontWeight={selected ? '700' : '400'}>
                    {formatPoints(Number(row.total_points ?? 0))}pt
                  </text>
                </>
              )}

              <text x={x} y={height - px(3)} textAnchor="middle"
                fill={selected ? '#fbbf24' : canClick ? '#94a3b8' : '#64748b'}
                fontSize={px(10)} fontWeight={selected ? '700' : '400'}>
                第{row.mst_event?.round}回
              </text>
              {canClick && (
                <rect x={x - px(22)} y={height - px(15)} width={px(44)} height={px(14)} fill="transparent" />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
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
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)

  const [sortField, setSortField] = useState<SortField>('time')

  type ColKey = 'meet_round' | 'team' | 'event' | 'age' | 'time' | 'dive' | 'record' | 'rank' | 'points' | 'meet_record' | 'diff'
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
    { key: 'meet_record',  label: '大会新' },
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

  type RelayColKey = 'relay_meet_round' | 'relay_team' | 'relay_event' | 'relay_age' | 'relay_gender' | 'relay_time' | 'relay_record' | 'relay_rank' | 'relay_points' | 'relay_meet_record' | 'relay_diff'
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
    { key: 'relay_meet_record', label: '大会新' },
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
  const [activeTab, setActiveTab] = useState<MainTab>('results')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [athleteDetailView, setAthleteDetailView] = useState<AthleteDetailView>('overview')
  const [teamStandings, setTeamStandings] = useState<TeamStanding[]>([])
  const [teamHistoryStandings, setTeamHistoryStandings] = useState<TeamStanding[]>([])
  const [teamStandingsLoading, setTeamStandingsLoading] = useState(false)
  const [checkedTeamNames, setCheckedTeamNames] = useState<Set<string>>(new Set())
  const [teamTableOpen, setTeamTableOpen] = useState(true)
  const [scoreBreakdownOpen, setScoreBreakdownOpen] = useState(true)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [teamAnalysis, setTeamAnalysis] = useState<TeamAnalysis | null>(null)

  // 年代別順位タブ
  const [ageRankMeetId, setAgeRankMeetId] = useState<number | null>(null)
  const [ageRankEventKey, setAgeRankEventKey] = useState('')
  const [ageRankGender, setAgeRankGender] = useState('')
  const [ageRankAgeValue, setAgeRankAgeValue] = useState('')  // ind:{id} or rel:{label}
  const [ageRankHighlightName, setAgeRankHighlightName] = useState('')
  const [ageRankHighlightTeam, setAgeRankHighlightTeam] = useState('')
  const [ageRankResults, setAgeRankResults] = useState<IndividualResult[]>([])
  const [ageRankRelayResults, setAgeRankRelayResults] = useState<RelayResult[]>([])
  const [ageRankLoading, setAgeRankLoading] = useState(false)
  const [disqualificationView, setDisqualificationView] = useState<'rules' | 'offenders'>('rules')
  const [disqualificationRules, setDisqualificationRules] = useState<DisqualificationRule[]>([])
  const [disqualifiedEntries, setDisqualifiedEntries] = useState<DisqualifiedEntry[]>([])
  const [disqualificationLoading, setDisqualificationLoading] = useState(false)

  // 大会新一覧タブ
  const [mrCourse, setMrCourse] = useState<'短水路' | '長水路'>('短水路')
  const [mrEvent, setMrEvent] = useState('')
  const [mrGender, setMrGender] = useState('')
  const [mrAgeGroup, setMrAgeGroup] = useState('')
  const [mrHighlightTeam, setMrHighlightTeam] = useState('')
  const [mrHighlightName, setMrHighlightName] = useState('')
  const [mrRecords, setMrRecords] = useState<MeetRecord[]>([])
  const [mrLoading, setMrLoading] = useState(false)
  const [mrTeamDropdownOpen, setMrTeamDropdownOpen] = useState(false)

  // Resizable columns (desktop)
  const [leftW, setLeftW] = useState(240)
  const [rightW, setRightW] = useState(300)
  const drag = useRef<{ side: 'l' | 'r'; x0: number; w0: number } | null>(null)
  const mrTeamDropdownRef = useRef<HTMLDivElement>(null)

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

  const overlayTeamStandings = useMemo(() => {
    return [...checkedTeamNames].map((name, i) => ({
      name: teamDisplayName(name),
      standings: teamHistoryStandings.filter((s) => s.mst_team.name === name),
      color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
    }))
  }, [checkedTeamNames, teamHistoryStandings])

  const filteredTeamGroups = useMemo(() => {
    if (activeTab !== 'team' || !meetId || teamStandings.length === 0) return teamGroups
    const participatingNames = new Set(teamStandings.map((s) => normalizeOptionName(s.mst_team.name)))
    return teamGroups
      .map(({ pref, teams: grpTeams }) => ({
        pref,
        teams: grpTeams.filter((t) => participatingNames.has(normalizeOptionName(t.name))),
      }))
      .filter((g) => g.teams.length > 0)
  }, [activeTab, meetId, teamStandings, teamGroups])

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

  useEffect(() => {
    if (activeTab !== 'team') return

    const controller = new AbortController()
    setTeamStandingsLoading(true)

    const url = meetId ? `/api/team-standings?eventId=${meetId}` : '/api/team-standings'
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('チーム順位を取得できませんでした')
        return response.json()
      })
      .then((body) => setTeamStandings((body.standings ?? []) as TeamStanding[]))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setTeamStandings([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setTeamStandingsLoading(false)
      })

    return () => controller.abort()
  }, [activeTab, meetId])

  useEffect(() => {
    if (activeTab !== 'team') return

    const controller = new AbortController()
    fetch('/api/team-standings', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('チーム順位履歴を取得できませんでした')
        return response.json()
      })
      .then((body) => setTeamHistoryStandings((body.standings ?? []) as TeamStanding[]))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setTeamHistoryStandings([])
      })

    return () => controller.abort()
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'team' || meetId) return

    const controller = new AbortController()
    fetch('/api/team-analysis', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('チーム分析を取得できませんでした')
        return response.json()
      })
      .then((body) => setTeamAnalysis(body as TeamAnalysis))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setTeamAnalysis(null)
      })

    return () => controller.abort()
  }, [activeTab, meetId])

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

  // フォーカスチームが変わったとき、そのチームがoverlayに残っていたら除外
  useEffect(() => {
    if (!selectedTeam) return
    setCheckedTeamNames((prev) => {
      if (!prev.has(selectedTeam.name)) return prev
      const next = new Set(prev)
      next.delete(selectedTeam.name)
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam?.name])

  const selectedTeamIds = selectedTeam?.ids ?? []
  const selectedTeamIdsKey = selectedTeamIds.join(',')
  const selectedEvent = filteredEvents.find((e) => e.ids.join(',') === eventKey)
  const selectedEventIds = selectedEvent?.ids ?? []
  const selectedEventIdsKey = selectedEventIds.join(',')

  // 年代別順位タブ用の計算値
  const ageRankCurrentMeet = meets.find((m) => m.id === ageRankMeetId)
  const ageRankFilteredEvents = useMemo<EventGroup[]>(() => {
    if (!ageRankCurrentMeet || ageRankCurrentMeet.pool_type !== '長水路') return uniqueEvents
    return uniqueEvents.filter((e) => !e.name.startsWith('25m') && !e.name.startsWith('4×25m'))
  }, [uniqueEvents, ageRankCurrentMeet])
  const selectedAgeRankEvent = ageRankFilteredEvents.find((e) => e.ids.join(',') === ageRankEventKey)
  const selectedAgeRankEventIdsKey = selectedAgeRankEvent?.ids.join(',') ?? ''
  const ageRankAgeName = visibleAgeGroups.find((a) => `ind:${a.id}` === ageRankAgeValue)?.name
    ?? (ageRankAgeValue.startsWith('rel:') ? ageRankAgeValue.slice(4) : '')
  const isAgeRankRelay = selectedAgeRankEvent?.type === 'リレー' || ageRankGender === '混合'
  const ageRankRelayStrokeHeaders = ageRankRelayResults[0]?.dt_player_relay ?? []

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

  const updateUrl = useCallback((updates: {
    tab?: MainTab
    filter?: ResultFilter | null
    athleteId?: number | null
    athleteView?: AthleteDetailView | null
  }, replace = false) => {
    const url = new URL(window.location.href)
    if (updates.tab !== undefined) {
      if (updates.tab === 'results') url.searchParams.delete('tab')
      else url.searchParams.set('tab', updates.tab)
    }
    if (updates.filter !== undefined) {
      if (!updates.filter || updates.filter === 'all') url.searchParams.delete('filter')
      else url.searchParams.set('filter', updates.filter)
    }
    if (updates.athleteId !== undefined) {
      if (updates.athleteId === null) url.searchParams.delete('athlete')
      else url.searchParams.set('athlete', String(updates.athleteId))
    }
    if (updates.athleteView !== undefined) {
      if (updates.athleteView === null || updates.athleteView === 'overview') url.searchParams.delete('view')
      else url.searchParams.set('view', updates.athleteView)
    }
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
  }, [])

  const fetchAthleteHistory = useCallback((id: number, name: string, genderStr: string, teamName?: string, updateAddress = true) => {
    setAthleteDetailView('overview')
    setAthleteForHistory({ id, name, gender: genderStr, teamName: teamName ?? '' })
    setAthleteHistory(null)
    setHistoryLoading(true)
    if (updateAddress) updateUrl({ athleteId: id, athleteView: null })
    fetch(`/api/athlete-history?athleteId=${id}`)
      .then((res) => res.json())
      .then((data: { athlete?: AthleteHistoryIdentity; meets: AthleteHistoryMeet[] }) => {
        if (data.athlete) {
          setAthleteForHistory({
            id: data.athlete.id,
            name: data.athlete.name,
            gender: data.athlete.gender,
            teamName: data.athlete.mst_team.name,
          })
        }
        setAthleteHistory(data.meets ?? [])
        setHistoryLoading(false)
      })
      .catch(() => setHistoryLoading(false))
  }, [updateUrl])

  const handleTabChange = useCallback((tab: MainTab) => {
    setActiveTab(tab)
    updateUrl({ tab })
  }, [updateUrl])

  const handleResultFilterChange = useCallback((filter: ResultFilter) => {
    setResultFilter(filter)
    updateUrl({ filter })
  }, [updateUrl])

  const handleAthleteViewChange = useCallback((view: AthleteDetailView) => {
    setAthleteDetailView(view)
    updateUrl({ athleteView: view })
  }, [updateUrl])

  useEffect(() => {
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab')
      const legacyResultTabs = ['all', 'individual', 'relay']
      const validTabs: MainTab[] = ['results', 'team', 'relay-optimize', 'athlete', 'age-rank', 'meet-records', 'disqualification']
      const restoredTab: MainTab = validTabs.includes(tab as MainTab)
        ? (tab as MainTab)
        : legacyResultTabs.includes(tab ?? '')
          ? 'results'
          : 'results'
      const filterFromUrl = params.get('filter') ?? (legacyResultTabs.includes(tab ?? '') ? tab : 'all')
      const validFilters: ResultFilter[] = ['all', 'individual', 'relay']
      const restoredFilter: ResultFilter = validFilters.includes(filterFromUrl as ResultFilter)
        ? (filterFromUrl as ResultFilter)
        : 'all'
      setResultFilter(restoredFilter)
      const view = params.get('view')
      const validViews: AthleteDetailView[] = ['overview', 'trends', 'records', 'age-rank-indiv']
      const restoredView = validViews.includes(view as AthleteDetailView) ? view as AthleteDetailView : 'overview'
      const athleteIdFromUrl = Number(params.get('athlete'))
      setActiveTab(restoredTab)
      if (Number.isInteger(athleteIdFromUrl) && athleteIdFromUrl > 0) {
        fetchAthleteHistory(athleteIdFromUrl, '', '', '', false)
        setAthleteDetailView(restoredView)
      } else {
        setAthleteForHistory(null)
        setAthleteHistory(null)
        setAthleteDetailView('overview')
      }
    }

    restoreFromUrl()
    window.addEventListener('popstate', restoreFromUrl)
    return () => window.removeEventListener('popstate', restoreFromUrl)
  }, [fetchAthleteHistory])

  const handleAthleteClick = useCallback((r: IndividualResult) => {
    fetchAthleteHistory(r.player_id, r.dt_player_person.name, r.dt_player_person.gender, r.dt_player_person.mst_team.name)
    setMobileDrawerOpen(true)
  }, [fetchAthleteHistory])

  const handleRelayMemberClick = useCallback((m: RelayMember) => {
    fetchAthleteHistory(m.player_id, m.dt_player_person?.name ?? '', m.dt_player_person?.gender ?? '')
    setMobileDrawerOpen(true)
  }, [fetchAthleteHistory])

  const handleJumpToAgeRank = useCallback((
    round: number,
    eventName: string,
    ageGroupNameOrLabel: string,
    isRelay = false,
  ) => {
    if (!athleteForHistory) return
    const meet = meets.find((m) => m.round === round)
    if (!meet) return
    const event = uniqueEvents.find((e) => e.name === eventName)
    if (!event) return
    setAgeRankMeetId(meet.id)
    setAgeRankEventKey(event.ids.join(','))
    if (isRelay) {
      setAgeRankGender(eventName.includes('混合') ? '混合' : athleteForHistory.gender)
      setAgeRankAgeValue(ageGroupNameOrLabel ? `rel:${ageGroupNameOrLabel}` : '')
      setAgeRankHighlightTeam(athleteForHistory.teamName)
      setAgeRankHighlightName(athleteForHistory.name)
    } else {
      setAgeRankGender(athleteForHistory.gender)
      const ageGroup = visibleAgeGroups.find((a) => a.name === ageGroupNameOrLabel)
      setAgeRankAgeValue(ageGroup ? `ind:${ageGroup.id}` : '')
      setAgeRankHighlightTeam(athleteForHistory.teamName)
      setAgeRankHighlightName(athleteForHistory.name)
    }
    setAgeRankResults([])
    setAgeRankRelayResults([])
    handleTabChange('age-rank')
  }, [meets, uniqueEvents, visibleAgeGroups, athleteForHistory, handleTabChange])

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

  const handleAthleteFilterChange = useCallback((value: string) => {
    const id = value ? Number(value) : null
    setAthleteId(id)

    if (!id) {
      setAthleteForHistory(null)
      setAthleteHistory(null)
      setAthleteDetailView('overview')
      if (activeTab === 'athlete') setActiveTab('results')
      updateUrl({
        tab: activeTab === 'athlete' ? 'results' : activeTab,
        athleteId: null,
        athleteView: null,
      })
      return
    }

    const athlete = uniqueAthletes.find((item) => item.id === id)
    if (athlete) {
      fetchAthleteHistory(id, athlete.name, athlete.gender, selectedTeam?.name ?? '')
    }
  }, [activeTab, fetchAthleteHistory, selectedTeam, uniqueAthletes, updateUrl])

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

  // 年代別順位データフェッチ
  useEffect(() => {
    if (activeTab !== 'age-rank') return
    const isRelay = selectedAgeRankEvent?.type === 'リレー' || ageRankGender === '混合'

    if (isRelay) {
      if (!ageRankMeetId || !selectedAgeRankEventIdsKey) {
        setAgeRankRelayResults([])
        return
      }
      setAgeRankLoading(true)
      const p = new URLSearchParams()
      p.set('eventId', String(ageRankMeetId))
      p.set('categoryIds', selectedAgeRankEventIdsKey)
      if (ageRankGender && ageRankGender !== '混合') p.set('gender', ageRankGender)
      if (ageRankAgeValue.startsWith('rel:')) p.set('ageGroupLabel', ageRankAgeValue.slice(4))
      let cancelled = false
      fetch(`/api/relay?${p}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setAgeRankRelayResults(data.results ?? [])
            setAgeRankResults([])
            setAgeRankLoading(false)
          }
        })
        .catch(() => { if (!cancelled) setAgeRankLoading(false) })
      return () => { cancelled = true }
    }

    if (!ageRankMeetId || !selectedAgeRankEventIdsKey || !ageRankGender || !ageRankAgeValue.startsWith('ind:')) {
      setAgeRankResults([])
      return
    }
    setAgeRankLoading(true)
    const p = new URLSearchParams()
    p.set('eventId', String(ageRankMeetId))
    p.set('categoryIds', selectedAgeRankEventIdsKey)
    p.set('gender', ageRankGender)
    p.set('ageId', ageRankAgeValue.slice(4))
    let cancelled = false
    fetch(`/api/search?${p}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setAgeRankResults(data.results ?? [])
          setAgeRankRelayResults([])
          setAgeRankLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setAgeRankLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ageRankMeetId, selectedAgeRankEventIdsKey, ageRankGender, ageRankAgeValue, selectedAgeRankEvent?.type])

  useEffect(() => {
    if (activeTab !== 'disqualification') return
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (meetId) params.set('eventId', String(meetId))
    if (selectedTeamIdsKey) params.set('teamIds', selectedTeamIdsKey)
    if (gender) params.set('gender', gender)
    setDisqualificationLoading(true)
    fetch(`/api/disqualifications?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('失格情報を取得できませんでした')
        return response.json()
      })
      .then((body) => {
        setDisqualificationRules(body.rules ?? [])
        setDisqualifiedEntries(body.offenders ?? [])
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDisqualificationRules([])
        setDisqualifiedEntries([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setDisqualificationLoading(false)
      })
    return () => controller.abort()
  }, [activeTab, meetId, selectedTeamIdsKey, gender])

  // 大会新一覧データフェッチ
  useEffect(() => {
    if (activeTab !== 'meet-records') return
    setMrLoading(true)
    let cancelled = false
    fetch(`/api/meet-records?course=${encodeURIComponent(mrCourse)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setMrRecords(data.records ?? [])
          setMrEvent('')
          setMrGender('')
          setMrAgeGroup('')
          setMrHighlightTeam('')
          setMrHighlightName('')
          setMrLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setMrLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, mrCourse])

  useEffect(() => {
    if (!mrTeamDropdownOpen) return
    const handleOutside = (event: MouseEvent) => {
      if (mrTeamDropdownRef.current && !mrTeamDropdownRef.current.contains(event.target as Node)) {
        setMrTeamDropdownOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMrTeamDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [mrTeamDropdownOpen])

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

  // ── Age-rank filter panel ──────────────────────────────────────
  // 大会新一覧 derived values
  const mrUniqueEvents = useMemo(() =>
    [...new Set(mrRecords.map((r) => `${r.event} ${r.distance}`))].sort((a, b) => a.localeCompare(b, 'ja'))
  , [mrRecords])
  const mrUniqueAgeGroups = useMemo(() =>
    [...new Set(mrRecords.map((r) => r.age_group))].sort((a, b) => a - b)
  , [mrRecords])
  const mrFiltered = useMemo(() => {
    return mrRecords.filter((r) => {
      if (mrEvent && `${r.event} ${r.distance}` !== mrEvent) return false
      if (mrGender && r.gender !== mrGender) return false
      if (mrAgeGroup && String(r.age_group) !== mrAgeGroup) return false
      return true
    })
  }, [mrRecords, mrEvent, mrGender, mrAgeGroup])
  const mrUniqueTeams = useMemo(() =>
    [...new Set(mrRecords.filter(r => !r.is_relay && r.team_name).map(r => r.team_name as string))]
      .sort((a, b) => a.localeCompare(b, 'ja'))
  , [mrRecords])
  const mrTeamAthletes = useMemo(() =>
    mrHighlightTeam
      ? [...new Set(mrRecords.filter(r => !r.is_relay && r.team_name === mrHighlightTeam && r.athlete_name).map(r => r.athlete_name as string))]
          .sort((a, b) => a.localeCompare(b, 'ja'))
      : []
  , [mrRecords, mrHighlightTeam])
  const mrTeamGroupOptions = useMemo(() => (
    teamGroups.map(({ pref, teams: groupedTeams }) => {
      const teams = groupedTeams.map((team) => {
        const matched = mrUniqueTeams.find(
          (recordTeam) => normalizeOptionName(recordTeam) === normalizeOptionName(team.name)
        )
        return {
          id: team.id,
          label: team.displayName,
          value: matched ?? '',
          disabled: !matched,
        }
      })
      return {
        pref: pref ?? 'その他',
        teams,
      }
    })
  ), [mrUniqueTeams, teamGroups])
  const mrHighlightTeamLabel = useMemo(() => {
    if (!mrHighlightTeam) return 'すべて'
    return teamDisplayName(mrHighlightTeam)
  }, [mrHighlightTeam])
  const mrGroupedByEvent = useMemo(() => {
    const groups = new Map<string, MeetRecord[]>()
    for (const r of mrFiltered) {
      const key = `${r.event} ${r.distance}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }
    return groups
  }, [mrFiltered])
  const mrAthleteRecords = useMemo(() =>
    mrHighlightName
      ? mrRecords.filter(r => !r.is_relay && r.athlete_name === mrHighlightName)
          .sort((a, b) => {
            if (a.event !== b.event) return a.event.localeCompare(b.event, 'ja')
            if (a.distance !== b.distance) return a.distance.localeCompare(b.distance)
            return a.age_group - b.age_group
          })
      : []
  , [mrRecords, mrHighlightName])

  const meetRecordsFilterPanel = (
    <div className="flex flex-col gap-3.5 p-4">
      <div>
        <label className={lbl}>水路</label>
        <div className="flex gap-1">
          {(['短水路', '長水路'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setMrCourse(c)}
              className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${
                mrCourse === c
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>競技名</label>
        <select
          className={sel}
          value={mrEvent}
          onChange={(e) => { setMrEvent(e.target.value); setMrHighlightTeam(''); setMrHighlightName('') }}
        >
          <option value="">すべて</option>
          {mrUniqueEvents.filter(e => !e.includes('リレー')).length > 0 && (
            <optgroup label="─── 個人 ───">
              {mrUniqueEvents.filter(e => !e.includes('リレー')).map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </optgroup>
          )}
          {mrUniqueEvents.filter(e => e.includes('リレー')).length > 0 && (
            <optgroup label="─── リレー ───">
              {mrUniqueEvents.filter(e => e.includes('リレー')).map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div>
        <label className={lbl}>性別</label>
        <select
          className={sel}
          value={mrGender}
          onChange={(e) => { setMrGender(e.target.value); setMrHighlightTeam(''); setMrHighlightName('') }}
        >
          <option value="">すべて</option>
          <option value="女">女</option>
          <option value="男">男</option>
          <option value="混合">混合（リレー）</option>
        </select>
      </div>

      <div>
        <label className={lbl}>年齢区分</label>
        <select
          className={sel}
          value={mrAgeGroup}
          onChange={(e) => { setMrAgeGroup(e.target.value); setMrHighlightTeam(''); setMrHighlightName('') }}
        >
          <option value="">すべて</option>
          {mrUniqueAgeGroups.map((a) => (
            <option key={a} value={String(a)}>
              {ageGroupLabel(a)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={lbl}>チーム（目立たせ）</label>
        <div className="relative" ref={mrTeamDropdownRef}>
          <button
            type="button"
            className={`${sel} flex w-full items-center justify-between text-left`}
            aria-haspopup="listbox"
            aria-expanded={mrTeamDropdownOpen}
            onClick={() => setMrTeamDropdownOpen((open) => !open)}
          >
            <span className={mrHighlightTeam ? 'text-slate-200' : 'text-slate-400'}>
              {mrHighlightTeamLabel}
            </span>
            <span className={`text-slate-500 transition-transform ${mrTeamDropdownOpen ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>

          {mrTeamDropdownOpen && (
            <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-slate-600 bg-slate-800 shadow-2xl">
              <div className="max-h-80 overflow-y-auto py-1.5">
                <button
                  type="button"
                  className={`mx-1 mb-1 block w-[calc(100%-0.5rem)] rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    !mrHighlightTeam
                      ? 'bg-sky-900/60 text-sky-100'
                      : 'text-slate-200 hover:bg-slate-700/70'
                  }`}
                  onClick={() => {
                    setMrHighlightTeam('')
                    setMrHighlightName('')
                    setMrTeamDropdownOpen(false)
                  }}
                >
                  すべて
                </button>

                {mrTeamGroupOptions.map((group) => (
                  <div key={group.pref} className="px-1 pb-1">
                    <div
                      className="mb-1 rounded-md border border-slate-600/80 bg-slate-700/95 px-3 py-1.5"
                      role="presentation"
                    >
                      <span className="text-xs font-bold tracking-[0.18em] text-slate-100">
                        -- {group.pref} ----
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      {group.teams.map((team) => {
                        const isSelected = mrHighlightTeam === team.value && !team.disabled
                        return (
                          <button
                            key={team.id}
                            type="button"
                            disabled={team.disabled}
                            aria-disabled={team.disabled}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                              team.disabled
                                ? 'cursor-not-allowed text-slate-400'
                                : isSelected
                                  ? 'bg-emerald-500/10 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(74,222,128,0.35),0_0_14px_rgba(74,222,128,0.18)]'
                                  : 'text-emerald-300 [text-shadow:0_0_10px_rgba(74,222,128,0.35)] hover:bg-slate-700/70 hover:text-emerald-200 hover:[text-shadow:0_0_14px_rgba(74,222,128,0.45)]'
                            }`}
                            onClick={() => {
                              if (team.disabled) return
                              setMrHighlightTeam(team.value)
                              setMrHighlightName('')
                              setMrTeamDropdownOpen(false)
                            }}
                          >
                            {team.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {mrHighlightTeam && mrTeamAthletes.length > 0 && (
        <div>
          <label className={lbl}>選手（{mrHighlightTeam}）</label>
          <select
            className={sel}
            value={mrHighlightName}
            onChange={(e) => setMrHighlightName(e.target.value)}
          >
            <option value="">全員</option>
            {mrTeamAthletes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={() => { setMrEvent(''); setMrGender(''); setMrAgeGroup(''); setMrHighlightTeam(''); setMrHighlightName('') }}
        className="mt-0.5 w-full rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-1.5 transition-colors"
      >
        クリア
      </button>
    </div>
  )

  const ageRankFilterPanel = (
    <div className="flex flex-col gap-3.5 p-4">
      <div>
        <label className={lbl}>大会回数</label>
        <select
          className={sel}
          value={ageRankMeetId ?? ''}
          onChange={(e) => {
            setAgeRankMeetId(e.target.value ? Number(e.target.value) : null)
            setAgeRankEventKey('')
            setAgeRankAgeValue('')
            setAgeRankHighlightName('')
          }}
        >
          <option value="" disabled>選択してください</option>
          {meets.map((m) => (
            <option key={m.id} value={m.id}>第{m.round}回（{m.pool_type}）</option>
          ))}
        </select>
      </div>

      <div>
        <label className={lbl}>競技名</label>
        <select
          className={sel}
          value={ageRankEventKey}
          onChange={(e) => {
            const newKey = e.target.value
            const newEvent = ageRankFilteredEvents.find((ev) => ev.ids.join(',') === newKey)
            const wasRelay = isAgeRankRelay
            const willBeRelay = newEvent?.type === 'リレー' || ageRankGender === '混合'
            if (wasRelay !== willBeRelay) setAgeRankAgeValue('')
            setAgeRankEventKey(newKey)
            setAgeRankHighlightName('')
          }}
        >
          <option value="" disabled>選択してください</option>
          {ageRankFilteredEvents.filter((e) => e.type === '個人').length > 0 && (
            <optgroup label="個人">
              {ageRankFilteredEvents.filter((e) => e.type === '個人').map((e) => (
                <option key={e.ids.join(',')} value={e.ids.join(',')}>{e.name}</option>
              ))}
            </optgroup>
          )}
          {ageRankFilteredEvents.filter((e) => e.type === 'リレー').length > 0 && (
            <optgroup label="リレー">
              {ageRankFilteredEvents.filter((e) => e.type === 'リレー').map((e) => (
                <option key={e.ids.join(',')} value={e.ids.join(',')}>{e.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div>
        <label className={lbl}>性別</label>
        <select
          className={sel}
          value={ageRankGender}
          onChange={(e) => {
            const newGender = e.target.value
            const wasRelay = isAgeRankRelay
            const willBeRelay = selectedAgeRankEvent?.type === 'リレー' || newGender === '混合'
            if (wasRelay !== willBeRelay) setAgeRankAgeValue('')
            setAgeRankGender(newGender)
            setAgeRankHighlightName('')
          }}
        >
          <option value="" disabled>選択してください</option>
          <option value="男子">男子</option>
          <option value="女子">女子</option>
          <option value="混合">混合（リレー）</option>
        </select>
      </div>

      <div>
        <label className={lbl}>年齢区分</label>
        <select
          className={sel}
          value={ageRankAgeValue}
          onChange={(e) => { setAgeRankAgeValue(e.target.value); setAgeRankHighlightName('') }}
        >
          {isAgeRankRelay ? (
            <>
              <option value="">すべて（年齢区分なし）</option>
              {relayAgeGroups.map((label) => (
                <option key={label} value={`rel:${label}`}>{label}</option>
              ))}
            </>
          ) : (
            <>
              <option value="" disabled>選択してください</option>
              {visibleAgeGroups.map((a) => (
                <option key={a.id} value={`ind:${a.id}`}>{a.name}</option>
              ))}
            </>
          )}
        </select>
      </div>

      <div>
        <label className={lbl}>チーム（目立たせ）</label>
        {(isAgeRankRelay ? ageRankRelayResults.length === 0 : ageRankResults.length === 0) ? (
          <select className={sel} disabled>
            <option>先に条件を選択してください</option>
          </select>
        ) : (
          <select
            className={sel}
            value={ageRankHighlightTeam}
            onChange={(e) => { setAgeRankHighlightTeam(e.target.value); setAgeRankHighlightName('') }}
          >
            <option value="">－ なし</option>
            {isAgeRankRelay
              ? [...new Set(ageRankRelayResults.map((r) => r.mst_team.name))]
                  .sort((a, b) => a.localeCompare(b, 'ja'))
                  .map((name) => (
                    <option key={name} value={name}>{teamDisplayName(name)}</option>
                  ))
              : [...new Set(ageRankResults.map((r) => r.dt_player_person.mst_team.name))]
                  .sort((a, b) => a.localeCompare(b, 'ja'))
                  .map((name) => (
                    <option key={name} value={name}>{teamDisplayName(name)}</option>
                  ))
            }
          </select>
        )}
      </div>

      {!isAgeRankRelay && (
        <div>
          <label className={lbl}>選手名（目立たせ）</label>
          {ageRankResults.length === 0 ? (
            <select className={sel} disabled>
              <option>先に条件を選択してください</option>
            </select>
          ) : (
            <select
              className={sel}
              value={ageRankHighlightName}
              onChange={(e) => setAgeRankHighlightName(e.target.value)}
            >
              <option value="">－ なし</option>
              {[...new Set(
                [...ageRankResults]
                  .filter((r) => !ageRankHighlightTeam || r.dt_player_person.mst_team.name === ageRankHighlightTeam)
                  .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
                  .map((r) => r.dt_player_person.name)
              )].map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <button
        onClick={() => {
          setAgeRankMeetId(null)
          setAgeRankEventKey('')
          setAgeRankGender('')
          setAgeRankAgeValue('')
          setAgeRankHighlightTeam('')
          setAgeRankHighlightName('')
          setAgeRankResults([])
          setAgeRankRelayResults([])
        }}
        className="mt-0.5 w-full rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-1.5 transition-colors"
      >
        クリア
      </button>
    </div>
  )

  const disqualificationFilterPanel = (
    <div className="flex flex-col gap-3.5 p-4">
      <div>
        <label className={lbl}>大会回数（{meets.length}）</label>
        <select
          className={sel}
          value={meetId ?? ''}
          onChange={(e) => setMeetId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">すべて</option>
          {meets.map((meet) => (
            <option key={meet.id} value={meet.id}>第{meet.round}回（{meet.pool_type}）</option>
          ))}
        </select>
      </div>
      <div>
        <label className={lbl}>チーム（{uniqueTeams.length}）</label>
        <select
          className={sel}
          value={teamKey}
          onChange={(e) => setTeamKey(e.target.value)}
        >
          <option value="">すべて</option>
          {teamGroups.map(({ pref, teams: groupedTeams }) => (
            <optgroup key={pref ?? '__null__'} label={`─── ${pref ?? 'その他'} ───`}>
              {groupedTeams.map((team) => (
                <option key={normalizeOptionName(team.name)} value={normalizeOptionName(team.name)}>
                  {team.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label className={lbl}>性別（2）</label>
        <select className={sel} value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">すべて</option>
          <option value="男子">男子</option>
          <option value="女子">女子</option>
        </select>
      </div>
    </div>
  )

  // ── Filter panel ─────────────────────────────────────────────
  const filterPanel = (
    <div className="flex flex-col gap-3.5 p-4">
      <div>
        <label className={lbl}>大会回数（{meets.length}）</label>
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
        <label className={lbl}>
          チーム（{filteredTeamGroups.reduce((count, group) => count + group.teams.length, 0)}）
        </label>
        <select
          className={sel}
          value={teamKey}
          onChange={(e) => { setTeamKey(e.target.value); setAthleteId(null) }}
        >
          {activeTab !== 'team' && <option value="">すべて</option>}
          {(() => {
            let counter = 0
            return filteredTeamGroups.map(({ pref, teams }) => (
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

      {activeTab !== 'team' && (
        <div>
          <label className={lbl}>選手名（{uniqueAthletes.length}）</label>
          {!teamKey ? (
            <select className={sel} disabled>
              <option>チームを選択してください</option>
            </select>
          ) : (
            <select
              className={sel}
              style={{ background: '#333b47' }}
              value={athleteId ?? ''}
              onChange={(e) => handleAthleteFilterChange(e.target.value)}
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
                    {list.map((a) => {
                      const sequence = uniqueAthletes.findIndex((athlete) => athlete.id === a.id) + 1
                      return (
                      <option key={a.id} value={a.id} style={{ color: 'white' }}>
                        {String(sequence).padStart(3, '0')} {a.name}{(a as AthleteOption).age_name ? ` (${(a as AthleteOption).age_name})` : ''}
                      </option>
                      )
                    })}
                  </optgroup>
                )
              })}
            </select>
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <>
          <div>
            <label className={lbl}>競技名（{filteredEvents.length}）</label>
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
        </>
      )}

      <button
        onClick={handleClear}
        className="mt-0.5 w-full rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-1.5 transition-colors"
      >
        クリア
      </button>

      {activeTab === 'results' && (
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
      )}
    </div>
  )

  // ── Tournament title ─────────────────────────────────────────
  const displayMeet = activeTab === 'age-rank' ? ageRankCurrentMeet : currentMeet
  const tournamentTitle = displayMeet && (
    <div className="px-4 pt-3 pb-2.5 border-b border-slate-700/60 shrink-0">
      <h2 className="text-sm font-bold bg-gradient-to-r from-sky-300 via-cyan-200 to-blue-300 bg-clip-text text-transparent">
        {displayMeet.name ?? `第${displayMeet.round}回セントラルスポーツマスターズフェスティバル水泳競技会`}
      </h2>
      <div className="flex flex-wrap gap-3 mt-0.5">
        {displayMeet.date && (
          <span className="text-xs text-slate-400">{formatDate(displayMeet.date)}</span>
        )}
        {displayMeet.venue && (
          <span className="text-xs text-slate-400">{displayMeet.venue}</span>
        )}
        <span className="text-xs text-sky-600/70">{displayMeet.pool_type}</span>
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
              {vis('meet_record') && <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">大会新</th>}
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
                    {r.points != null ? formatPoints(Number(r.points)) : <span className="text-slate-600">－</span>}
                  </td>
                )}
                {vis('meet_record') && (
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-300 whitespace-nowrap">
                    {r.meet_record_seconds != null ? formatSplitTime(Number(r.meet_record_seconds)) : <span className="text-slate-600">－</span>}
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
    <div className={resultFilter === 'all' ? 'mt-6' : ''}>
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
              <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 align-top min-w-[280px]">メンバー</th>
              {relVis('relay_record') && <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-center align-top">新記録</th>}
              {relVis('relay_rank') && <SortTh field="rank" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort} className="text-right">順位</SortTh>}
              {relVis('relay_points') && <SortTh field="points" current={relaySortField} dir={relaySortDir} onSort={handleRelaySort} className="text-right">得点</SortTh>}
              {relVis('relay_meet_record') && <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right align-top">大会新</th>}
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
                  <td className="px-3 py-2 align-top min-w-[280px]">
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
                      {r.team_points != null ? formatPoints(Number(r.team_points)) : <span className="text-slate-600">－</span>}
                    </td>
                  )}
                  {relVis('relay_meet_record') && (
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-300 whitespace-nowrap align-top">
                      {r.meet_record_seconds != null ? formatSplitTime(Number(r.meet_record_seconds)) : <span className="text-slate-600">－</span>}
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

  const mainTabs: { id: MainTab; label: string; count?: number; disabled?: boolean }[] = [
    { id: 'results', label: '競技結果', count: results.length + relayResults.length },
    { id: 'team', label: 'チーム順位' },
    { id: 'relay-optimize', label: 'リレー最適化', disabled: !meetId || !selectedTeam },
    { id: 'athlete', label: '選手詳細', disabled: !athleteForHistory },
    { id: 'age-rank', label: '年代別順位' },
    { id: 'meet-records', label: '大会新一覧' },
    { id: 'disqualification', label: '失格ルール' },
  ]

  const athleteAnalysis = useMemo(() => {
    const history = athleteHistory ?? []
    const trendMap = new Map<string, AthleteTrend>()
    let individualCount = 0
    let relayCount = 0
    let totalPoints = 0
    let podiums = 0
    let records = 0

    for (const meet of [...history].sort((a, b) => a.round - b.round)) {
      individualCount += meet.individual.length
      relayCount += meet.relay.length
      for (const result of meet.individual) {
        totalPoints += result.points ?? 0
        if (result.rank != null && result.rank <= 3) podiums += 1
        if (result.is_meet_record) records += 1
        const seconds = Number(result.time_seconds)
        if (!Number.isFinite(seconds) || seconds <= 0 || !result.time_display) continue
        const key = `${result.event}|${meet.pool_type}`
        const trend = trendMap.get(key) ?? {
          key,
          event: result.event,
          poolType: meet.pool_type,
          points: [],
        }
        trend.points.push({
          round: meet.round,
          seconds,
          time: result.time_display,
          rank: result.rank,
          meetRecordSeconds: Number.isFinite(Number(result.meet_record_seconds))
            ? Number(result.meet_record_seconds)
            : null,
        })
        trendMap.set(key, trend)
      }
      for (const result of meet.relay) {
        totalPoints += (result.team_points ?? 0) / 4
        if (result.rank != null && result.rank <= 3) podiums += 1
        if (result.is_meet_record) records += 1
      }
    }

    const trends = [...trendMap.values()].sort(
      (a, b) => b.points.length - a.points.length || a.event.localeCompare(b.event, 'ja'),
    )
    const insights: { title: string; detail: string; tone: 'cyan' | 'emerald' | 'amber' }[] = []
    const improvementCandidates = trends
      .filter((trend) => trend.points.length > 1)
      .map((trend) => {
        const first = trend.points[0]
        const latest = trend.points[trend.points.length - 1]
        return { trend, improvement: first.seconds - latest.seconds }
      })
      .sort((a, b) => b.improvement - a.improvement)
    const bestImprovement = improvementCandidates[0]
    if (bestImprovement?.improvement > 0) {
      insights.push({
        title: `${bestImprovement.trend.event}が成長している競技`,
        detail: `初回から最新記録まで${bestImprovement.improvement.toFixed(2)}秒短縮しています。`,
        tone: 'emerald',
      })
    }

    const recordCandidates = trends.flatMap((trend) =>
      trend.points
        .filter((point) => point.meetRecordSeconds != null && point.meetRecordSeconds > 0)
        .map((point) => ({
          event: trend.event,
          gap: point.seconds - (point.meetRecordSeconds as number),
        })),
    ).filter((item) => item.gap > 0).sort((a, b) => a.gap - b.gap)
    if (recordCandidates[0]) {
      insights.push({
        title: `大会新に最も近いのは${recordCandidates[0].event}`,
        detail: `これまでの最短差はあと${recordCandidates[0].gap.toFixed(2)}秒です。`,
        tone: recordCandidates[0].gap <= 1 ? 'amber' : 'cyan',
      })
    }

    const stableCandidate = trends
      .filter((trend) => trend.points.length >= 3)
      .map((trend) => ({
        trend,
        range: Math.max(...trend.points.map((point) => point.seconds)) -
          Math.min(...trend.points.map((point) => point.seconds)),
      }))
      .sort((a, b) => a.range - b.range)[0]
    if (stableCandidate) {
      insights.push({
        title: `${stableCandidate.trend.event}は記録が安定`,
        detail: `${stableCandidate.trend.points.length}レースのタイム幅は${stableCandidate.range.toFixed(2)}秒です。`,
        tone: 'cyan',
      })
    }

    return {
      individualCount,
      relayCount,
      totalPoints,
      podiums,
      records,
      meetCount: history.length,
      trends,
      insights,
    }
  }, [athleteHistory])
  const selectedAthleteProfile = athleteForHistory
    ? getAthleteProfile(athleteForHistory.id, athleteForHistory.teamName)
    : null

  const tabBar = (
    <div className="shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700/60 flex items-stretch">
      {/* Tabs — horizontally scrollable */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex min-w-max px-3" role="tablist" aria-label="表示内容">
          {mainTabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={tab.disabled}
                onClick={() => handleTabChange(tab.id)}
                className={`relative px-3.5 py-3 text-xs font-semibold transition-colors ${
                  active
                    ? 'text-sky-300'
                    : tab.disabled
                      ? 'text-slate-700 cursor-not-allowed'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`ml-1.5 text-[10px] ${active ? 'text-sky-500' : 'text-slate-600'}`}>
                    {tab.count}
                  </span>
                )}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-sky-400" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  const athleteDetailPanel = (
    <div className="max-w-5xl mx-auto">
      {!athleteForHistory ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-4xl mb-3">🏊</span>
          <p className="text-sm font-medium text-slate-300">成績一覧から選手名を選択してください</p>
          <p className="text-xs text-slate-600 mt-1">右サイドの簡易表示と選手詳細が同時に準備されます</p>
        </div>
      ) : historyLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
          <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          選手データを読込中…
        </div>
      ) : (
        <div>
          <div className="rounded-xl border border-sky-900/50 bg-gradient-to-r from-sky-950/70 to-indigo-950/50 p-5 mb-5">
            <div className="flex items-center gap-4">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-sky-700/50 bg-slate-900/70 text-4xl shadow-lg shadow-sky-950/50">
                {selectedAthleteProfile ? (
                  <Image
                    src={selectedAthleteProfile.image}
                    alt={`${athleteForHistory.name}の動物プロフィール`}
                    fill
                    sizes="64px"
                    className="object-cover motion-safe:animate-profile-float"
                    priority
                  />
                ) : (
                  animalAvatar(athleteForHistory.name, athleteForHistory.teamName)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white">{athleteForHistory.name}</h2>
                  <span className={`text-xs font-medium ${athleteForHistory.gender === '男子' ? 'text-sky-400' : 'text-rose-400'}`}>
                    {genderDisplay(athleteForHistory.gender)}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1">{teamDisplayName(athleteForHistory.teamName)}</p>
                {selectedAthleteProfile && (
                  <p className="mt-1.5 text-xs text-cyan-500/80">
                    {selectedAthleteProfile.animal}タイプ
                    <span className="mx-1.5 text-slate-600">·</span>
                    {selectedAthleteProfile.catchphrase}
                  </p>
                )}
              </div>
            </div>
          </div>

          {!athleteHistory || athleteHistory.length === 0 ? (
            <p className="text-center py-12 text-slate-500 text-sm">記録が見つかりません</p>
          ) : (
            <div>
              <div className="mb-6 flex rounded-xl border border-slate-700 bg-slate-900/70 p-1" role="tablist" aria-label="選手詳細の表示">
                {([
                  ['overview', '概要'],
                  ['trends', '推移'],
                  ['records', '記録'],
                  ['age-rank-indiv', '年代順位'],
                ] as [AthleteDetailView, string][]).map(([id, label]) => {
                  const active = athleteDetailView === id
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => handleAthleteViewChange(id)}
                      className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-sky-500/20 text-sky-300 shadow-sm'
                          : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {athleteDetailView === 'overview' && (
                <>
              <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ['出場大会', `${athleteAnalysis.meetCount}回`],
                  ['個人レース', `${athleteAnalysis.individualCount}本`],
                  ['リレー', `${athleteAnalysis.relayCount}本`],
                  ['表彰台', `${athleteAnalysis.podiums}回`],
                  ['大会新', `${athleteAnalysis.records}回`],
                  ['獲得得点', `${formatPoints(athleteAnalysis.totalPoints)}pt`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-3 text-center">
                    <div className="text-base font-bold text-white">{value}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{label}</div>
                  </div>
                ))}
              </div>

              {athleteAnalysis.insights.length > 0 && (
                <div className="mb-6">
                  <div className="mb-3">
                    <h3 className="text-sm font-bold text-white">記録から見える傾向</h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">登録済みレース結果をもとに自動集計しています</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    {athleteAnalysis.insights.map((insight) => {
                      const colors = insight.tone === 'emerald'
                        ? 'border-emerald-700/40 bg-emerald-950/25 text-emerald-300'
                        : insight.tone === 'amber'
                          ? 'border-amber-700/40 bg-amber-950/25 text-amber-300'
                          : 'border-cyan-800/40 bg-cyan-950/25 text-cyan-300'
                      return (
                        <div key={insight.title} className={`rounded-xl border p-4 ${colors}`}>
                          <div className="text-xs font-bold">{insight.title}</div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{insight.detail}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
                </>
              )}

              {athleteDetailView === 'trends' && (
                <div>
              <div className="mb-3">
                <h3 className="text-sm font-bold text-white">競技名別タイム推移</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">グラフ上側ほど速いタイムです。黄色は自己ベストを示します。</p>
              </div>
              {athleteAnalysis.trends.length === 0 ? (
                <p className="rounded-xl border border-slate-700 py-10 text-center text-sm text-slate-500">
                  タイム推移を表示できる個人記録がありません
                </p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {athleteAnalysis.trends.map((trend) => (
                    <AthleteTrendCard key={trend.key} trend={trend} />
                  ))}
                </div>
              )}
                </div>
              )}

              {athleteDetailView === 'records' && (
                <div className="space-y-5">
                  {athleteHistory.map((meet) => (
                    <section key={meet.round} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50">
                      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/60 px-4 py-3">
                        <h3 className="text-sm font-bold text-sky-300">第{meet.round}回（{meet.pool_type}）</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-sky-700">個人行クリック → 年代別順位</span>
                          <span className="text-xs text-slate-500">
                            {meet.individual.length + meet.relay.length}レース
                          </span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium">区分</th>
                              <th className="px-3 py-2 text-left font-medium">競技名</th>
                              <th className="px-3 py-2 text-left font-medium">年齢区分</th>
                              <th className="px-3 py-2 text-right font-medium">タイム</th>
                              <th className="px-3 py-2 text-right font-medium">順位</th>
                              <th className="px-4 py-2 text-right font-medium">得点</th>
                              <th className="px-2 py-2 w-6" />
                            </tr>
                          </thead>
                          <tbody>
                            {meet.individual.map((result, index) => (
                              <tr
                                key={`individual-${index}`}
                                className="group border-t border-slate-800 cursor-pointer hover:bg-sky-950/40 transition-colors"
                                onClick={() => handleJumpToAgeRank(meet.round, result.event, result.age_group)}
                                title="年代別順位タブで同条件を表示"
                              >
                                <td className="px-4 py-2 text-sky-400">個人</td>
                                <td className="px-3 py-2 text-slate-200">{result.event}</td>
                                <td className="px-3 py-2 text-slate-400">{result.age_group}</td>
                                <td className="px-3 py-2 text-right font-mono text-white">
                                  {result.time_display ?? '－'}
                                  {result.is_meet_record && <span className="ml-1 text-amber-400">★</span>}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-300">{result.rank != null ? `${result.rank}位` : '－'}</td>
                                <td className="px-4 py-2 text-right text-amber-400">{result.points != null ? `${formatPoints(result.points)}pt` : '－'}</td>
                                <td className="px-2 py-2 text-right">
                                  <span className="opacity-0 group-hover:opacity-100 transition-opacity text-sky-500 text-[10px] font-bold">→</span>
                                </td>
                              </tr>
                            ))}
                            {meet.relay.map((result, index) => (
                              <tr key={`relay-${index}`} className="border-t border-slate-800">
                                <td className="px-4 py-2 text-indigo-400">リレー</td>
                                <td className="px-3 py-2 text-slate-200">{result.event}</td>
                                <td className="px-3 py-2 text-slate-400">{result.age_group ?? '－'}</td>
                                <td className="px-3 py-2 text-right font-mono text-white">{result.time_display ?? '－'}</td>
                                <td className="px-3 py-2 text-right text-slate-300">{result.rank != null ? `${result.rank}位` : '－'}</td>
                                <td className="px-4 py-2 text-right text-amber-400">{result.team_points != null ? `${formatPoints(result.team_points)}pt` : '－'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              )}

              {athleteDetailView === 'age-rank-indiv' && (() => {
                const allIndResults = athleteHistory
                  .flatMap((meet) =>
                    meet.individual.map((r) => ({ ...r, round: meet.round, poolType: meet.pool_type }))
                  )
                  .sort((a, b) => {
                    const ra = a.rank ?? 9999
                    const rb = b.rank ?? 9999
                    if (ra !== rb) return ra - rb
                    return b.round - a.round
                  })
                if (allIndResults.length === 0) {
                  return (
                    <p className="rounded-xl border border-slate-700 py-10 text-center text-sm text-slate-500">
                      個人記録がありません
                    </p>
                  )
                }
                return (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[11px] text-slate-500">全大会の個人レース一覧・年代内順位の高い順に表示</p>
                      <p className="text-[10px] text-sky-600">行クリック → 年代別順位タブへ移動</p>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-700">
                      <table className="w-full min-w-[600px] text-xs">
                        <thead>
                          <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left border-b border-sky-800/40">
                            <th className="px-3 py-2.5 font-semibold text-slate-300 w-12 text-center">順位</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300">大会</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300">競技名</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300">年齢区分</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300 text-right">タイム</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300 text-center">新記録</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300 text-right">大会新</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300 text-right">大会新差</th>
                            <th className="px-3 py-2.5 font-semibold text-slate-300 text-right">得点</th>
                            <th className="px-2 py-2.5 w-5" />
                          </tr>
                        </thead>
                        <tbody>
                          {allIndResults.map((r, i) => {
                            const diff = formatDiffTime(r.meet_record_seconds, r.time_seconds)
                            const isPodium = r.rank != null && r.rank <= 3
                            return (
                              <tr
                                key={`${r.round}-${r.event}-${i}`}
                                className={`group border-t border-slate-800 cursor-pointer hover:bg-sky-900/30 transition-colors ${isPodium ? 'bg-sky-950/30' : i % 2 === 0 ? 'bg-slate-900/20' : ''}`}
                                onClick={() => handleJumpToAgeRank(r.round, r.event, r.age_group)}
                                title="年代別順位タブで同条件を表示"
                              >
                                <td className="px-3 py-2 text-center">
                                  {r.rank === 1 ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[9px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                                  ) : r.rank === 2 ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[9px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                                  ) : r.rank === 3 ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[9px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                                  ) : (
                                    <span className="text-slate-400">{r.rank ?? '－'}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">第{r.round}回</td>
                                <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{r.event}</td>
                                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{r.age_group}</td>
                                <td className="px-3 py-2 text-right font-mono text-white whitespace-nowrap">
                                  {r.time_display ?? '－'}
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {r.is_meet_record
                                    ? <span className="inline-block bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30">大会新</span>
                                    : <span className="text-slate-700">－</span>}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-slate-300 whitespace-nowrap">
                                  {r.meet_record_seconds != null ? formatSplitTime(Number(r.meet_record_seconds)) : <span className="text-slate-700">－</span>}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                                  {diff ? (
                                    <span className={diff === '大会新' ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                                      {diff === '大会新' ? '±0' : diff}
                                    </span>
                                  ) : <span className="text-slate-700">－</span>}
                                </td>
                                <td className="px-3 py-2 text-right text-amber-400 whitespace-nowrap">
                                  {r.points != null ? `${formatPoints(r.points)}pt` : <span className="text-slate-600">－</span>}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <span className="opacity-0 group-hover:opacity-100 transition-opacity text-sky-500 font-bold">→</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )

  // ── チームタブ用フォーカスチーム ───────────────────────────────
  const focusTeamDisplayName = selectedTeam?.displayName ?? 'おおたか'
  const isFocusTeam = (name: string) =>
    selectedTeam ? name === selectedTeam.name : name.includes('おおたか')
  const isOotakaFocus = !selectedTeam || selectedTeam.name.includes('おおたか')

  // ── Results area ─────────────────────────────────────────────
  const resultsArea = (
    <div className="h-full overflow-y-auto flex flex-col">
      {tournamentTitle}
      <div className="p-4 flex-1">
        {loading && activeTab === 'results' && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
            <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
            検索中…
          </div>
        )}

        {!loading && activeTab === 'results' && !selectedTeam && !athleteId && !eventKey && !gender && !ageValue && !rankFilter && !recordType && !meetId && (
          <div className="flex flex-col items-center justify-center py-20 select-none">
            <span className="text-5xl mb-4">⚠️</span>
            <p className="text-white font-medium text-base">検索結果が多すぎるのでもっと絞り込んでください</p>
          </div>
        )}

        {!loading && activeTab === 'results' && (sortedResults.length >= 500) && (
          <div className="flex flex-col items-center justify-center py-20 select-none">
            <span className="text-5xl mb-4">⚠️</span>
            <p className="text-white font-medium text-base">検索結果数が多すぎて表示できません。もっと絞り込んでください</p>
          </div>
        )}

        {!loading &&
          activeTab !== 'team' &&
          activeTab !== 'athlete' &&
          activeTab !== 'age-rank' &&
          activeTab !== 'meet-records' &&
          activeTab !== 'disqualification' &&
          results.length === 0 &&
          relayResults.length === 0 &&
          (selectedTeam || athleteId || eventKey || gender || ageValue || rankFilter || recordType || meetId) && (
            <p className="text-center py-12 text-slate-500 text-sm">検索結果が0件です</p>
          )}

        {activeTab === 'results' && !loading && (
          <>
            <div className="flex gap-1.5 mb-4">
              {(['all', 'individual', 'relay'] as ResultFilter[]).map((f) => {
                const labels: Record<ResultFilter, string> = { all: 'すべて', individual: '個人競技', relay: 'リレー' }
                const counts: Record<ResultFilter, number> = {
                  all: results.length + relayResults.length,
                  individual: results.length,
                  relay: relayResults.length,
                }
                const active = resultFilter === f
                return (
                  <button
                    key={f}
                    onClick={() => handleResultFilterChange(f)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600/60 hover:text-slate-200'
                    }`}
                  >
                    {labels[f]}
                    <span className={`ml-1.5 text-[10px] ${active ? 'text-sky-200' : 'text-slate-600'}`}>
                      {counts[f]}
                    </span>
                  </button>
                )
              })}
            </div>
            {resultFilter === 'all' && (individualTable || relayTable) && (
              <div>{individualTable}{relayTable}</div>
            )}
            {resultFilter === 'individual' && (
              individualTable || <p className="text-center py-12 text-slate-500 text-sm">個人競技の結果がありません</p>
            )}
            {resultFilter === 'relay' && (
              relayTable || <p className="text-center py-12 text-slate-500 text-sm">リレーの結果がありません</p>
            )}
          </>
        )}
        {activeTab === 'relay-optimize' && (
          <div className="max-w-5xl mx-auto">
            {!meetId || !selectedTeam ? (
              <p className="text-center py-16 text-slate-500 text-sm">
                大会とチームを選択してください
              </p>
            ) : (
              <RelayOptimizer
                eventId={meetId}
                teamId={selectedTeam.ids[0]}
                teamName={selectedTeam.displayName}
                meetRound={currentMeet?.round ?? 0}
              />
            )}
          </div>
        )}
        {activeTab === 'team' && (
          <div className="max-w-5xl mx-auto">
            {teamStandingsLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
                <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                チーム順位を読込中…
              </div>
            ) : teamStandings.length === 0 ? (
              <p className="text-center py-16 text-slate-500 text-sm">この大会のチーム順位が見つかりません</p>
            ) : !meetId ? (
              <AllMeetsAnalysis
                standings={teamHistoryStandings}
                onRoundSelect={(eventId) => setMeetId(eventId)}
                focusTeamName={focusTeamDisplayName}
                onTeamSelect={(name) => setTeamKey(normalizeOptionName(name))}
              />
            ) : (() => {
              const historyRows = teamHistoryStandings
                .filter((standing) => isFocusTeam(standing.mst_team.name))
                .sort((a, b) => (a.mst_event?.round ?? 0) - (b.mst_event?.round ?? 0))
              const currentStanding = teamStandings.find((standing) => isFocusTeam(standing.mst_team.name))
              const previousStanding = [...historyRows]
                .reverse()
                .find((standing) => (standing.mst_event?.round ?? 0) < (currentMeet?.round ?? 0))
              const rankChange = previousStanding?.rank && currentStanding?.rank
                ? previousStanding.rank - currentStanding.rank
                : null
              const usesCorrectedScoreDisplay = currentMeet?.round === 74 || currentMeet?.round === 76
              const currentTotal = Number(currentStanding?.total_points ?? 0)
              const scoreParts = [
                ['男子', Number(currentStanding?.male_points ?? 0), 'bg-sky-500'],
                ['女子', Number(currentStanding?.female_points ?? 0), 'bg-rose-500'],
                ['混合', Number(currentStanding?.mixed_points ?? 0), 'bg-purple-500'],
              ] as const
              const scoreMap = new Map<number, { name: string; gender: string; points: number; playerId: number }>()
              for (const r of results) {
                const rankPts = r.rank != null && r.rank >= 1 && r.rank <= 10 ? 11 - r.rank : 0
                const bonusPts = (r.is_meet_record ? 10 : 0) + (r.is_japan_record ? 10 : 0) + (r.is_world_record ? 10 : 0)
                const pts = rankPts + bonusPts
                const existing = scoreMap.get(r.player_id)
                if (existing) {
                  existing.points += pts
                } else {
                  scoreMap.set(r.player_id, { name: r.dt_player_person.name, gender: r.dt_player_person.gender, points: pts, playerId: r.player_id })
                }
              }
              // リレー得点を均等配分（4人で割る）
              for (const rr of relayResults) {
                const rankPts = rr.rank != null && rr.rank >= 1 && rr.rank <= 10 ? 11 - rr.rank : 0
                const bonusPts = rr.is_meet_record ? 10 : 0
                const totalRelayPts = rankPts + bonusPts
                if (totalRelayPts === 0) continue
                const members = rr.dt_player_relay.filter((m) => m.dt_player_person)
                if (members.length === 0) continue
                const ptsPerMember = totalRelayPts / 4
                for (const m of members) {
                  const existing = scoreMap.get(m.player_id)
                  if (existing) {
                    existing.points += ptsPerMember
                  } else {
                    scoreMap.set(m.player_id, {
                      name: m.dt_player_person!.name,
                      gender: m.dt_player_person!.gender,
                      points: ptsPerMember,
                      playerId: m.player_id,
                    })
                  }
                }
              }
              const meetPlayerScores = [...scoreMap.values()].sort((a, b) => b.points - a.points)
              const meetPlayerTotal = meetPlayerScores.reduce((sum, a) => sum + a.points, 0)
              if (!currentStanding) {
                return (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-10 text-center">
                    <p className="font-medium text-slate-200">
                      {focusTeamDisplayName} は第{currentMeet?.round ?? meetId}回に参加していません
                    </p>
                    <p className="mt-1 text-xs text-slate-300">チーム順位に登録がない大会です</p>
                  </div>
                )
              }
              return (
              <div>
                {currentStanding && currentMeet && (
                  <>
                    {/* sticky バナー */}
                    <div className="sticky top-0 z-20 mb-4 rounded-xl border border-amber-500/70 bg-gradient-to-r from-amber-950 to-yellow-950 px-3 py-2 sm:px-5 sm:py-4 shadow-lg shadow-amber-950/40">
                      <div className="flex items-center gap-2">
                        <div className="text-sm sm:text-lg font-bold text-white leading-snug">
                          <span className="text-amber-300">{focusTeamDisplayName}</span>
                          <span className="mx-1.5 sm:mx-2 text-amber-700">·</span>
                          第{currentMeet.round}回大会
                          <span className="ml-1.5 sm:ml-2 text-amber-300">{currentStanding.rank ?? '－'}位</span>
                          <span className="ml-1 sm:ml-2 text-xs sm:text-sm font-semibold text-white">/ {teamStandings.length}チーム中</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5">
                    <div>
                    <TeamProgressChart standings={historyRows} overlayTeams={overlayTeamStandings} selectedRound={currentMeet.round} onRoundSelect={(id) => setMeetId(id)} teamName={focusTeamDisplayName} />
                    {rankChange != null && (
                      <p className={`mt-1 text-right text-[11px] font-semibold ${rankChange > 0 ? 'text-emerald-400' : rankChange < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                        {rankChange > 0
                          ? `↑ 前回から ${rankChange}ランクアップ`
                          : rankChange < 0
                            ? `↓ 前回から ${Math.abs(rankChange)}ランクダウン`
                            : '→ 前回と同順位'}
                      </p>
                    )}
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-sky-950/80 to-indigo-950/80 hover:from-sky-900/80 hover:to-indigo-900/80 transition-colors"
                        onClick={() => setScoreBreakdownOpen((v) => !v)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
                          <h3 className="text-sm font-bold text-sky-100">{focusTeamDisplayName}　第{currentMeet.round}回 得点構成</h3>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-sm font-bold text-amber-300">{formatPoints(currentTotal)}pt</span>
                          <span className="text-slate-400 text-xs">{scoreBreakdownOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>
                      {scoreBreakdownOpen && (
                        <div className="px-4 py-3 space-y-3">
                          {scoreParts.map(([label, points, color]) => (
                            <div key={label} className="grid grid-cols-[36px_1fr_70px] items-center gap-3 text-xs">
                              <span className="text-slate-200">{label}</span>
                              <div className="h-2.5 overflow-hidden rounded-full bg-slate-700">
                                <div
                                  className={`h-full rounded-full ${color}`}
                                  style={{ width: `${currentTotal > 0 ? (points / currentTotal) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-right font-mono text-slate-300">{formatPoints(points)}pt</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  </>
                )}

                <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start">
                  <div className="flex-1 min-w-0">
                    <button
                      className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-sky-950/80 to-indigo-950/80 px-4 py-3 text-left hover:from-sky-900/80 hover:to-indigo-900/80 transition-colors md:cursor-default"
                      onClick={() => setTeamTableOpen((v) => !v)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
                        <h3 className="text-sm font-bold text-sky-100">
                          第{currentMeet?.round}回 全チーム順位
                        </h3>
                      </div>
                      <span className="text-xs text-slate-400 md:hidden">
                        {teamTableOpen ? '▲' : '▼'}
                      </span>
                    </button>
                    <div className={`${teamTableOpen ? '' : 'hidden'} md:block`}>
                    {usesCorrectedScoreDisplay && (
                      <div className="mb-3 rounded-xl border border-yellow-500/60 bg-yellow-950/40 px-4 py-3 text-xs leading-relaxed text-yellow-100">
                        <p className="font-bold text-yellow-300">第{currentMeet?.round}回のPDF公式得点について</p>
                        <p className="mt-1">
                          PDF記載値は順位点が二重加算されている可能性が高いため、この表では競技結果から規定どおり再計算した得点を主表示しています。
                          元のPDF記載値は比較用として隣の列に残しています。順位と男女・混合別得点はPDF記載のままです。
                        </p>
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-slate-700">
                    <table className="w-full min-w-[280px] sm:min-w-[590px] text-sm">
                      <thead>
                        <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-slate-300 border-b border-sky-800/40">
                          <th className="px-2 py-3 text-center text-xs font-semibold w-8">比較</th>
                          <th className="px-3 py-3 text-center text-xs font-semibold w-14">順位</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold">チーム名</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold">
                            {usesCorrectedScoreDisplay ? '補正得点' : '総合'}
                          </th>
                          <th className="hidden sm:table-cell px-3 py-3 text-right text-xs font-semibold">
                            {usesCorrectedScoreDisplay ? 'PDF記載' : '自主計算'}
                          </th>
                          <th className="hidden sm:table-cell px-3 py-3 text-right text-xs font-semibold">
                            {usesCorrectedScoreDisplay ? '男子(PDF)' : '男子'}
                          </th>
                          <th className="hidden sm:table-cell px-3 py-3 text-right text-xs font-semibold">
                            {usesCorrectedScoreDisplay ? '女子(PDF)' : '女子'}
                          </th>
                          <th className="hidden sm:table-cell px-3 py-3 text-right text-xs font-semibold">
                            {usesCorrectedScoreDisplay ? '混合(PDF)' : '混合'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamStandings.map((standing, index) => {
                          const isFocus = isFocusTeam(standing.mst_team.name)
                          const officialPoints = Number(standing.total_points ?? 0)
                          const calculatedPoints = standing.calculated_points == null
                            ? null
                            : Number(standing.calculated_points)
                          const pointDifference = calculatedPoints == null
                            ? null
                            : calculatedPoints - officialPoints
                          return (
                            <tr
                              key={`${standing.mst_team.name}-${index}`}
                              className={`border-t border-slate-700/50 transition-colors cursor-pointer ${
                                isFocus
                                  ? 'bg-cyan-950/70 ring-1 ring-inset ring-cyan-600/50'
                                  : index % 2 === 0
                                    ? 'bg-slate-800/70 hover:bg-slate-700/70'
                                    : 'bg-slate-900/70 hover:bg-slate-800/70'
                              }`}
                              onClick={() => { setTeamKey(normalizeOptionName(standing.mst_team.name)); setAthleteId(null) }}
                            >
                              <td className="px-2 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                {!isFocus && (
                                  <input
                                    type="checkbox"
                                    checked={checkedTeamNames.has(standing.mst_team.name)}
                                    onChange={(e) => {
                                      const next = new Set(checkedTeamNames)
                                      if (e.target.checked) next.add(standing.mst_team.name)
                                      else next.delete(standing.mst_team.name)
                                      setCheckedTeamNames(next)
                                    }}
                                    className="h-3.5 w-3.5 accent-sky-400 cursor-pointer"
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center font-semibold">
                                {standing.rank === 1 ? '🥇' : standing.rank === 2 ? '🥈' : standing.rank === 3 ? '🥉' : standing.rank ?? '－'}
                              </td>
                              <td className={`px-3 py-2.5 font-medium ${isFocus ? 'text-cyan-300' : 'text-slate-100'}`}>
                                {teamDisplayName(standing.mst_team.name)}
                                {isFocus && <span className="ml-2 text-[10px] text-cyan-500">{focusTeamDisplayName}</span>}
                              </td>
                              {usesCorrectedScoreDisplay ? (
                                <>
                                  <td className="px-3 py-2.5 text-right font-semibold text-amber-300">
                                    {calculatedPoints == null ? '－' : formatPoints(calculatedPoints)}
                                  </td>
                                  <td className="hidden sm:table-cell px-3 py-2.5 text-right font-mono text-slate-400">
                                    {standing.total_points != null ? formatPoints(officialPoints) : '－'}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-3 py-2.5 text-right font-semibold text-sky-400">
                                    {standing.total_points != null ? formatPoints(officialPoints) : '－'}
                                  </td>
                                  <td className="hidden sm:table-cell px-3 py-2.5 text-right whitespace-nowrap font-mono">
                                    {calculatedPoints == null || pointDifference == null ? (
                                      <span className="text-slate-500">－</span>
                                    ) : (
                                      <>
                                        <span className="text-slate-100">{formatPoints(calculatedPoints)}</span>
                                        <span className={`ml-1 ${Math.abs(pointDifference) >= 0.005 ? 'font-bold text-yellow-300' : 'text-slate-500'}`}>
                                          （{formatPointDifference(pointDifference)}）
                                        </span>
                                      </>
                                    )}
                                  </td>
                                </>
                              )}
                              <td className="hidden sm:table-cell px-3 py-2.5 text-right text-slate-200">
                                {standing.male_points != null ? formatPoints(Number(standing.male_points)) : '－'}
                              </td>
                              <td className="hidden sm:table-cell px-3 py-2.5 text-right text-slate-200">
                                {standing.female_points != null ? formatPoints(Number(standing.female_points)) : '－'}
                              </td>
                              <td className="hidden sm:table-cell px-3 py-2.5 text-right text-slate-200">
                                {standing.mixed_points != null ? formatPoints(Number(standing.mixed_points)) : '－'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                    </div>
                  </div>

                  {meetPlayerScores.length > 0 && (
                    <div className="w-full md:w-72 md:shrink-0">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
                        <h3 className="text-sm font-bold text-white">{focusTeamDisplayName} 取得得点</h3>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                        <div className="mb-3 flex items-end justify-between gap-3">
                          <p className="text-[10px] text-slate-300">第{currentMeet?.round}回 個人+リレー（均等配分）</p>
                          <span className="text-[10px] text-slate-300">{meetPlayerScores.length}名が参加</span>
                        </div>
                        <div className="space-y-2.5">
                          {meetPlayerScores.map((athlete, index) => {
                            const maxPts = meetPlayerScores[0]?.points ?? 1
                            return (
                              <div
                                key={athlete.playerId}
                                className="grid grid-cols-[20px_minmax(80px,1fr)_1fr_50px] items-center gap-2 text-xs cursor-pointer hover:bg-slate-700/50 rounded px-1 -mx-1 py-0.5"
                                onClick={() => { fetchAthleteHistory(athlete.playerId, athlete.name, athlete.gender, selectedTeam?.name ?? ''); setMobileDrawerOpen(true) }}
                              >
                                <span className={`text-center font-bold ${index < 3 ? 'text-amber-400' : 'text-slate-400'}`}>
                                  {index + 1}
                                </span>
                                <span className={`truncate ${athlete.gender === '男子' ? 'text-sky-300' : 'text-rose-300'}`}>
                                  {athlete.name}
                                </span>
                                <div className="h-2.5 overflow-hidden rounded-full bg-slate-700">
                                  <div
                                    className={athlete.gender === '男子' ? 'h-full rounded-full bg-sky-500' : 'h-full rounded-full bg-rose-500'}
                                    style={{ width: `${maxPts > 0 ? (athlete.points / maxPts) * 100 : 0}%` }}
                                  />
                                </div>
                                <span className="text-right font-mono text-slate-200">{formatPoints(athlete.points)}pt</span>
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-slate-600 grid grid-cols-[20px_minmax(80px,1fr)_1fr_50px] items-center gap-2 text-xs">
                          <span />
                          <span className="text-slate-300 font-semibold">合計</span>
                          <span />
                          <span className="text-right font-mono font-bold text-amber-300">
                            {formatPoints(meetPlayerTotal)}pt
                          </span>
                        </div>
                        <p className="mt-1.5 text-[10px] text-slate-500 leading-tight">
                          ※DB集計値。公式合計（{formatPoints(Number(currentStanding.total_points))}pt）と差が生じる場合があります
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )
            })()}
          </div>
        )}
        {activeTab === 'meet-records' && (
          <div className="max-w-5xl mx-auto">
            {/* キラキラタイトル */}
            <div className="mb-5 text-center">
              <div className="inline-flex items-center gap-3">
                <span className="text-amber-400 text-base animate-pulse select-none">✦✦</span>
                <h2 className="text-2xl font-black bg-gradient-to-r from-amber-400 via-yellow-100 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_16px_rgba(251,191,36,0.5)]">
                  大会新一覧
                </h2>
                <span className="text-amber-400 text-base animate-pulse select-none">✦✦</span>
              </div>
              <div className="flex items-center justify-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs font-semibold text-sky-400 bg-sky-950/60 border border-sky-800/50 rounded px-2 py-0.5">{mrCourse}</span>
                {mrEvent && <span className="text-xs text-slate-300 bg-slate-800/60 rounded px-2 py-0.5">{mrEvent}</span>}
                {mrGender && <span className={`text-xs font-bold rounded px-2 py-0.5 ${mrGender === '男' ? 'text-sky-300 bg-sky-950/60 border border-sky-800/50' : mrGender === '女' ? 'text-rose-300 bg-rose-950/60 border border-rose-800/50' : 'text-purple-300 bg-purple-950/60 border border-purple-800/50'}`}>{mrGender}</span>}
                {mrAgeGroup && <span className="text-xs text-slate-300 bg-slate-800/60 rounded px-2 py-0.5">{ageGroupLabel(Number(mrAgeGroup))}</span>}
                <span className="text-xs text-slate-500">{mrFiltered.length}件</span>
              </div>
            </div>

            {/* ハイライトバナー */}
            {(mrHighlightTeam || mrHighlightName) && (
              <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">HIGHLIGHT</span>
                {mrHighlightTeam && <span className="text-[11px] text-amber-300 font-semibold">{mrHighlightTeam}</span>}
                {mrHighlightName && (
                  <>
                    {mrHighlightTeam && <span className="text-[10px] text-amber-600">›</span>}
                    <span className="text-[11px] text-amber-200 font-bold">{mrHighlightName}</span>
                  </>
                )}
                <span className="text-[10px] text-amber-500">の行を強調表示</span>
                <button
                  type="button"
                  onClick={() => { setMrHighlightTeam(''); setMrHighlightName('') }}
                  className="ml-auto text-[10px] text-amber-600 hover:text-amber-400"
                >
                  ✕ 解除
                </button>
              </div>
            )}

            {mrLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                読込中…
              </div>
            ) : mrRecords.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                {mrCourse}の大会新記録が登録されていません
              </p>
            ) : mrFiltered.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">条件に一致する記録がありません</p>
            ) : (
              <div className={`flex gap-5 items-start ${mrHighlightName && mrAthleteRecords.length > 0 ? 'flex-col lg:flex-row' : ''}`}>
                {/* 競技別テーブル */}
                <div className={mrHighlightName && mrAthleteRecords.length > 0 ? 'flex-1 min-w-0 w-full' : 'w-full'}>
                  {Array.from(mrGroupedByEvent.entries()).map(([eventKey, evRecords]) => {
                    const sorted = [...evRecords].sort((a, b) => {
                      const gOrder: Record<string, number> = { 女: 0, 男: 1, 混合: 2 }
                      const gDiff = (gOrder[a.gender] ?? 3) - (gOrder[b.gender] ?? 3)
                      return gDiff !== 0 ? gDiff : a.age_group - b.age_group
                    })
                    return (
                      <div key={eventKey} className="mb-7">
                        {/* 競技名ヘッダー */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-sky-800/50 to-transparent" />
                          <span className="px-3 py-1 rounded-full bg-sky-950/80 border border-sky-700/60 text-sm font-bold text-sky-300 whitespace-nowrap">
                            {eventKey}
                          </span>
                          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-sky-800/50 to-transparent" />
                        </div>
                        {/* テーブル */}
                        <div className="overflow-x-auto rounded-xl border border-sky-900/40">
                          <table className="w-full text-sm" style={{ minWidth: '520px' }}>
                            <thead>
                              <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 border-b border-sky-800/40 text-left">
                                <th className="px-2 py-2 font-semibold text-xs text-slate-500 text-center w-7">#</th>
                                <th className="px-3 py-2 font-semibold text-xs text-slate-300 whitespace-nowrap">年齢区分</th>
                                <th className="px-3 py-2 font-semibold text-xs text-slate-300 text-center w-8">性別</th>
                                <th className="px-3 py-2 font-semibold text-xs text-slate-300">選手名</th>
                                <th className="px-3 py-2 font-semibold text-xs text-slate-300">チーム</th>
                                <th className="px-3 py-2 font-semibold text-xs text-amber-400 text-right whitespace-nowrap">大会新</th>
                                <th className="px-3 py-2 font-semibold text-xs text-slate-300 text-right whitespace-nowrap">樹立日</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((r, i) => {
                                const isTeamHit = !!mrHighlightTeam && (
                                  r.team_name === mrHighlightTeam ||
                                  (!r.team_name && r.name_team_raw.includes(mrHighlightTeam))
                                )
                                const isNameHit = !!mrHighlightName && r.athlete_name === mrHighlightName
                                const isHighlighted = isTeamHit || isNameHit
                                return (
                                  <tr
                                    key={r.id}
                                    className={`border-t border-slate-700/40 transition-colors ${
                                      isHighlighted
                                        ? 'bg-amber-950/50 ring-1 ring-inset ring-amber-500/60'
                                        : i % 2 === 0
                                          ? 'bg-sky-950/40'
                                          : 'bg-slate-900/40'
                                    }`}
                                  >
                                    <td className="px-2 py-2 text-center text-xs text-slate-600 tabular-nums">
                                      {i + 1}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">
                                      {ageGroupLabel(r.age_group)}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <span className={`text-xs font-bold ${r.gender === '男' ? 'text-sky-400' : r.gender === '女' ? 'text-rose-400' : 'text-purple-400'}`}>
                                        {r.gender}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">
                                      {r.is_relay ? (
                                        <span className="text-xs text-slate-300">{r.name_team_raw}</span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setMrHighlightName(mrHighlightName === r.athlete_name ? '' : (r.athlete_name ?? ''))}
                                          className={`text-sm text-left transition-colors hover:underline ${
                                            isNameHit ? 'text-amber-200 font-bold' : 'text-sky-300 hover:text-sky-200'
                                          }`}
                                        >
                                          {r.athlete_name}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-400">
                                      {r.is_relay ? '' : r.team_name}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-300 whitespace-nowrap">
                                      {r.record}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-400 whitespace-nowrap">
                                      {r.established_date ?? '－'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 選手記録パネル（右エリア） */}
                {mrHighlightName && mrAthleteRecords.length > 0 && (
                  <div className="lg:w-72 w-full shrink-0 rounded-xl border border-amber-700/50 bg-amber-950/20 overflow-hidden lg:sticky lg:top-4">
                    <div className="bg-gradient-to-r from-amber-950/80 to-slate-900/80 border-b border-amber-800/40 px-4 py-2.5 flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">ALL RECORDS</div>
                        <div className="text-sm font-bold text-amber-200">{mrHighlightName}</div>
                        <div className="text-[11px] text-amber-600 mt-0.5">{mrAthleteRecords.length}種目</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMrHighlightName('')}
                        className="text-amber-600 hover:text-amber-400 text-sm font-bold mt-0.5 shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="overflow-y-auto max-h-[70vh]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-900/60 border-b border-amber-900/30 text-left">
                            <th className="px-3 py-2 text-slate-400 font-semibold">競技</th>
                            <th className="px-3 py-2 text-amber-500 font-semibold text-right whitespace-nowrap">大会新</th>
                            <th className="px-3 py-2 text-slate-400 font-semibold text-right whitespace-nowrap">樹立日</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mrAthleteRecords.map((r, i) => (
                            <tr key={r.id} className={`border-t border-amber-900/20 ${i % 2 === 0 ? 'bg-amber-950/20' : ''}`}>
                              <td className="px-3 py-2 text-slate-300 leading-tight">
                                <div className="font-medium">{r.event}</div>
                                <div className="text-slate-500">{r.distance} · {ageGroupLabel(r.age_group)}</div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-amber-300 whitespace-nowrap">
                                {r.record}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">
                                {r.established_date ?? '－'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'disqualification' && (
          <div className="max-w-5xl mx-auto">
            <div className="mb-5 flex gap-1.5 border-b border-slate-700">
              {([
                ['rules', 'ルール一覧', disqualificationRules.length],
                ['offenders', '失格者一覧', disqualifiedEntries.length],
              ] as const).map(([view, label, count]) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setDisqualificationView(view)}
                  className={`relative px-4 py-3 text-sm font-bold transition-colors ${
                    disqualificationView === view
                      ? 'text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                  <span className="ml-1.5 text-[10px] text-slate-500">{count}</span>
                  {disqualificationView === view && (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-sky-400" />
                  )}
                </button>
              ))}
            </div>

            {disqualificationLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                読込中…
              </div>
            ) : disqualificationView === 'rules' ? (
              disqualificationRules.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">失格ルールが登録されていません</p>
              ) : (
                <div className="space-y-5">
                  {[...new Set(disqualificationRules.map((rule) => rule.category))].map((category) => (
                    <section key={category}>
                      <h3 className="mb-2 text-sm font-bold text-sky-300">{category}</h3>
                      <div className="overflow-hidden rounded-xl border border-slate-700">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left text-xs text-slate-300">
                              <th className="w-20 px-3 py-2.5 font-semibold">コード</th>
                              <th className="px-3 py-2.5 font-semibold">失格理由</th>
                            </tr>
                          </thead>
                          <tbody>
                            {disqualificationRules
                              .filter((rule) => rule.category === category)
                              .map((rule, index) => (
                                <tr
                                  key={rule.id}
                                  className={`border-t border-slate-700/50 ${
                                    index % 2 === 0 ? 'bg-slate-800/60' : 'bg-slate-900/60'
                                  }`}
                                >
                                  <td className="px-3 py-2 font-bold text-amber-300">{rule.code}</td>
                                  <td className="px-3 py-2 leading-relaxed text-slate-200">{rule.description}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              )
            ) : disqualifiedEntries.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">条件に一致する失格者はいません</p>
            ) : (
              <div>
                <p className="mb-2 text-xs leading-relaxed text-amber-300/80">
                  現在の成績DBには失格コード専用列がないため、順位・記録が未登録の結果を表示しています。
                </p>
                <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left text-xs text-slate-300">
                      <th className="px-3 py-2.5 font-semibold">大会</th>
                      <th className="px-3 py-2.5 font-semibold">区分</th>
                      <th className="px-3 py-2.5 font-semibold">氏名／チーム</th>
                      <th className="px-3 py-2.5 font-semibold">性別</th>
                      <th className="px-3 py-2.5 font-semibold">チーム</th>
                      <th className="px-3 py-2.5 font-semibold">競技名</th>
                      <th className="px-3 py-2.5 font-semibold">年齢区分</th>
                      <th className="px-3 py-2.5 font-semibold">レーン</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disqualifiedEntries.map((entry, index) => (
                      <tr
                        key={entry.id}
                        className={`border-t border-slate-700/50 ${
                          index % 2 === 0 ? 'bg-slate-800/60' : 'bg-slate-900/60'
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-slate-300">第{entry.meet.round}回</td>
                        <td className="whitespace-nowrap px-3 py-2 text-indigo-300">{entry.type}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-white">{entry.name}</td>
                        <td className={`whitespace-nowrap px-3 py-2 ${entry.gender === '男子' ? 'text-sky-300' : entry.gender === '女子' ? 'text-rose-300' : 'text-purple-300'}`}>
                          {entry.gender}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-300">{teamDisplayName(entry.team)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-200">{entry.event}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-300">{entry.ageGroup || '－'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-400">{entry.lane || '－'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'athlete' && athleteDetailPanel}

        {activeTab === 'age-rank' && (
          <div className="max-w-5xl mx-auto">
            {ageRankLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
                <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                検索中…
              </div>
            ) : !ageRankMeetId || !ageRankEventKey || !ageRankGender ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="text-4xl mb-3">🏊</span>
                <p className="text-sm font-medium text-slate-300">左のフィルターで条件を選択してください</p>
                <p className="text-xs text-slate-600 mt-1">大会・競技名・性別を選ぶと表示されます（個人種目は年齢区分も必要）</p>
              </div>
            ) : isAgeRankRelay ? (
              ageRankRelayResults.length === 0 ? (
                <p className="text-center py-12 text-slate-500 text-sm">この条件に一致するリレー記録がありません</p>
              ) : (
                <div>
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-white">年代別順位（リレー）</span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        {[
                          { label: `第${ageRankCurrentMeet?.round}回`, color: 'text-slate-400' },
                          { label: ageRankGender, color: ageRankGender === '混合' ? 'text-purple-400' : ageRankGender === '男子' ? 'text-sky-400' : 'text-rose-400' },
                          { label: selectedAgeRankEvent?.name ?? '', color: 'text-slate-300' },
                          { label: ageRankAgeName, color: 'text-slate-300' },
                        ].filter((c) => c.label).map((chip, i) => (
                          <span key={i} className={`text-xs font-medium ${chip.color}`}>
                            {i > 0 && <span className="text-slate-600 mr-2">|</span>}
                            {chip.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{ageRankRelayResults.length}件</span>
                  </div>
                  {ageRankHighlightTeam && (
                    <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 flex items-center gap-2">
                      <span className="text-[11px] text-amber-300 font-semibold">✦ {teamDisplayName(ageRankHighlightTeam)}</span>
                      {ageRankHighlightName && (
                        <>
                          <span className="text-[10px] text-amber-600">／</span>
                          <span className="text-[11px] text-amber-200 font-semibold">{ageRankHighlightName}</span>
                        </>
                      )}
                      <span className="text-[10px] text-amber-500">の行を強調表示中</span>
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-xl border border-sky-900/40">
                    <table className="w-full text-sm" style={{ minWidth: '900px' }}>
                      <thead>
                        <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left border-b border-sky-800/40">
                          <th className="px-3 py-2.5 font-semibold text-xs w-12 text-center text-slate-300">順位</th>
                          <th className="px-3 py-2.5 font-semibold text-xs text-slate-300">チーム</th>
                          <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-center">合計年齢</th>
                          <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">タイム</th>
                          <th className="px-3 py-2.5 font-semibold text-xs text-slate-300">
                            <span className="block mb-1">メンバー</span>
                            <div className={`grid gap-x-3 ${ageRankRelayStrokeHeaders.length <= 2 ? 'grid-cols-2' : ageRankRelayStrokeHeaders.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                              {ageRankRelayStrokeHeaders.map((member) => (
                                <span key={member.swim_order} className="text-[10px] font-medium text-sky-300 whitespace-nowrap">
                                  {member.swim_order}泳　{member.stroke ?? '－'}
                                </span>
                              ))}
                            </div>
                          </th>
                          <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-center">新記録</th>
                          <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">得点</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ageRankRelayResults]
                          .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
                          .map((r, i) => {
                            const isHighlighted = !!ageRankHighlightTeam && r.mst_team.name === ageRankHighlightTeam
                            return (
                              <tr
                                key={r.id}
                                className={`border-t border-slate-700/40 transition-colors ${
                                  isHighlighted
                                    ? 'bg-amber-950/50 ring-1 ring-inset ring-amber-500/60'
                                    : i % 2 === 0
                                      ? 'bg-sky-950/40 hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_18px_rgba(251,191,36,0.12)]'
                                      : 'bg-slate-900/40 hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_18px_rgba(251,191,36,0.12)]'
                                }`}
                              >
                                <td className="px-3 py-2 text-center">
                                  {r.rank === 1 ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[9px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                                  ) : r.rank === 2 ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[9px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                                  ) : r.rank === 3 ? (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[9px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                                  ) : (
                                    <span className="text-xs text-slate-400">{r.rank ?? '－'}</span>
                                  )}
                                </td>
                                <td className={`px-3 py-2 font-medium whitespace-nowrap ${isHighlighted ? 'text-amber-200 font-bold' : 'text-slate-200'}`}>
                                  {teamDisplayName(r.mst_team.name)}
                                  {isHighlighted && <span className="ml-1.5 text-[10px] text-amber-500">✦</span>}
                                </td>
                                <td className="px-3 py-2 text-center text-slate-400 text-xs whitespace-nowrap">
                                  {r.age_group_label ?? '－'}
                                </td>
                                <td className="px-3 py-2 font-mono text-right whitespace-nowrap">
                                  <span className={isHighlighted ? 'text-amber-200 font-bold' : 'text-white'}>
                                    {r.time_display ?? '－'}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <div className={`grid gap-x-3 gap-y-1 ${r.dt_player_relay.length <= 2 ? 'grid-cols-2' : r.dt_player_relay.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                                    {r.dt_player_relay.map((member) => {
                                      const isFocusedMember = !!ageRankHighlightName && member.dt_player_person?.name === ageRankHighlightName
                                      const split = formatSplitTime(member.split_seconds)
                                      const dive = member.dive_time != null ? `(${member.dive_time.toFixed(2)})` : ''
                                      return (
                                        <div
                                          key={member.swim_order}
                                          className={`min-w-0 rounded px-1.5 py-1 ${
                                            isFocusedMember ? 'bg-amber-400/15 ring-1 ring-amber-400/50' : ''
                                          }`}
                                        >
                                          <button
                                            type="button"
                                            className={`block max-w-full truncate text-left text-xs font-medium hover:underline ${isFocusedMember ? 'text-amber-200' : member.dt_player_person?.gender === '男子' ? 'text-sky-300 hover:text-sky-100' : 'text-rose-300 hover:text-rose-100'}`}
                                            onClick={() => { handleRelayMemberClick(member); setMobileDrawerOpen(true) }}
                                            title={`${member.dt_player_person?.name ?? `ID:${member.player_id}`}の過去レース記録を表示`}
                                          >
                                            {member.dt_player_person?.name ?? `ID:${member.player_id}`}
                                          </button>
                                          <div className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                                            {split ?? '－'} {dive}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {r.is_meet_record ? (
                                    <span className="inline-block bg-amber-500/20 text-amber-300 text-xs px-1.5 py-0.5 rounded border border-amber-500/30">大会新</span>
                                  ) : <span className="text-slate-700">－</span>}
                                </td>
                                <td className="px-3 py-2 text-right text-amber-400 text-xs font-medium whitespace-nowrap">
                                  {r.team_points != null ? formatPoints(Number(r.team_points)) : <span className="text-slate-600">－</span>}
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : !ageRankAgeValue.startsWith('ind:') ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="text-4xl mb-3">🏊</span>
                <p className="text-sm font-medium text-slate-300">年齢区分を選択してください</p>
              </div>
            ) : ageRankResults.length === 0 ? (
              <p className="text-center py-12 text-slate-500 text-sm">この条件に一致する記録がありません</p>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-bold text-white">年代別順位</span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      {[
                        { label: `第${ageRankCurrentMeet?.round}回`, color: 'text-slate-400' },
                        { label: ageRankGender, color: ageRankGender === '男子' ? 'text-sky-400' : 'text-rose-400' },
                        { label: selectedAgeRankEvent?.name ?? '', color: 'text-slate-300' },
                        { label: ageRankAgeName, color: 'text-slate-300' },
                      ].filter((c) => c.label).map((chip, i) => (
                        <span key={i} className={`text-xs font-medium ${chip.color}`}>
                          {i > 0 && <span className="text-slate-600 mr-2">|</span>}
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{ageRankResults.length}件</span>
                </div>

                {(ageRankHighlightTeam || ageRankHighlightName) && (
                  <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 flex items-center gap-2 flex-wrap">
                    {ageRankHighlightTeam && (
                      <span className="text-[11px] text-amber-300 font-semibold">✦ {teamDisplayName(ageRankHighlightTeam)}</span>
                    )}
                    {ageRankHighlightTeam && ageRankHighlightName && (
                      <span className="text-[10px] text-amber-600">›</span>
                    )}
                    {ageRankHighlightName && (
                      <span className="text-[11px] text-amber-300 font-semibold">{ageRankHighlightName}</span>
                    )}
                    <span className="text-[10px] text-amber-500">の行を強調表示中</span>
                  </div>
                )}

                <div className="overflow-x-auto rounded-xl border border-sky-900/40">
                  <table className="w-full text-sm" style={{ minWidth: '560px' }}>
                    <thead>
                      <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left border-b border-sky-800/40">
                        <th className="px-3 py-2.5 font-semibold text-xs w-12 text-center text-slate-300">順位</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300">選手名</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300">チーム</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">タイム</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-center">新記録</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">大会新</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">大会新差</th>
                        <th className="px-3 py-2.5 font-semibold text-xs text-slate-300 text-right">得点</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...ageRankResults]
                        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
                        .map((r, i) => {
                          const isTeamHighlighted = !!ageRankHighlightTeam && r.dt_player_person.mst_team.name === ageRankHighlightTeam
                          const isNameHighlighted = !!ageRankHighlightName && r.dt_player_person.name === ageRankHighlightName
                          const isHighlighted = isNameHighlighted || (!ageRankHighlightName && isTeamHighlighted)
                          const isMale = r.dt_player_person.gender === '男子'
                          const diff = formatDiffTime(r.meet_record_seconds, r.time_seconds)
                          return (
                            <tr
                              key={r.id}
                              className={`border-t border-slate-700/40 transition-colors ${
                                isHighlighted
                                  ? 'bg-amber-950/50 ring-1 ring-inset ring-amber-500/60'
                                  : i % 2 === 0
                                    ? 'bg-sky-950/40 hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_18px_rgba(251,191,36,0.12)]'
                                    : 'bg-slate-900/40 hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_18px_rgba(251,191,36,0.12)]'
                              }`}
                            >
                              <td className="px-3 py-2 text-center">
                                {r.rank === 1 ? (
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-yellow-200 to-amber-500 text-[9px] font-black text-amber-900 shadow shadow-amber-400/60">1</span>
                                ) : r.rank === 2 ? (
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 text-[9px] font-black text-slate-700 shadow shadow-slate-400/60">2</span>
                                ) : r.rank === 3 ? (
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 text-[9px] font-black text-amber-100 shadow shadow-amber-700/60">3</span>
                                ) : (
                                  <span className="text-xs text-slate-400">{r.rank ?? '－'}</span>
                                )}
                              </td>
                              <td
                                className={`px-3 py-2 font-medium whitespace-nowrap cursor-pointer hover:underline transition-colors ${
                                  isHighlighted
                                    ? 'text-amber-200 font-bold'
                                    : isMale ? 'text-sky-300 hover:text-sky-100' : 'text-red-400 hover:text-red-200'
                                }`}
                                onClick={() => { handleAthleteClick(r); setMobileDrawerOpen(true) }}
                              >
                                {r.dt_player_person.name}
                                {isHighlighted && <span className="ml-1.5 text-[10px] text-amber-500">✦</span>}
                              </td>
                              <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                                {teamDisplayName(r.dt_player_person.mst_team.name)}
                              </td>
                              <td className="px-3 py-2 font-mono text-right whitespace-nowrap">
                                <span className={isHighlighted ? 'text-amber-200 font-bold' : 'text-white'}>
                                  {r.time_display ?? '－'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center whitespace-nowrap">
                                {r.is_world_record ? (
                                  <span className="inline-block bg-purple-500/20 text-purple-300 text-xs px-1.5 py-0.5 rounded border border-purple-500/30">世界新</span>
                                ) : r.is_japan_record ? (
                                  <span className="inline-block bg-sky-500/20 text-sky-300 text-xs px-1.5 py-0.5 rounded border border-sky-500/30">日本新</span>
                                ) : r.is_meet_record ? (
                                  <span className="inline-block bg-amber-500/20 text-amber-300 text-xs px-1.5 py-0.5 rounded border border-amber-500/30">大会新</span>
                                ) : <span className="text-slate-700">－</span>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs text-slate-300 whitespace-nowrap">
                                {r.meet_record_seconds != null ? formatSplitTime(Number(r.meet_record_seconds)) : <span className="text-slate-700">－</span>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                                {diff ? (
                                  <span className={diff === '大会新' ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                                    {diff === '大会新' ? '±0' : diff}
                                  </span>
                                ) : <span className="text-slate-700">－</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-amber-400 text-xs font-medium whitespace-nowrap">
                                {r.points != null ? formatPoints(Number(r.points)) : <span className="text-slate-600">－</span>}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // ── Layout ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="md:hidden shrink-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-sky-900/50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-2 py-2 shadow-lg">
        <button
          type="button"
          onClick={() => setMobileFilterOpen(true)}
          className="min-w-[64px] rounded-lg border border-sky-700/70 bg-sky-950/70 px-2.5 py-2 text-xs font-bold text-sky-200 transition-colors hover:bg-sky-900/80"
        >
          検索
        </button>
        <span className="truncate text-center text-xs font-bold tracking-wide bg-gradient-to-r from-sky-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
          セントラルマスターズ
        </span>
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          className="min-w-[78px] rounded-lg border border-indigo-700/70 bg-indigo-950/70 px-2.5 py-2 text-xs font-bold text-indigo-200 transition-colors hover:bg-indigo-900/80"
        >
          レース記録
        </button>
      </div>
      {/* Full-width tab bar — visually extends the site header */}
      {tabBar}

      {/* Desktop: 3-column resizable */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div
          className="shrink-0 bg-slate-800 border-r border-slate-700 overflow-y-auto flex flex-col"
          style={{ width: leftW }}
        >
          <div className="px-4 py-2.5 border-b border-slate-700/80 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              検索フィルター
            </span>
          </div>
          {activeTab === 'age-rank'
            ? ageRankFilterPanel
            : activeTab === 'meet-records'
              ? meetRecordsFilterPanel
              : activeTab === 'disqualification'
                ? disqualificationFilterPanel
                : filterPanel}
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
                onClick={() => {
                  setAthleteForHistory(null)
                  setAthleteHistory(null)
                  if (activeTab === 'athlete') setActiveTab('results')
                  updateUrl({ tab: activeTab === 'athlete' ? 'results' : activeTab, athleteId: null })
                }}
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
                  <button
                    type="button"
                    onClick={() => { setMobileDrawerOpen(false); handleTabChange('athlete') }}
                    className="mt-3 w-full rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-xs font-bold text-white transition-colors"
                  >
                    詳しく見る →
                  </button>
                </div>
                {athleteHistory.map((meet) => {
                  const indPts = meet.individual.reduce((s, r) => s + (r.points ?? 0), 0)
                  const relPts = meet.relay.reduce((s, r) => s + (r.team_points ?? 0) / 4, 0)
                  const totalPts = indPts + relPts
                  return (
                    <div key={meet.round}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-sky-400">第{meet.round}回（{meet.pool_type}）</span>
                        {totalPts > 0 && (
                          <span className="text-xs text-amber-400 font-medium shrink-0 ml-1">{formatPoints(totalPts)}pt</span>
                        )}
                      </div>
                      {/* 個人・リレー結果テーブル */}
                      <table className="w-full text-xs">
                        <tbody>
                          {meet.individual.map((r, i) => (
                            <tr
                              key={i}
                              className="group border-t border-slate-700/40 cursor-pointer hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_16px_rgba(251,191,36,0.14)] transition-all"
                              onClick={() => handleJumpToAgeRank(meet.round, r.event, r.age_group)}
                              title="年代別順位タブで同条件を表示"
                            >
                              <td className="py-1 pr-1 text-slate-100 group-hover:text-amber-200 transition-colors">{r.event}</td>
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
                            <tr
                              key={`relay-${i}`}
                              className="group border-t border-slate-700/40 cursor-pointer hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_16px_rgba(251,191,36,0.14)] transition-all"
                              onClick={() => handleJumpToAgeRank(meet.round, r.event, r.age_group ?? '', true)}
                              title="年代別順位タブで同条件を表示"
                            >
                              <td className="py-1 pr-1 text-indigo-300 group-hover:text-amber-200 transition-colors">R {r.event}</td>
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
      <div className="md:hidden flex flex-col flex-1 overflow-hidden">

        <div className="flex-1 overflow-hidden min-h-0">{resultsArea}</div>
      </div>

      {/* Mobile filter drawer — slides in from left */}
      <div className={`md:hidden fixed inset-0 z-50 transition-all duration-300 ${mobileFilterOpen ? 'visible' : 'invisible pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${mobileFilterOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileFilterOpen(false)}
        />
        <div className={`absolute left-0 top-0 h-full w-[88vw] max-w-sm bg-slate-800 border-r border-slate-700 flex flex-col transition-transform duration-300 ease-out ${mobileFilterOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0 bg-slate-900">
            <span className="text-sm font-bold text-white">検索フィルター</span>
            <button
              onClick={() => setMobileFilterOpen(false)}
              className="flex items-center gap-1 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
              aria-label="閉じる"
            >
              閉じる ✕
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {activeTab === 'age-rank'
              ? ageRankFilterPanel
              : activeTab === 'meet-records'
                ? meetRecordsFilterPanel
              : activeTab === 'disqualification'
                ? disqualificationFilterPanel
                : filterPanel}
          </div>
        </div>
      </div>

      {/* Mobile athlete drawer — slides in from right */}
      <div className={`md:hidden fixed inset-0 z-50 transition-all duration-300 ${mobileDrawerOpen ? 'visible' : 'invisible pointer-events-none'}`}>
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${mobileDrawerOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileDrawerOpen(false)}
        />
        {/* Drawer panel */}
        <div className={`absolute right-0 top-0 h-full w-[88vw] max-w-sm bg-slate-900 border-l border-slate-700 flex flex-col transition-transform duration-300 ease-out ${mobileDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0 bg-slate-800">
            <span className="text-sm font-bold text-white">過去レース記録</span>
            <button
              onClick={() => setMobileDrawerOpen(false)}
              className="flex items-center gap-1 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
              aria-label="閉じる"
            >
              ← 戻る
            </button>
          </div>
          {/* Content */}
          <div className="overflow-y-auto flex-1">
            {historyLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
                <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                読込中…
              </div>
            ) : !athleteHistory || !athleteForHistory ? (
              <div className="p-5 text-sm text-slate-500">記録が見つかりません</div>
            ) : (
              <div className="p-4 flex flex-col gap-5">
                <div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-lg font-bold text-white">{athleteForHistory.name}</span>
                    <span className={`text-xs font-medium ${athleteForHistory.gender === '男子' ? 'text-sky-400' : 'text-rose-400'}`}>
                      {genderDisplay(athleteForHistory.gender)}
                    </span>
                  </div>
                  {athleteForHistory.teamName && (
                    <div className="text-xs text-slate-400 mt-0.5">{teamDisplayName(athleteForHistory.teamName)}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setMobileDrawerOpen(false); handleTabChange('athlete') }}
                    className="mt-3 w-full rounded-xl bg-sky-600 hover:bg-sky-500 px-4 py-3 text-sm font-bold text-white transition-colors shadow-lg shadow-sky-900/40"
                  >
                    詳しく見る →
                  </button>
                </div>
                {athleteHistory.map((meet) => {
                  const indPts = meet.individual.reduce((s, r) => s + (r.points ?? 0), 0)
                  const relPts = meet.relay.reduce((s, r) => s + (r.team_points ?? 0) / 4, 0)
                  const totalPts = indPts + relPts
                  return (
                    <div key={meet.round}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-sky-400">第{meet.round}回（{meet.pool_type}）</span>
                        {totalPts > 0 && <span className="text-xs text-amber-400 font-medium">{formatPoints(totalPts)}pt</span>}
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {meet.individual.map((r, i) => (
                            <tr
                              key={i}
                              className="border-t border-slate-700/40 cursor-pointer transition-colors hover:bg-amber-900/35"
                              onClick={() => {
                                setMobileDrawerOpen(false)
                                handleJumpToAgeRank(meet.round, r.event, r.age_group)
                              }}
                              title="年代別順位で同条件を表示"
                            >
                              <td className="py-1.5 pr-1 text-slate-100">{r.event}</td>
                              <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">{r.age_group}</td>
                              <td className="py-1.5 pr-2 font-mono text-white whitespace-nowrap">
                                {r.time_display ?? '－'}
                                {r.is_meet_record && <span className="ml-1 text-amber-400">★</span>}
                              </td>
                              <td className="py-1.5 text-right text-white whitespace-nowrap font-medium">
                                {r.rank != null ? `${r.rank}位` : ''}
                              </td>
                            </tr>
                          ))}
                          {meet.relay.map((r, i) => (
                            <tr
                              key={`relay-${i}`}
                              className="border-t border-slate-700/40 cursor-pointer transition-colors hover:bg-amber-900/35"
                              onClick={() => {
                                setMobileDrawerOpen(false)
                                handleJumpToAgeRank(meet.round, r.event, r.age_group ?? '', true)
                              }}
                              title="年代別順位で同条件を表示"
                            >
                              <td className="py-1.5 pr-1 text-indigo-300">R {r.event}</td>
                              <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">{r.age_group ?? ''}</td>
                              <td className="py-1.5 pr-2 font-mono text-white whitespace-nowrap">{r.time_display ?? '－'}</td>
                              <td className="py-1.5 text-right text-white whitespace-nowrap font-medium">
                                {r.rank != null ? `${r.rank}位` : ''}
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
    </div>
  )
}
