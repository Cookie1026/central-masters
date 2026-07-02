'use client'

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Image from 'next/image'
import { getAthleteProfile } from '@/data/athlete-profiles'
import AllMeetsAnalysis from '@/components/AllMeetsAnalysis'
import RelayOptimizer from '@/components/RelayOptimizer'
import RaceGame from '@/components/RaceGame'
import { formatEventDisplay } from '@/lib/event-display'
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
type MainTab = 'results' | 'team' | 'relay-optimize' | 'athlete' | 'age-rank' | 'meet-records' | 'disqualification' | 'race-game'
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
  disqualificationCode: string | null
  isWithdrawal: boolean
  playerId: number | null
  members?: { id: number; name: string; gender: string }[]
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
type RivalCandidate = {
  id: number
  name: string
  gender: string
  teamName: string
  sharedEvents: number
}
type AthleteEventStat = {
  event: string
  poolType: string
  ageName: string
  myBestTime: number
  myBestDisplay: string
  avgTime: number
  stdDev: number
  deviation: number
  overallRank: number
  totalParticipants: number
}
type TeamMemberRanking = { id: number; name: string; totalPoints: number; rank: number }
type TimelineMilestone = {
  round: number
  icon: string
  label: string
  detail: string
  color: 'sky' | 'amber' | 'violet' | 'emerald'
}
type RivalHistory = {
  athlete: AthleteHistoryIdentity
  meets: AthleteHistoryMeet[]
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

const EVENT_TYPE_ORDER = ['自由形', '平泳ぎ', 'バタフライ', '背泳ぎ', '個人メドレー', 'フリーリレー', 'メドレーリレー'] as const

function parseEventName(name: string): { type: string; distance: string; typeIdx: number; distNum: number } {
  const typeMatch = (EVENT_TYPE_ORDER as readonly string[]).find((t) => name.includes(t))
  const relayMatch = name.match(/(\d+)×(\d+)m/)
  const singleMatch = name.match(/(\d+)m/)
  const distance = relayMatch ? `${relayMatch[1]}×${relayMatch[2]}m` : singleMatch ? `${singleMatch[1]}m` : ''
  const distNum = relayMatch ? parseInt(relayMatch[2]) : singleMatch ? parseInt(singleMatch[1]) : 0
  return {
    type: typeMatch ?? name,
    distance,
    typeIdx: typeMatch != null ? (EVENT_TYPE_ORDER as readonly string[]).indexOf(typeMatch) : 99,
    distNum,
  }
}

function compareEventNames(a: string, b: string): number {
  const eventA = parseEventName(a)
  const eventB = parseEventName(b)
  return eventA.typeIdx - eventB.typeIdx || eventA.distNum - eventB.distNum || a.localeCompare(b, 'ja')
}

function normalizeRelayMeetRecordTeamName(name: string): string {
  return name.replace(/^Ｓ/, 'S').replace(/^ＣＳ/, 'CS')
}

function parseRelayMeetRecord(raw: string): { members: string; team: string } | null {
  const sep = '・'
  const parts = raw
    .trim()
    .split(/ +/)
    .filter(Boolean)
    .filter((part) => part !== '-' && !/^\d+$/.test(part))
  const hasSep = (value: string) => value.includes(sep)
  const compact = (value: string) => value.replace(/[ \u3000]+/g, '')
  const mergeMembers = (chunks: string[]) =>
    chunks
      .join(sep)
      .replace(/・+/g, sep)
      .replace(/^・|・$/g, '')
      .replace(/[ \u3000]+/g, '')

  for (let idx = 1; idx < parts.length - 1; idx++) {
    const teamToken = compact(parts[idx])
    if (!teamToken || hasSep(teamToken)) continue
    const leftRaw = parts.slice(0, idx).join('')
    const rightRaw = parts.slice(idx + 1).join('')
    if (hasSep(leftRaw) && hasSep(rightRaw)) {
      return {
        team: normalizeRelayMeetRecordTeamName(teamToken),
        members: mergeMembers([leftRaw, rightRaw]),
      }
    }
  }

  if (parts.length >= 3 && !hasSep(parts[0])) {
    const memberTokens = parts.slice(1).filter(hasSep)
    const members = mergeMembers(memberTokens)
    if (members.split(sep).length >= 4) {
      return {
        team: normalizeRelayMeetRecordTeamName(compact(parts[0])),
        members,
      }
    }
  }

  return null
}

function meetRecordRelayMembers(record: MeetRecord): string {
  if (record.athlete_name?.trim()) return record.athlete_name
  return parseRelayMeetRecord(record.name_team_raw)?.members ?? record.name_team_raw.replace(/[ \u3000]+/g, '')
}

function meetRecordRelayTeam(record: MeetRecord): string {
  if (record.team_name?.trim()) return normalizeRelayMeetRecordTeamName(record.team_name)
  return parseRelayMeetRecord(record.name_team_raw)?.team ?? ''
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
  if (gender === '男' || gender === '男性') return '男性'
  if (gender === '女' || gender === '女性') return '女性'
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
  const [showTime, setShowTime] = useState(true)
  const [showRank, setShowRank] = useState(true)
  const width = 320
  const height = 154
  const padLeft = 42
  const padRight = 34
  const padTop = 22
  const padBottom = 24
  const plotHeight = height - padTop - padBottom
  const xForIndex = (index: number) => trend.points.length === 1
    ? (padLeft + width - padRight) / 2
    : padLeft + (index / (trend.points.length - 1)) * (width - padLeft - padRight)
  const values = trend.points.map((point) => point.seconds)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 0.5)
  const timeCoords = trend.points.map((point, index) => {
    const x = xForIndex(index)
    const y = padTop + ((point.seconds - min) / range) * plotHeight
    return { ...point, x, y }
  })
  const rankedPoints = trend.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.rank != null)
  const maxRank = Math.max(...rankedPoints.map(({ point }) => point.rank ?? 0), 3)
  const rankCoords = rankedPoints.map(({ point, index }) => {
    const x = xForIndex(index)
    const y = padTop + (((point.rank ?? maxRank) - 1) / Math.max(maxRank - 1, 1)) * plotHeight
    return { ...point, x, y }
  })
  const timeTicks = [min, min + range / 2, min + range]
  const rankTicks = [...new Set([1, Math.ceil((maxRank + 1) / 2), maxRank])]
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
          <h3 className="text-sm font-bold text-white">{formatEventDisplay(trend.event)}</h3>
          <span className="text-[10px] text-sky-500">{trend.poolType}</span>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono font-semibold text-cyan-300">{best.time}</div>
          <div className="text-[10px] text-slate-500">自己ベスト</div>
        </div>
      </div>

      <div className="mb-1 flex items-center gap-4 rounded-lg bg-slate-900/70 px-3 py-1.5 text-[10px] font-semibold">
        <label className="flex cursor-pointer items-center gap-1.5 text-sky-300">
          <input type="checkbox" checked={showTime} onChange={(event) => setShowTime(event.target.checked)} className="accent-sky-500" />
          タイム
        </label>
        <label className={`flex items-center gap-1.5 ${rankedPoints.length === 0 ? 'cursor-not-allowed text-slate-700' : 'cursor-pointer text-amber-300'}`}>
          <input
            type="checkbox"
            checked={showRank && rankedPoints.length > 0}
            disabled={rankedPoints.length === 0}
            onChange={(event) => setShowRank(event.target.checked)}
            className="accent-amber-500"
          />
          順位
        </label>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" role="img" aria-label={`${formatEventDisplay(trend.event)}のタイム・順位推移`}>
        {timeTicks.map((tick, index) => {
          const y = padTop + (index / 2) * plotHeight
          return (
            <g key={`time-tick-${index}`}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
              <text x={padLeft - 4} y={y + 4} textAnchor="end" fill="#38bdf8" fontSize="10">{formatSplitTime(tick)}</text>
            </g>
          )
        })}
        {rankTicks.map((tick) => {
          const y = padTop + ((tick - 1) / Math.max(maxRank - 1, 1)) * plotHeight
          return <text key={`rank-tick-${tick}`} x={width - padRight + 4} y={y + 4} fill="#f59e0b" fontSize="10">{tick}位</text>
        })}
        <text x={2} y={11} fill="#38bdf8" fontSize="10">タイム</text>
        <text x={width - 2} y={11} textAnchor="end" fill="#f59e0b" fontSize="10">順位</text>
        {showTime && timeCoords.length > 1 && (
          <polyline
            points={timeCoords.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {showRank && rankCoords.length > 1 && (
          <polyline
            points={rankCoords.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {showTime && timeCoords.map((point) => (
          <g key={`${point.round}-${point.seconds}`}>
            <title>
              {`第${point.round}回：${point.time}${point.rank != null ? `／${point.rank}位` : ''}`}
            </title>
            <circle cx={point.x} cy={point.y} r="4" fill={point.seconds === best.seconds ? '#fbbf24' : '#38bdf8'} />
            <text x={point.x} y={point.y - 8} textAnchor="middle" fill={point.seconds === best.seconds ? '#fbbf24' : '#7dd3fc'} fontSize="10" fontWeight="600">{point.time}</text>
          </g>
        ))}
        {showRank && rankCoords.map((point) => (
          <g key={`rank-${point.round}-${point.rank}`}>
            <circle cx={point.x} cy={point.y} r="3.5" fill={point.rank === Math.min(...rankedPoints.map(({ point: ranked }) => ranked.rank ?? 999)) ? '#fbbf24' : '#f59e0b'} />
            <text x={point.x} y={point.y + 14} textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="600">{point.rank}位</text>
          </g>
        ))}
        {trend.points.map((point, index) => (
          <text key={`round-${point.round}`} x={xForIndex(index)} y={height - 3} textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">第{point.round}回</text>
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

const RIVAL_COLORS = ['#38bdf8', '#f97316', '#a855f7', '#22c55e']

function RivalComparisonChart({
  series,
}: {
  series: { id: number; name: string; teamName: string; points: { round: number; seconds: number; time: string; rank: number | null }[]; totalPoints: number }[]
}) {
  const width = 760
  const height = 260
  const padLeft = 58
  const padRight = 22
  const padTop = 28
  const padBottom = 38
  const allPoints = series.flatMap((athlete) => athlete.points)
  const rounds = [...new Set(allPoints.map((point) => point.round))].sort((a, b) => a - b)
  const minSeconds = Math.min(...allPoints.map((point) => point.seconds))
  const maxSeconds = Math.max(...allPoints.map((point) => point.seconds))
  const range = Math.max(maxSeconds - minSeconds, 0.5)
  const xForRound = (round: number) => rounds.length === 1
    ? width / 2
    : padLeft + (rounds.indexOf(round) / (rounds.length - 1)) * (width - padLeft - padRight)
  const yForSeconds = (seconds: number) =>
    padTop + ((seconds - minSeconds) / range) * (height - padTop - padBottom)
  const ticks = [minSeconds, minSeconds + range / 2, minSeconds + range]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {series.map((athlete, index) => (
          <div key={athlete.id} className="flex items-center gap-1.5 text-xs font-bold text-white">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RIVAL_COLORS[index] }} />
            {athlete.name}
            <span className="text-[10px] font-normal text-slate-500">{teamDisplayName(athlete.teamName)}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-950/35 p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] min-w-[680px] w-full" role="img" aria-label="ライバルとのタイム推移比較">
          {ticks.map((tick, index) => {
            const y = padTop + (index / 2) * (height - padTop - padBottom)
            return (
              <g key={index}>
                <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#334155" strokeDasharray="4 4" />
                <text x={padLeft - 7} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{formatSplitTime(tick)}</text>
              </g>
            )
          })}
          {rounds.map((round) => (
            <text key={round} x={xForRound(round)} y={height - 10} textAnchor="middle" fill="#cbd5e1" fontSize="11">第{round}回</text>
          ))}
          {series.map((athlete, index) => {
            const coords = athlete.points.map((point) => ({
              ...point,
              x: xForRound(point.round),
              y: yForSeconds(point.seconds),
            }))
            return (
              <g key={athlete.id}>
                {coords.length > 1 && (
                  <polyline
                    points={coords.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="none"
                    stroke={RIVAL_COLORS[index]}
                    strokeWidth={index === 0 ? 3.5 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {coords.map((point) => (
                  <g key={`${athlete.id}-${point.round}-${point.seconds}`}>
                    <title>{`${athlete.name} 第${point.round}回：${point.time}${point.rank != null ? `／${point.rank}位` : ''}`}</title>
                    <circle cx={point.x} cy={point.y} r={index === 0 ? 5 : 4} fill={RIVAL_COLORS[index]} />
                    <text x={point.x} y={point.y - 9} textAnchor="middle" fill={RIVAL_COLORS[index]} fontSize="10" fontWeight="700">{point.time}</text>
                  </g>
                ))}
              </g>
            )
          })}
        </svg>
      </div>
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
type MeetRecordSortField = 'age' | 'gender' | 'name' | 'team' | 'record' | 'date'

function meetRecordTimeSeconds(value: string): number {
  const text = value.trim()
  if (!text) return Number.POSITIVE_INFINITY
  if (text.includes(':')) {
    const [minutes, seconds] = text.split(':')
    const total = Number(minutes) * 60 + Number(seconds)
    return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY
  }
  const seconds = Number(text)
  return Number.isFinite(seconds) ? seconds : Number.POSITIVE_INFINITY
}

const sel =
  'w-full bg-[#333b47] border border-slate-600 text-slate-100 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 cursor-pointer'
const lbl = 'block text-[10px] font-bold text-cyan-600 uppercase tracking-widest mb-1'
const SEARCH_LIST_BG = '#333b47'

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
      <div>{children}</div>
      <div className={`text-[8px] mt-0.5 ${active ? 'text-sky-400' : 'opacity-20'}`}>
        {active ? (dir === 'asc' ? '△' : '▽') : '△▽'}
      </div>
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
  const [rivalCandidates, setRivalCandidates] = useState<RivalCandidate[]>([])
  const [selectedRivalIds, setSelectedRivalIds] = useState<number[]>([])
  const [rivalHistories, setRivalHistories] = useState<Record<number, RivalHistory>>({})
  const [rivalEventKey, setRivalEventKey] = useState('')
  const [rivalLoading, setRivalLoading] = useState(false)
  const [athleteStats, setAthleteStats] = useState<AthleteEventStat[] | null>(null)
  const [teamRanking, setTeamRanking] = useState<TeamMemberRanking[] | null>(null)
  const [teamRankingName, setTeamRankingName] = useState('')
  const shareCanvasRef = useRef<HTMLCanvasElement>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyDisqualification, setHistoryDisqualification] = useState<{
    code: string | null
    isWithdrawal: boolean
  } | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [activeTab, setActiveTab] = useState<MainTab>('results')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [rightPanelTab, setRightPanelTab] = useState<'digest' | 'history'>('digest')
  const [quickStroke, setQuickStroke] = useState<string | null>(null)
  const [quickDist, setQuickDist] = useState<string | null>(null)
  const [athleteDetailView, setAthleteDetailView] = useState<AthleteDetailView>('overview')
  const [athleteDetailOpenSections, setAthleteDetailOpenSections] = useState<Set<'records' | 'trends' | 'age-rank'>>(new Set(['records', 'trends', 'age-rank']))
  const [teamStandings, setTeamStandings] = useState<TeamStanding[]>([])
  const [teamHistoryStandings, setTeamHistoryStandings] = useState<TeamStanding[]>([])
  const [teamStandingsLoading, setTeamStandingsLoading] = useState(false)
  const [checkedTeamNames, setCheckedTeamNames] = useState<Set<string>>(new Set())
  const [teamTableOpen, setTeamTableOpen] = useState(true)
  const [scoreBreakdownOpen, setScoreBreakdownOpen] = useState(true)
  const [playerScoresOpen, setPlayerScoresOpen] = useState(true)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [teamAnalysis, setTeamAnalysis] = useState<TeamAnalysis | null>(null)

  // 年代別順位タブ
  const latestMeetId = useMemo(
    () => [...meets].sort((a, b) => b.round - a.round)[0]?.id ?? null,
    [meets],
  )
  const [ageRankMeetId, setAgeRankMeetId] = useState<number | null>(latestMeetId)
  const [ageRankEventKey, setAgeRankEventKey] = useState('')
  const [ageRankGender, setAgeRankGender] = useState('')
  const [ageRankAgeValue, setAgeRankAgeValue] = useState('')  // ind:{id} or rel:{label}
  const [ageRankHighlightName, setAgeRankHighlightName] = useState('')
  const [ageRankHighlightTeam, setAgeRankHighlightTeam] = useState('')
  const [ageRankResults, setAgeRankResults] = useState<IndividualResult[]>([])
  const [ageRankRelayResults, setAgeRankRelayResults] = useState<RelayResult[]>([])
  const [ageRankLoading, setAgeRankLoading] = useState(false)
  const [ageRankClosedEvents, setAgeRankClosedEvents] = useState<Set<string>>(new Set())
  const [disqualificationView, setDisqualificationView] = useState<'rules' | 'offenders'>('offenders')
  const [disqualificationRules, setDisqualificationRules] = useState<DisqualificationRule[]>([])
  const [disqualifiedEntries, setDisqualifiedEntries] = useState<DisqualifiedEntry[]>([])
  const [disqualificationLoading, setDisqualificationLoading] = useState(false)
  const [dqTypeFilter, setDqTypeFilter] = useState<'all' | 'individual' | 'relay'>('all')
  const [dqSortKey, setDqSortKey] = useState<string | null>(null)
  const [dqSortDir, setDqSortDir] = useState<'asc' | 'desc'>('asc')

  // 大会新一覧タブ
  const [mrCourse, setMrCourse] = useState<'' | '短水路' | '長水路'>('')
  const [mrEvent, setMrEvent] = useState('')
  const [mrGender, setMrGender] = useState('')
  const [mrAgeGroup, setMrAgeGroup] = useState('')
  const [mrHighlightTeam, setMrHighlightTeam] = useState('')
  const [mrHighlightName, setMrHighlightName] = useState('')
  const [mrRecords, setMrRecords] = useState<MeetRecord[]>([])
  const [mrLoading, setMrLoading] = useState(false)
  const [mrTeamDropdownOpen, setMrTeamDropdownOpen] = useState(false)
  const [mrSortField, setMrSortField] = useState<MeetRecordSortField>('age')
  const [mrSortDir, setMrSortDir] = useState<'asc' | 'desc'>('asc')
  const [mrMainView, setMrMainView] = useState<'records' | 'ranking'>('records')
  const [mrClosedCourses, setMrClosedCourses] = useState<Set<string>>(new Set())
  const [mrRankSort, setMrRankSort] = useState<{ field: 'rank' | 'name' | 'gender' | 'team' | 'total' | 'short' | 'long'; dir: 'asc' | 'desc' }>({ field: 'total', dir: 'desc' })
  const [mrClosedEvents, setMrClosedEvents] = useState<Set<string>>(new Set())

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
    return [...map.values()].sort((a, b) => {
      const pa = parseEventName(a.name)
      const pb = parseEventName(b.name)
      return pa.typeIdx !== pb.typeIdx ? pa.typeIdx - pb.typeIdx : pa.distNum - pb.distNum
    })
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
    const currentDepth = Number(window.history.state?.searchAppDepth ?? 0)
    const nextDepth = replace ? currentDepth : currentDepth + 1
    window.history[replace ? 'replaceState' : 'pushState'](
      { ...window.history.state, searchAppDepth: nextDepth },
      '',
      url,
    )
    setCanGoBack(nextDepth > 0)
  }, [])

  const fetchAthleteHistory = useCallback((id: number, name: string, genderStr: string, teamName?: string, updateAddress = true) => {
    setAthleteDetailView('overview')
    setRightPanelTab('history')
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

  useEffect(() => {
    if (!athleteForHistory?.id) {
      setRivalCandidates([])
      setSelectedRivalIds([])
      setRivalHistories({})
      setRivalEventKey('')
      setAthleteStats(null)
      setTeamRanking(null)
      setTeamRankingName('')
      return
    }
    const controller = new AbortController()
    setSelectedRivalIds([])
    setRivalHistories({})
    setRivalEventKey('')
    setAthleteStats(null)
    setTeamRanking(null)
    setTeamRankingName('')
    fetch(`/api/athlete-rivals?athleteId=${athleteForHistory.id}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { rivals?: RivalCandidate[] }) => setRivalCandidates(data.rivals ?? []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setRivalCandidates([])
      })
    fetch(`/api/athlete-stats?athleteId=${athleteForHistory.id}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { eventStats?: AthleteEventStat[] }) => setAthleteStats(data.eventStats ?? []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setAthleteStats([])
      })
    fetch(`/api/team-stats?athleteId=${athleteForHistory.id}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { teamName?: string; members?: TeamMemberRanking[] }) => {
        setTeamRankingName(data.teamName ?? '')
        setTeamRanking(data.members ?? [])
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setTeamRanking([])
      })
    return () => controller.abort()
  }, [athleteForHistory?.id])

  const toggleRival = useCallback((candidate: RivalCandidate) => {
    if (selectedRivalIds.includes(candidate.id)) {
      setSelectedRivalIds((current) => current.filter((id) => id !== candidate.id))
      return
    }
    if (selectedRivalIds.length >= 3) return
    setSelectedRivalIds((current) => [...current, candidate.id])
    if (rivalHistories[candidate.id]) return
    setRivalLoading(true)
    fetch(`/api/athlete-history?athleteId=${candidate.id}`)
      .then((response) => response.json())
      .then((data: { athlete?: AthleteHistoryIdentity; meets?: AthleteHistoryMeet[] }) => {
        if (!data.athlete) return
        setRivalHistories((current) => ({
          ...current,
          [candidate.id]: { athlete: data.athlete!, meets: data.meets ?? [] },
        }))
      })
      .finally(() => setRivalLoading(false))
  }, [rivalHistories, selectedRivalIds])

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
      setCanGoBack(Number(window.history.state?.searchAppDepth ?? 0) > 0)
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

    if (window.history.state?.searchAppDepth == null) {
      window.history.replaceState(
        { ...window.history.state, searchAppDepth: 0 },
        '',
        window.location.href,
      )
    }
    restoreFromUrl()
    window.addEventListener('popstate', restoreFromUrl)
    return () => window.removeEventListener('popstate', restoreFromUrl)
  }, [fetchAthleteHistory])

  const handleAthleteClick = useCallback((r: IndividualResult) => {
    setHistoryDisqualification(null)
    fetchAthleteHistory(r.player_id, r.dt_player_person.name, r.dt_player_person.gender, r.dt_player_person.mst_team.name)
    setMobileDrawerOpen(true)
  }, [fetchAthleteHistory])

  const handleRelayMemberClick = useCallback((m: RelayMember) => {
    setHistoryDisqualification(null)
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
      updateUrl({
        tab: activeTab,
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
    if (!ageRankMeetId) {
      setAgeRankResults([])
      setAgeRankRelayResults([])
      return
    }

    setAgeRankLoading(true)
    const individualParams = new URLSearchParams({ eventId: String(ageRankMeetId) })
    const relayParams = new URLSearchParams({ eventId: String(ageRankMeetId) })
    if (selectedAgeRankEventIdsKey) {
      individualParams.set('categoryIds', selectedAgeRankEventIdsKey)
      relayParams.set('categoryIds', selectedAgeRankEventIdsKey)
    }
    if (ageRankGender && ageRankGender !== '混合') {
      individualParams.set('gender', ageRankGender)
      relayParams.set('gender', ageRankGender)
    }
    if (ageRankAgeValue.startsWith('ind:')) individualParams.set('ageId', ageRankAgeValue.slice(4))
    if (ageRankAgeValue.startsWith('rel:')) relayParams.set('ageGroupLabel', ageRankAgeValue.slice(4))
    const fetchIndividuals = !selectedAgeRankEvent || selectedAgeRankEvent.type === '個人'
    const fetchRelays = !selectedAgeRankEvent || selectedAgeRankEvent.type === 'リレー' || ageRankGender === '混合'
    let cancelled = false
    Promise.all([
      fetchIndividuals ? fetch(`/api/search?${individualParams}`).then((r) => r.json()) : Promise.resolve({ results: [] }),
      fetchRelays ? fetch(`/api/relay?${relayParams}`).then((r) => r.json()) : Promise.resolve({ results: [] }),
    ])
      .then(([individualData, relayData]) => {
        if (!cancelled) {
          setAgeRankResults(individualData.results ?? [])
          setAgeRankRelayResults(relayData.results ?? [])
          setAgeRankLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setAgeRankLoading(false) })
    return () => { cancelled = true }
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
    fetch('/api/meet-records')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setMrRecords(data.records ?? [])
          setMrEvent('')
          setMrGender('')
          setMrAgeGroup('')
          setMrHighlightTeam('')
          setMrHighlightName('')
          setMrClosedEvents(new Set())
          setMrLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setMrLoading(false) })
    return () => { cancelled = true }
  }, [activeTab])

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
    [...new Set(mrRecords.map((r) => `${r.event} ${r.distance}`))].sort((a, b) => {
      const pa = parseEventName(a)
      const pb = parseEventName(b)
      return pa.typeIdx !== pb.typeIdx ? pa.typeIdx - pb.typeIdx : pa.distNum - pb.distNum
    })
  , [mrRecords])
  const mrUniqueAgeGroups = useMemo(() =>
    [...new Set(mrRecords.map((r) => r.age_group))].sort((a, b) => a - b)
  , [mrRecords])
  const mrFiltered = useMemo(() => {
    return mrRecords.filter((r) => {
      if (mrCourse && r.course !== mrCourse) return false
      if (mrEvent && `${r.event} ${r.distance}` !== mrEvent) return false
      if (mrGender && genderDisplay(r.gender) !== mrGender) return false
      if (mrAgeGroup && String(r.age_group) !== mrAgeGroup) return false
      return true
    })
  }, [mrRecords, mrCourse, mrEvent, mrGender, mrAgeGroup])
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
  const handleMeetRecordSort = useCallback((field: MeetRecordSortField) => {
    if (mrSortField === field) {
      setMrSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    } else {
      setMrSortField(field)
      setMrSortDir(field === 'date' ? 'desc' : 'asc')
    }
  }, [mrSortField])
  const mrSortedFiltered = useMemo(() => {
    const valueFor = (r: MeetRecord, field: MeetRecordSortField): string | number => {
      if (field === 'age') return r.age_group
      if (field === 'gender') return genderDisplay(r.gender)
      if (field === 'name') return r.is_relay ? meetRecordRelayMembers(r) : (r.athlete_name ?? '')
      if (field === 'team') return r.is_relay ? meetRecordRelayTeam(r) : (r.team_name ?? '')
      if (field === 'record') return meetRecordTimeSeconds(r.record)
      if (field === 'date') return r.established_date ? Date.parse(r.established_date) : Number.POSITIVE_INFINITY
      return ''
    }
    return [...mrFiltered].sort((a, b) => {
      const av = valueFor(a, mrSortField)
      const bv = valueFor(b, mrSortField)
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv), 'ja')
      }
      if (cmp === 0) {
        const eventCmp = `${a.event} ${a.distance}`.localeCompare(`${b.event} ${b.distance}`, 'ja')
        cmp = eventCmp !== 0 ? eventCmp : a.age_group - b.age_group
      }
      return mrSortDir === 'asc' ? cmp : -cmp
    })
  }, [mrFiltered, mrSortField, mrSortDir])
  const mrGroupedByEvent = useMemo(() => {
    const buildMap = (records: MeetRecord[]) => {
      const groups = new Map<string, MeetRecord[]>()
      for (const r of records) {
        const mixedRelayLabel = r.is_relay && genderDisplay(r.gender) === '混合' ? ' 混合' : ''
        const key = `${r.event} ${r.distance}${mixedRelayLabel}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(r)
      }
      return groups
    }
    return {
      short: buildMap(mrSortedFiltered.filter((r) => r.course === '短水路')),
      long: buildMap(mrSortedFiltered.filter((r) => r.course === '長水路')),
    }
  }, [mrSortedFiltered])
  const mrAthleteRecords = useMemo(() =>
    mrHighlightName
      ? mrRecords.filter(r => !r.is_relay && r.athlete_name === mrHighlightName)
          .sort((a, b) => {
            const ad = a.established_date ? Date.parse(a.established_date) : Number.POSITIVE_INFINITY
            const bd = b.established_date ? Date.parse(b.established_date) : Number.POSITIVE_INFINITY
            if (ad !== bd) return ad - bd
            if (a.event !== b.event) return a.event.localeCompare(b.event, 'ja')
            if (a.distance !== b.distance) return a.distance.localeCompare(b.distance, 'ja')
            return a.age_group - b.age_group
          })
      : []
  , [mrRecords, mrHighlightName])
  const mrSelectedAthlete = useMemo(() => {
    if (!mrHighlightName || mrAthleteRecords.length === 0) return null
    const first = mrAthleteRecords[0]
    return {
      name: mrHighlightName,
      gender: genderDisplay(first.gender),
      teamName: first.team_name ?? '',
      count: mrAthleteRecords.length,
    }
  }, [mrHighlightName, mrAthleteRecords])

  const mrAthleteRanking = useMemo(() => {
    const map = new Map<string, { name: string; gender: string; teamName: string; shortCount: number; longCount: number }>()
    for (const r of mrRecords) {
      if (r.is_relay || !r.athlete_name) continue
      const key = r.athlete_name
      if (!map.has(key)) map.set(key, { name: r.athlete_name, gender: r.gender, teamName: r.team_name ?? '', shortCount: 0, longCount: 0 })
      const entry = map.get(key)!
      if (r.course === '短水路') entry.shortCount++
      else if (r.course === '長水路') entry.longCount++
    }
    return [...map.values()]
      .map(e => ({ ...e, total: e.shortCount + e.longCount }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ja'))
  }, [mrRecords])

  const meetRecordsFilterPanel = (
    <div className="flex flex-col gap-3.5 p-4">
      <div>
        <label className={lbl}>水路</label>
        <div className="flex gap-1">
          {(['短水路', '長水路'] as const).map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setMrCourse(mrCourse === val ? '' : val)}
              className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${
                mrCourse === val
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
              }`}
            >
              {val}
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
                <option key={e} value={e}>{formatEventDisplay(e)}</option>
              ))}
            </optgroup>
          )}
          {mrUniqueEvents.filter(e => e.includes('リレー')).length > 0 && (
            <optgroup label="─── リレー ───">
              {mrUniqueEvents.filter(e => e.includes('リレー')).map((e) => (
                <option key={e} value={e}>{formatEventDisplay(e)}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div>
        <label className={lbl}>性別</label>
        <select
          className={sel}
          style={{ color: mrGender === '男性' ? '#38bdf8' : mrGender === '女性' ? '#fb7185' : mrGender === '混合' ? '#c084fc' : '', backgroundColor: SEARCH_LIST_BG }}
          value={mrGender}
          onChange={(e) => { setMrGender(e.target.value); setMrHighlightTeam(''); setMrHighlightName('') }}
        >
          <option value="" style={{ backgroundColor: SEARCH_LIST_BG, color: '#e5e7eb' }}>すべて</option>
          <option value="男性" style={{ backgroundColor: SEARCH_LIST_BG, color: '#38bdf8' }}>男性</option>
          <option value="女性" style={{ backgroundColor: SEARCH_LIST_BG, color: '#fb7185' }}>女性</option>
          <option value="混合" style={{ backgroundColor: SEARCH_LIST_BG, color: '#c084fc' }}>混合</option>
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
          <option value="">すべて</option>
          {ageRankFilteredEvents.filter((e) => e.type === '個人').length > 0 && (
            <optgroup label="─── 個人 ───">
              {ageRankFilteredEvents.filter((e) => e.type === '個人').map((e) => (
                <option key={e.ids.join(',')} value={e.ids.join(',')}>{formatEventDisplay(e.name)}</option>
              ))}
            </optgroup>
          )}
          {ageRankFilteredEvents.filter((e) => e.type === 'リレー').length > 0 && (
            <optgroup label="─── リレー ───">
              {ageRankFilteredEvents.filter((e) => e.type === 'リレー').map((e) => (
                <option key={e.ids.join(',')} value={e.ids.join(',')}>{formatEventDisplay(e.name)}</option>
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
          value={ageRankAgeValue}
          onChange={(e) => { setAgeRankAgeValue(e.target.value); setAgeRankHighlightName('') }}
        >
          {isAgeRankRelay ? (
            <>
              <option value="">すべて</option>
              {relayAgeGroups.map((label) => (
                <option key={label} value={`rel:${label}`}>{label}</option>
              ))}
            </>
          ) : (
            <>
              <option value="">すべて</option>
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
          setAgeRankMeetId(latestMeetId)
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

  const filteredAndSortedOffenders = useMemo(() => {
    let entries = disqualifiedEntries
    if (dqTypeFilter === 'individual') entries = entries.filter((e) => e.type === '個人')
    if (dqTypeFilter === 'relay') entries = entries.filter((e) => e.type === 'リレー')
    const sortedEntries = !dqSortKey ? [...entries] : [...entries].sort((a, b) => {
      let av: string | number
      let bv: string | number
      switch (dqSortKey) {
        case '大会': av = a.meet.round; bv = b.meet.round; break
        case '区分': av = a.type; bv = b.type; break
        case '選手名': av = a.name; bv = b.name; break
        case '性別': av = a.gender; bv = b.gender; break
        case 'チーム': av = a.team; bv = b.team; break
        case '競技名': av = a.event; bv = b.event; break
        case '年齢区分': av = a.ageGroup; bv = b.ageGroup; break
        case '失格区分':
          av = a.disqualificationCode ? '失格' : a.isWithdrawal ? '棄権' : ''
          bv = b.disqualificationCode ? '失格' : b.isWithdrawal ? '棄権' : ''
          break
        case '失格コード': av = a.disqualificationCode ?? ''; bv = b.disqualificationCode ?? ''; break
        default: return 0
      }
      const cmp = typeof av === 'number'
        ? (av as number) - (bv as number)
        : (av as string).localeCompare(bv as string, 'ja')
      return dqSortDir === 'asc' ? cmp : -cmp
    })
    return [
      ...sortedEntries.filter((entry) => entry.type === '個人'),
      ...sortedEntries.filter((entry) => entry.type === 'リレー'),
    ]
  }, [disqualifiedEntries, dqTypeFilter, dqSortKey, dqSortDir])

  const handleDqSort = (key: string) => {
    if (dqSortKey === key) {
      setDqSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setDqSortKey(key)
      setDqSortDir('asc')
    }
  }

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
        <label className={lbl}>性別</label>
        <select
          className={sel}
          style={{ color: gender === '男子' ? '#38bdf8' : gender === '女子' ? '#fb7185' : '', backgroundColor: SEARCH_LIST_BG }}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
        >
          <option value="" style={{ backgroundColor: SEARCH_LIST_BG, color: '#e5e7eb' }}>すべて</option>
          <option value="男子" style={{ backgroundColor: SEARCH_LIST_BG, color: '#38bdf8' }}>男子</option>
          <option value="女子" style={{ backgroundColor: SEARCH_LIST_BG, color: '#fb7185' }}>女子</option>
        </select>
      </div>
      <div>
        <label className={lbl}>個人/リレー（3）</label>
        <select className={sel} value={dqTypeFilter} onChange={(e) => setDqTypeFilter(e.target.value as 'all' | 'individual' | 'relay')}>
          <option value="all">すべて</option>
          <option value="individual">個人</option>
          <option value="relay">リレー</option>
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
              style={{ background: SEARCH_LIST_BG }}
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
                      {formatEventDisplay(e.name)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="── リレー ──">
                {filteredEvents
                  .filter((e) => e.type === 'リレー')
                  .map((e) => (
                    <option key={e.ids.join(',')} value={e.ids.join(',')}>
                      {formatEventDisplay(e.name)}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className={lbl}>性別</label>
            <select
              className={sel}
              style={{ color: gender === '男子' ? '#38bdf8' : gender === '女子' ? '#fb7185' : gender === '混合' ? '#c084fc' : '', backgroundColor: SEARCH_LIST_BG }}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="" style={{ backgroundColor: SEARCH_LIST_BG, color: '#e5e7eb' }}>すべて</option>
              <option value="男子" style={{ backgroundColor: SEARCH_LIST_BG, color: '#38bdf8' }}>男子</option>
              <option value="女子" style={{ backgroundColor: SEARCH_LIST_BG, color: '#fb7185' }}>女子</option>
              <option value="混合" style={{ backgroundColor: SEARCH_LIST_BG, color: '#c084fc' }}>混合</option>
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
  const tabPageTitles: Partial<Record<MainTab, { title: string; icon: string; glow: string; accent: string }>> = {
    results: { title: '競技結果', icon: '🏁', glow: 'from-sky-300 via-cyan-100 to-blue-300', accent: 'bg-sky-400' },
    team: { title: 'チーム順位', icon: '🏆', glow: 'from-amber-300 via-yellow-100 to-orange-300', accent: 'bg-amber-400' },
    'relay-optimize': { title: 'リレー最適化', icon: '🔁', glow: 'from-indigo-300 via-cyan-100 to-emerald-300', accent: 'bg-indigo-400' },
    'age-rank': { title: '年代別順位', icon: '📊', glow: 'from-emerald-300 via-cyan-100 to-sky-300', accent: 'bg-emerald-400' },
    disqualification: { title: '失格/棄権一覧', icon: '⚠️', glow: 'from-red-300 via-amber-100 to-orange-300', accent: 'bg-red-400' },
  }
  const activeTabPageTitle = tabPageTitles[activeTab]
  const titleTeamStanding = activeTab === 'team' && selectedTeam
    ? teamStandings.find((standing) => selectedTeam.ids.includes(standing.mst_team.id))
    : null
  const resultFilterButtons = (
    <div className="flex items-center gap-1.5">
      {(['all', 'individual', 'relay'] as ResultFilter[]).map((filter) => {
        const labels: Record<ResultFilter, string> = { all: 'すべて', individual: '個人競技', relay: 'リレー' }
        const active = resultFilter === filter
        return (
          <button
            key={filter}
            type="button"
            onClick={() => handleResultFilterChange(filter)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-sky-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)]'
                : 'bg-[#333b47] text-slate-300 hover:bg-slate-600 hover:text-white'
            }`}
          >
            {labels[filter]}
          </button>
        )
      })}
    </div>
  )
  const pageTitleContext = activeTab === 'results'
    ? resultFilterButtons
    : activeTab === 'team' && selectedTeam && currentMeet
      ? (
        <span className="text-sm font-semibold text-slate-200">
          <span className="text-cyan-300">{selectedTeam.displayName}</span>
          <span className="text-slate-500"> · </span>
          第{currentMeet.round}回大会
          <span className="ml-1 text-amber-300">{titleTeamStanding?.rank ?? '－'}位</span>
          <span className="ml-1 text-slate-300">/ {teamStandings.length}チーム中</span>
        </span>
      )
      : activeTab === 'age-rank' && ageRankCurrentMeet
        ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-white sm:text-sm">
            第{ageRankCurrentMeet.round}回
            <span className="text-sky-300">{ageRankCurrentMeet.pool_type}</span>
            <span>{selectedAgeRankEvent ? formatEventDisplay(selectedAgeRankEvent.name) : '全競技'}</span>
            <span className={ageRankGender === '男子' ? 'text-sky-300' : ageRankGender === '女子' ? 'text-rose-300' : ageRankGender === '混合' ? 'text-purple-300' : 'text-white'}>
              {ageRankGender || '全性別'}
            </span>
            <span>{ageRankAgeName || '全年齢区分'}</span>
            <span className="text-emerald-300">{ageRankResults.length + ageRankRelayResults.length}件</span>
          </span>
        )
        : null
  const glowingTabTitle = activeTabPageTitle && (
    <div className="sticky top-0 z-30 shrink-0 border-b border-slate-700/70 bg-slate-950/95 px-4 py-3 shadow-lg shadow-slate-950/60 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`h-8 w-1 rounded-full ${activeTabPageTitle.accent} shadow-[0_0_14px_rgba(125,211,252,0.7)]`} />
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#333b47] text-lg shadow-[0_0_18px_rgba(148,163,184,0.35)]">
          {activeTabPageTitle.icon}
        </span>
        <h1 className={`text-lg font-black tracking-wide bg-gradient-to-r ${activeTabPageTitle.glow} bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(255,255,255,0.35)] sm:text-xl`}>
          {activeTabPageTitle.title}
        </h1>
        {pageTitleContext && (
          <div className={`min-w-0 items-center sm:ml-2 ${activeTab === 'team' ? 'hidden md:flex' : 'flex'}`}>
            {pageTitleContext}
          </div>
        )}
        {((activeTab === 'age-rank' && !ageRankEventKey) || (activeTab === 'meet-records' && mrMainView === 'records')) && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'age-rank') {
                  setAgeRankClosedEvents(new Set())
                } else {
                  setMrClosedCourses(new Set())
                  setMrClosedEvents(new Set())
                }
              }}
              className="rounded-lg border border-emerald-700/60 bg-emerald-950/70 px-2.5 py-1.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-900/80"
            >
              全て開く
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'age-rank') {
                  setAgeRankClosedEvents(new Set(ageRankEventSections.map((section) => section.key)))
                } else {
                  setMrClosedCourses(new Set(['短水路', '長水路']))
                  setMrClosedEvents(new Set([
                    ...Array.from(mrGroupedByEvent.short.keys()).map((key) => `短水路:${key}`),
                    ...Array.from(mrGroupedByEvent.long.keys()).map((key) => `長水路:${key}`),
                  ]))
                }
              }}
              className="rounded-lg border border-slate-600 bg-[#333b47] px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-600"
            >
              全て閉じる
            </button>
          </div>
        )}
      </div>
      {activeTab === 'team' && pageTitleContext && (
        <div className="mx-auto mt-2 max-w-5xl md:hidden">
          <div className="rounded-xl border border-amber-500/70 bg-gradient-to-r from-amber-950 to-yellow-950 px-3 py-2 shadow-lg shadow-amber-950/40">
            {pageTitleContext}
          </div>
        </div>
      )}
    </div>
  )

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

  const resultsDigest = useMemo(() => {
    type DigestAthlete = {
      id: number
      name: string
      gender: string
      team: string
      points: number
      golds: number
      podiums: number
      records: number
      individualRaces: number
      relayRaces: number
    }
    const athleteMap = new Map<number, DigestAthlete>()
    const getAthlete = (id: number, name: string, genderValue: string, team: string) => {
      const existing = athleteMap.get(id)
      if (existing) return existing
      const athlete = { id, name, gender: genderValue, team, points: 0, golds: 0, podiums: 0, records: 0, individualRaces: 0, relayRaces: 0 }
      athleteMap.set(id, athlete)
      return athlete
    }
    const includeIndividual = resultFilter !== 'relay'
    const includeRelay = resultFilter !== 'individual'
    const spotlights: {
      key: string
      athleteId: number | null
      name: string
      gender: string
      team: string
      event: string
      round: number
      headline: string
      detail: string
      tone: 'amber' | 'cyan' | 'violet'
      priority: number
    }[] = []

    if (includeIndividual) {
      for (const result of sortedResults) {
        const athlete = getAthlete(
          result.player_id,
          result.dt_player_person.name,
          result.dt_player_person.gender,
          result.dt_player_person.mst_team.name,
        )
        athlete.points += Number(result.points ?? 0)
        athlete.individualRaces += 1
        if (result.rank === 1) athlete.golds += 1
        if (result.rank != null && result.rank <= 3) athlete.podiums += 1
        if (result.is_meet_record) athlete.records += 1
        const seconds = Number(result.time_seconds)
        const recordSeconds = Number(result.meet_record_seconds)
        const gap = Number.isFinite(seconds) && Number.isFinite(recordSeconds) ? seconds - recordSeconds : null
        if (result.is_meet_record || (gap != null && gap >= 0 && gap <= 1)) {
          spotlights.push({
            key: `individual-${result.id}`,
            athleteId: result.player_id,
            name: result.dt_player_person.name,
            gender: result.dt_player_person.gender,
            team: result.dt_player_person.mst_team.name,
            event: result.mst_category.name,
            round: result.mst_event.round,
            headline: result.is_meet_record ? '大会新！' : `大会新まであと${gap!.toFixed(2)}秒`,
            detail: `${result.time_display ?? '－'}・${result.rank != null ? `${result.rank}位` : '順位なし'}`,
            tone: result.is_meet_record ? 'amber' : 'cyan',
            priority: result.is_meet_record ? -10 : gap ?? 99,
          })
        }
      }
    }

    if (includeRelay) {
      for (const result of relayResults) {
        const members = result.dt_player_relay.filter((member) => member.dt_player_person)
        const perMemberPoints = Number(result.team_points ?? 0) / 4
        for (const member of members) {
          const athlete = getAthlete(
            member.player_id,
            member.dt_player_person!.name,
            member.dt_player_person!.gender,
            result.mst_team.name,
          )
          athlete.points += perMemberPoints
          athlete.relayRaces += 1
          if (result.rank === 1) athlete.golds += 1
          if (result.rank != null && result.rank <= 3) athlete.podiums += 1
          if (result.is_meet_record) athlete.records += 1
        }
        if (result.is_meet_record) {
          spotlights.push({
            key: `relay-${result.id}`,
            athleteId: members[0]?.player_id ?? null,
            name: teamDisplayName(result.mst_team.name),
            gender: result.mst_category.gender,
            team: result.mst_team.name,
            event: result.mst_category.name,
            round: result.mst_event.round,
            headline: 'リレー大会新！',
            detail: `${result.time_display ?? '－'}・${result.rank != null ? `${result.rank}位` : '順位なし'}`,
            tone: 'violet',
            priority: -9,
          })
        }
      }
    }

    const athletes = [...athleteMap.values()]
    const topBy = (field: keyof Pick<DigestAthlete, 'points' | 'golds' | 'records' | 'relayRaces'>) =>
      [...athletes].filter((athlete) => athlete[field] > 0).sort((a, b) => Number(b[field]) - Number(a[field]) || b.points - a.points)[0] ?? null
    return {
      raceCount: (includeIndividual ? sortedResults.length : 0) + (includeRelay ? relayResults.length : 0),
      athleteCount: athletes.length,
      totalPoints: athletes.reduce((sum, athlete) => sum + athlete.points, 0),
      awards: [
        { icon: '👑', label: '検索結果MVP', athlete: topBy('points'), metric: (athlete: DigestAthlete) => `${formatPoints(athlete.points)}pt` },
        { icon: '🥇', label: '金メダルハンター', athlete: topBy('golds'), metric: (athlete: DigestAthlete) => `1位 ${athlete.golds}回` },
        { icon: '⚡', label: '記録クラッシャー', athlete: topBy('records'), metric: (athlete: DigestAthlete) => `大会新 ${athlete.records}回` },
        { icon: '🤝', label: 'リレー職人', athlete: topBy('relayRaces'), metric: (athlete: DigestAthlete) => `リレー ${athlete.relayRaces}本` },
      ].filter((award) => award.athlete != null),
      spotlights: spotlights.sort((a, b) => a.priority - b.priority).slice(0, 4),
    }
  }, [relayResults, resultFilter, sortedResults])

  const STROKE_ICONS: Record<string, string> = { '自由形': '🏊', '背泳ぎ': '🔙', '平泳ぎ': '🐸', 'バタフライ': '🦋', '個人メドレー': '🌀', 'リレー': '🤝' }

  const strokePills = useMemo(() => {
    const pills: { name: string; count: number }[] = []
    for (const s of ['自由形', '背泳ぎ', '平泳ぎ', 'バタフライ', '個人メドレー']) {
      const c = sortedResults.filter((r) => r.mst_category.name.includes(s)).length
      if (c > 0) pills.push({ name: s, count: c })
    }
    if (relayResults.length > 0) pills.push({ name: 'リレー', count: relayResults.length })
    return pills
  }, [sortedResults, relayResults])

  const distChips = useMemo(() => {
    if (!quickStroke) return []
    const dists = new Map<string, number>()
    if (quickStroke === 'リレー') {
      relayResults.forEach((r) => {
        const m = r.mst_category.name.match(/\d+×\d+m/)
        if (m) dists.set(m[0], (dists.get(m[0]) ?? 0) + 1)
      })
    } else {
      sortedResults.filter((r) => r.mst_category.name.includes(quickStroke)).forEach((r) => {
        const m = r.mst_category.name.match(/\d+m/)
        if (m) dists.set(m[0], (dists.get(m[0]) ?? 0) + 1)
      })
    }
    return [...dists.entries()].sort(([a], [b]) => parseInt(a) - parseInt(b)).map(([dist, count]) => ({ dist, count }))
  }, [quickStroke, sortedResults, relayResults])

  const quickFilteredResults = useMemo(() => {
    if (!quickStroke || quickStroke === 'リレー') return quickStroke === 'リレー' ? [] : sortedResults
    return sortedResults.filter((r) => {
      if (!r.mst_category.name.includes(quickStroke)) return false
      if (quickDist && !r.mst_category.name.includes(quickDist)) return false
      return true
    })
  }, [quickStroke, quickDist, sortedResults])

  const quickSortedRelayResults = useMemo(() => {
    if (quickStroke !== null && quickStroke !== 'リレー') return []
    if (!quickDist) return sortedRelayResults
    return sortedRelayResults.filter((r) => r.mst_category.name.includes(quickDist))
  }, [quickStroke, quickDist, sortedRelayResults])

  const individualTable = quickFilteredResults.length > 0 && (
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
          {quickFilteredResults.length}件{sortedResults.length >= 500 ? '（上限）' : ''}
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
            {quickFilteredResults.map((r, i) => {
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
                {vis('event') && <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{formatEventDisplay(r.mst_category.name)}</td>}
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
  const relayTable = quickSortedRelayResults.length > 0 && (
    <div className={resultFilter === 'all' ? 'mt-6' : ''}>
      <div className="flex items-start justify-between mb-2 gap-2">
        <span className="text-sm font-bold text-white">リレー成績</span>
        <span className="text-xs text-slate-400 shrink-0 mt-0.5">{quickSortedRelayResults.length}件</span>
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
            {quickSortedRelayResults.map((r, i) => {
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
                  {relVis('relay_event') && <td className="px-3 py-2 text-slate-200 text-xs whitespace-nowrap align-top">{formatEventDisplay(r.mst_category.name)}</td>}
                  {relVis('relay_gender') && <td className={`px-3 py-2 text-xs font-medium whitespace-nowrap align-top ${genderColor}`}>{catGender}</td>}
                  {relVis('relay_age') && <td className="px-3 py-2 text-white text-xs whitespace-nowrap align-top">{r.mst_age?.name ?? r.age_group_label ?? '－'}</td>}
                  {relVis('relay_time') && (
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-white font-medium align-top">
                      {r.time_display ?? '－'}
                    </td>
                  )}
                  <td className="px-3 py-2 align-top min-w-[280px]">
                    {(() => {
                      const isMedleyRelay = r.mst_category.name.includes('メドレー')
                      const MEDLEY_STROKE_SHORT = ['バック', '平泳', 'バッタ', '自由形']
                      return (
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
                            const strokeLabel = isMedleyRelay
                              ? (MEDLEY_STROKE_SHORT[m.swim_order - 1] ?? '')
                              : '自由形'
                            return (
                              <div key={m.swim_order} className="flex flex-col min-w-0">
                                <span
                                  className={`text-xs font-medium truncate cursor-pointer hover:underline transition-colors ${isMemberMale ? 'text-sky-300 hover:text-sky-100' : 'text-red-400 hover:text-red-200'}`}
                                  onClick={() => handleRelayMemberClick(m)}
                                >
                                  {m.dt_player_person?.name ?? `ID:${m.player_id}`}
                                </span>
                                <span className="text-[9px] text-slate-500 font-medium leading-tight">{strokeLabel}</span>
                                <span className="text-xs text-white font-mono">
                                  {split ?? ''}
                                  {diveStr && <span className="text-gray-400"> {diveStr}</span>}
                                  {memberRecordBadge && <span className="ml-1">{memberRecordBadge}</span>}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
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
    { id: 'athlete', label: '選手詳細' },
    { id: 'age-rank', label: '年代別順位' },
    { id: 'meet-records', label: '大会新一覧' },
    { id: 'disqualification', label: '失格/棄権一覧' },
  { id: 'race-game', label: '🏊 レースゲーム' },
  ]

  const athleteAnalysis = useMemo(() => {
    const history = athleteHistory ?? []
    const trendMap = new Map<string, AthleteTrend>()
    const relayTrendMap = new Map<string, AthleteTrend>()
    let individualCount = 0
    let relayCount = 0
    let totalPoints = 0
    let podiums = 0
    let records = 0
    const rankCounts = new Map<number, number>()
    const courseRanks = new Map<string, number[]>()
    const distanceRanks = new Map<'sprint' | 'distance', number[]>()

    for (const meet of [...history].sort((a, b) => a.round - b.round)) {
      individualCount += meet.individual.length
      relayCount += meet.relay.length
      for (const result of meet.individual) {
        totalPoints += result.points ?? 0
        if (result.rank != null && result.rank <= 3) podiums += 1
        if (result.rank != null) {
          rankCounts.set(result.rank, (rankCounts.get(result.rank) ?? 0) + 1)
          const courseList = courseRanks.get(meet.pool_type) ?? []
          courseList.push(result.rank)
          courseRanks.set(meet.pool_type, courseList)
          const distance = parseEventName(result.event).distNum
          distanceRanks.get(distance <= 100 ? 'sprint' : 'distance')?.push(result.rank)
            ?? distanceRanks.set(distance <= 100 ? 'sprint' : 'distance', [result.rank])
        }
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
        if (result.rank != null) rankCounts.set(result.rank, (rankCounts.get(result.rank) ?? 0) + 1)
        if (result.is_meet_record) records += 1
        const seconds = Number(result.split_seconds)
        if (!Number.isFinite(seconds) || seconds <= 0) continue
        const leg = result.swim_order != null ? `${result.swim_order}泳` : '泳順不明'
        const stroke = result.stroke || parseEventName(result.event).type
        const key = `${result.event}|${meet.pool_type}|${leg}|${stroke}`
        const trend = relayTrendMap.get(key) ?? {
          key: `relay:${key}`,
          event: `リレー ${formatEventDisplay(result.event)}／${leg} ${stroke}`,
          poolType: meet.pool_type,
          points: [],
        }
        trend.points.push({
          round: meet.round,
          seconds,
          time: formatSplitTime(seconds),
          rank: result.rank,
          meetRecordSeconds: null,
        })
        relayTrendMap.set(key, trend)
      }
    }

    const trends = [...trendMap.values()].sort(
      (a, b) => compareEventNames(a.event, b.event) || a.poolType.localeCompare(b.poolType, 'ja'),
    )
    const relayTrends = [...relayTrendMap.values()].sort(
      (a, b) => compareEventNames(a.event.replace(/^リレー /, ''), b.event.replace(/^リレー /, '')) || a.event.localeCompare(b.event, 'ja'),
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
        title: `${formatEventDisplay(bestImprovement.trend.event)}が成長している競技`,
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
        title: `大会新に最も近いのは${formatEventDisplay(recordCandidates[0].event)}`,
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
        title: `${formatEventDisplay(stableCandidate.trend.event)}は記録が安定`,
        detail: `${stableCandidate.trend.points.length}レースのタイム幅は${stableCandidate.range.toFixed(2)}秒です。`,
        tone: 'cyan',
      })
    }

    const average = (values: number[]) =>
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
    const shortAverage = average(courseRanks.get('短水路') ?? [])
    const longAverage = average(courseRanks.get('長水路') ?? [])
    const sprintAverage = average(distanceRanks.get('sprint') ?? [])
    const distanceAverage = average(distanceRanks.get('distance') ?? [])
    const rankedRaceCount = [...rankCounts.values()].reduce((sum, count) => sum + count, 0)
    const podiumRate = rankedRaceCount > 0 ? podiums / rankedRaceCount : 0
    const athleteType = records >= 2
      ? { title: 'あなたは「大会新ハンター」タイプ！', detail: '大舞台で記録を塗り替える勝負強さが光っています。', icon: '⚡' }
      : relayCount > individualCount && relayCount >= 3
        ? { title: 'あなたは「リレー職人」タイプ！', detail: '仲間とつなぐ一本でチームを支える、頼れる存在です。', icon: '🤝' }
        : shortAverage != null && longAverage != null && shortAverage + 0.5 < longAverage
          ? { title: 'あなたは「短水路」タイプ！', detail: 'ターンとテンポを味方につける短水路巧者です。', icon: '🔄' }
          : shortAverage != null && longAverage != null && longAverage + 0.5 < shortAverage
            ? { title: 'あなたは「長水路」タイプ！', detail: '大きなプールで伸びる、スケールの大きな泳ぎが持ち味です。', icon: '🌊' }
            : sprintAverage != null && distanceAverage != null && sprintAverage + 0.5 < distanceAverage
              ? { title: 'あなたは「短距離スプリンター」タイプ！', detail: '一気に加速して勝負を決める、瞬発力型のスイマーです。', icon: '🚀' }
              : podiumRate >= 0.5 && podiums >= 3
                ? { title: 'あなたは「表彰台コレクター」タイプ！', detail: '出るからには上位へ。安定した勝負強さが自慢です。', icon: '🏆' }
                : { title: 'あなたは「コツコツ成長」タイプ！', detail: '積み重ねたレースの数だけ、次の自己ベストが近づいています。', icon: '📈' }
    const meetPoints = [...history]
      .sort((a, b) => a.round - b.round)
      .map((meet) => ({
        round: meet.round,
        individual: meet.individual.reduce((sum, result) => sum + (result.points ?? 0), 0),
        relay: meet.relay.reduce((sum, result) => sum + (result.team_points ?? 0) / 4, 0),
        total: meet.athlete_points,
        contribution: meet.contribution_percent,
        teamTotal: meet.team_total_points,
      }))
    const nextRankTargets = history.flatMap((meet) =>
      meet.individual
        .filter((result) => result.next_rank != null && result.next_rank_gap_seconds != null && result.next_rank_gap_seconds > 0)
        .map((result) => ({
          round: meet.round,
          event: result.event,
          rank: result.rank,
          nextRank: result.next_rank as number,
          gap: result.next_rank_gap_seconds as number,
        })),
    ).sort((a, b) => a.gap - b.gap)

    // キャリアタイムライン
    const timeline: TimelineMilestone[] = []
    const sortedHistory = [...history].sort((a, b) => a.round - b.round)
    if (sortedHistory.length > 0) {
      const first = sortedHistory[0]
      timeline.push({ round: first.round, icon: '🏊', label: '初出場', detail: `第${first.round}回`, color: 'sky' })
    }
    let firstPodiumRound: number | null = null, firstGoldRound: number | null = null, firstRecordRound: number | null = null
    let firstPodiumEvent = '', firstGoldEvent = '', firstRecordEvent = ''
    for (const meet of sortedHistory) {
      for (const r of [...meet.individual, ...meet.relay.map(rel => ({ ...rel, is_meet_record: rel.is_meet_record }))]) {
        if (firstGoldRound == null && r.rank === 1) { firstGoldRound = meet.round; firstGoldEvent = r.event }
        if (firstPodiumRound == null && r.rank != null && r.rank <= 3) { firstPodiumRound = meet.round; firstPodiumEvent = r.event }
        if (firstRecordRound == null && r.is_meet_record) { firstRecordRound = meet.round; firstRecordEvent = r.event }
      }
    }
    if (firstPodiumRound != null && firstPodiumRound !== firstGoldRound) {
      timeline.push({ round: firstPodiumRound, icon: '🥉', label: '初表彰台', detail: `第${firstPodiumRound}回 ${firstPodiumEvent}`, color: 'amber' })
    }
    if (firstGoldRound != null) {
      timeline.push({ round: firstGoldRound, icon: '🥇', label: '初優勝', detail: `第${firstGoldRound}回 ${firstGoldEvent}`, color: 'amber' })
    }
    if (firstRecordRound != null) {
      timeline.push({ round: firstRecordRound, icon: '⭐', label: '初大会新', detail: `第${firstRecordRound}回 ${firstRecordEvent}`, color: 'violet' })
    }
    if (sortedHistory.length > 1) {
      const last = sortedHistory[sortedHistory.length - 1]
      timeline.push({ round: last.round, icon: '🔥', label: `最新 第${last.round}回`, detail: `${last.pool_type} 参加中`, color: 'emerald' })
    }
    timeline.sort((a, b) => a.round - b.round)

    // キャリアサマリー文章
    const eventPodiumMap = new Map<string, number>()
    for (const meet of history) {
      for (const r of meet.individual) {
        if (r.rank != null && r.rank <= 3) eventPodiumMap.set(r.event, (eventPodiumMap.get(r.event) ?? 0) + 1)
      }
    }
    const bestPodiumEvent = [...eventPodiumMap.entries()].sort((a, b) => b[1] - a[1])[0]
    const firstRound = sortedHistory[0]?.round
    let careerSummary = ''
    if (firstRound != null && history.length > 0) {
      const achievementParts: string[] = []
      if (individualCount > 0) achievementParts.push(`個人${individualCount}本`)
      if (podiums > 0) achievementParts.push(`表彰台${podiums}回`)
      if (records > 0) achievementParts.push(`大会新${records}回`)
      if (totalPoints > 0) achievementParts.push(`通算${formatPoints(totalPoints)}pt`)
      const achievementStr = achievementParts.length > 0 ? `（${achievementParts.join('・')}）` : ''
      const bestEventStr = bestPodiumEvent ? `。得意競技は${formatEventDisplay(bestPodiumEvent[0])}（表彰台${bestPodiumEvent[1]}回）` : ''
      careerSummary = `第${firstRound}回から${history.length}大会に参加${achievementStr}${bestEventStr}。`
    }

    // 次のマイルストーン予測
    type NextMilestone = { icon: string; label: string; detail: string; gap: string; color: 'sky' | 'amber' | 'violet' | 'emerald' }
    let nextMilestone: NextMilestone | null = null
    const hasGoldAchieved = (rankCounts.get(1) ?? 0) > 0
    if (!hasGoldAchieved && podiums > 0) {
      const closestToGold = nextRankTargets.find((t) => t.nextRank === 1)
      if (closestToGold) {
        nextMilestone = { icon: '🥇', label: '初優勝まであと一歩！', detail: `第${closestToGold.round}回 ${formatEventDisplay(closestToGold.event)}（${closestToGold.rank}位→1位）`, gap: `あと${closestToGold.gap.toFixed(2)}秒`, color: 'amber' }
      }
    } else if (podiums === 0) {
      const closestToPodium = nextRankTargets.find((t) => t.nextRank <= 3)
      if (closestToPodium) {
        const podiumIcon = closestToPodium.nextRank === 1 ? '🥇' : closestToPodium.nextRank === 2 ? '🥈' : '🥉'
        nextMilestone = { icon: podiumIcon, label: '初表彰台まであと一歩！', detail: `第${closestToPodium.round}回 ${formatEventDisplay(closestToPodium.event)}（${closestToPodium.rank}位→${closestToPodium.nextRank}位）`, gap: `あと${closestToPodium.gap.toFixed(2)}秒`, color: 'amber' }
      }
    }
    if (!nextMilestone && records === 0 && recordCandidates[0]) {
      nextMilestone = { icon: '⭐', label: '初大会新記録まであと一歩！', detail: formatEventDisplay(recordCandidates[0].event), gap: `あと${recordCandidates[0].gap.toFixed(2)}秒`, color: 'violet' }
    }
    if (!nextMilestone) {
      const nextCount = [10, 25, 50, 100].find((n) => n > individualCount)
      if (nextCount) {
        nextMilestone = { icon: '🏊', label: `通算${nextCount}レース達成まで！`, detail: `個人レースの累計（現在${individualCount}本）`, gap: `あと${nextCount - individualCount}レース`, color: 'sky' }
      }
    }

    // 自己ベスト更新ストリーク
    const pbTracker2 = new Map<string, number>()
    let pbCurrentStreak = 0, pbMaxStreak = 0, pbIsOnStreak = false
    for (const meet of sortedHistory) {
      let hadNewPB = false
      for (const r of meet.individual) {
        const sec = Number(r.time_seconds)
        if (!Number.isFinite(sec) || sec <= 0) continue
        const key2 = `${r.event}|${meet.pool_type}`
        const prev = pbTracker2.get(key2)
        if (prev !== undefined && sec < prev) hadNewPB = true
        if (prev === undefined || sec < prev) pbTracker2.set(key2, sec)
      }
      if (hadNewPB) { pbCurrentStreak++; if (pbCurrentStreak > pbMaxStreak) pbMaxStreak = pbCurrentStreak; pbIsOnStreak = true }
      else { pbCurrentStreak = 0; pbIsOnStreak = false }
    }
    const pbStreak = { current: pbCurrentStreak, max: pbMaxStreak, isOnStreak: pbIsOnStreak }

    // ベスト大会診断
    let bestMeetInfo: { round: number; poolType: string; points: number; podiums: number; records: number } | null = null
    let bestMeetScore = -1
    for (const meet of history) {
      const mp = meet.individual.filter((r) => r.rank != null && r.rank <= 3).length + meet.relay.filter((r) => r.rank != null && r.rank <= 3).length
      const mr = meet.individual.filter((r) => r.is_meet_record).length + meet.relay.filter((r) => r.is_meet_record).length
      const sc = meet.athlete_points * 10 + mp * 5 + mr * 3
      if (sc > bestMeetScore) { bestMeetScore = sc; bestMeetInfo = { round: meet.round, poolType: meet.pool_type, points: meet.athlete_points, podiums: mp, records: mr } }
    }

    // 種目ヒートマップ
    const STROKES_ORDER = ['自由形', '背泳ぎ', '平泳ぎ', 'バタフライ', '個人メドレー']
    const DIST_ORDER = ['25m', '50m', '100m', '200m', '400m', '800m', '1500m']
    const heatLong = new Map<string, { bestRank: number; raceCount: number }>()
    const heatShort = new Map<string, { bestRank: number; raceCount: number }>()
    for (const meet of history) {
      for (const r of meet.individual) {
        if (r.rank == null) continue
        const stroke = STROKES_ORDER.find((s) => r.event.includes(s))
        const distMatch = r.event.match(/(\d+)m/)
        if (!stroke || !distMatch) continue
        const dist = distMatch[1] + 'm'
        const key2 = `${stroke}|${dist}`
        const map = meet.pool_type === '長水路' ? heatLong : heatShort
        const existing = map.get(key2)
        if (!existing || r.rank < existing.bestRank) map.set(key2, { bestRank: r.rank, raceCount: (existing?.raceCount ?? 0) + 1 })
        else map.set(key2, { ...existing, raceCount: existing.raceCount + 1 })
      }
    }
    const allHeatKeys = [...heatLong.keys(), ...heatShort.keys()]
    const heatmapStrokes = STROKES_ORDER.filter((s) => allHeatKeys.some((k) => k.startsWith(s + '|')))
    const heatmapDists = DIST_ORDER.filter((d) => allHeatKeys.some((k) => k.endsWith('|' + d)))
    const heatmap = { long: heatLong, short: heatShort, strokes: heatmapStrokes, distances: heatmapDists }

    return {
      individualCount,
      relayCount,
      totalPoints,
      podiums,
      records,
      meetCount: history.length,
      trends,
      relayTrends,
      insights,
      rankCounts: [...rankCounts.entries()].sort((a, b) => a[0] - b[0]),
      athleteType,
      meetPoints,
      nextRankTargets,
      closestRecord: recordCandidates[0] ?? null,
      timeline,
      careerSummary,
      nextMilestone,
      pbStreak,
      bestMeet: bestMeetInfo,
      heatmap,
    }
  }, [athleteHistory])
  const rivalComparison = useMemo(() => {
    if (!athleteForHistory || !athleteHistory || selectedRivalIds.length === 0) {
      return { eventKeys: [] as string[], series: [] as { id: number; name: string; teamName: string; points: { round: number; seconds: number; time: string; rank: number | null }[]; totalPoints: number }[] }
    }
    const histories: { id: number; name: string; teamName: string; meets: AthleteHistoryMeet[] }[] = [
      { id: athleteForHistory.id, name: athleteForHistory.name, teamName: athleteForHistory.teamName, meets: athleteHistory },
      ...selectedRivalIds.flatMap((id) => {
        const history = rivalHistories[id]
        return history ? [{
          id,
          name: history.athlete.name,
          teamName: history.athlete.mst_team.name,
          meets: history.meets,
        }] : []
      }),
    ]
    const eventMaps = histories.map((athlete) => {
      const map = new Map<string, { round: number; seconds: number; time: string; rank: number | null }[]>()
      for (const meet of athlete.meets) {
        for (const result of meet.individual) {
          const seconds = Number(result.time_seconds)
          if (!Number.isFinite(seconds) || seconds <= 0 || !result.time_display) continue
          const key = `${result.event}|${meet.pool_type}`
          const points = map.get(key) ?? []
          points.push({ round: meet.round, seconds, time: result.time_display, rank: result.rank })
          map.set(key, points)
        }
      }
      return map
    })
    const mainKeys = [...eventMaps[0].keys()]
    const eventKeys = mainKeys
      .filter((key) => eventMaps.slice(1).some((map) => map.has(key)))
      .sort((a, b) => compareEventNames(a.split('|')[0], b.split('|')[0]) || a.localeCompare(b, 'ja'))
    const activeKey = eventKeys.includes(rivalEventKey) ? rivalEventKey : eventKeys[0] ?? ''
    const series = histories.map((athlete, index) => ({
      id: athlete.id,
      name: athlete.name,
      teamName: athlete.teamName,
      points: [...(eventMaps[index].get(activeKey) ?? [])].sort((a, b) => a.round - b.round),
      totalPoints: athlete.meets.reduce((sum, meet) => sum + meet.athlete_points, 0),
    })).filter((athlete) => athlete.points.length > 0)
    return { eventKeys, series }
  }, [athleteForHistory, athleteHistory, rivalHistories, selectedRivalIds, rivalEventKey])
  useEffect(() => {
    if (rivalComparison.eventKeys.length === 0) {
      if (rivalEventKey) setRivalEventKey('')
      return
    }
    if (!rivalComparison.eventKeys.includes(rivalEventKey)) {
      setRivalEventKey(rivalComparison.eventKeys[0])
    }
  }, [rivalComparison.eventKeys, rivalEventKey])
  const selectedAthleteProfile = athleteForHistory
    ? getAthleteProfile(athleteForHistory.id, athleteForHistory.teamName)
    : null
  const tabBar = (
    <div className="shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700/60 flex items-stretch">
      {/* Tabs — horizontally scrollable */}
      <div className="flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <p className="text-sm font-medium text-slate-300">検索から選手名を選択してください</p>
          <p className="text-xs text-slate-600 mt-1">選手を選ぶと、選手カルテとライバル比較を表示します</p>
        </div>
      ) : historyLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
          <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          選手データを読込中…
        </div>
      ) : (
        <div>
          <div className="sticky top-0 z-20 mb-5 rounded-xl border border-sky-900/50 bg-gradient-to-r from-sky-950/95 to-indigo-950/95 p-5 shadow-lg shadow-slate-950/50 backdrop-blur">
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
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3 mb-3 sm:grid-cols-3 lg:grid-cols-6">
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

              {/* 自己ベスト更新ストリーク */}
              {athleteAnalysis.pbStreak.max > 0 && (
                <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-xs ${athleteAnalysis.pbStreak.isOnStreak ? 'border-orange-600/50 bg-orange-950/30' : 'border-slate-700 bg-slate-800/40'}`}>
                  <span className="text-lg">{athleteAnalysis.pbStreak.isOnStreak ? '🔥' : '📈'}</span>
                  <div className="flex-1">
                    {athleteAnalysis.pbStreak.isOnStreak
                      ? <span className="font-bold text-orange-300"><span className="text-xl font-black">{athleteAnalysis.pbStreak.current}</span>大会連続で自己ベスト更新中！</span>
                      : <span className="text-slate-400">自己ベスト更新ストリーク</span>
                    }
                  </div>
                  <div className="text-slate-500">最高連続記録: <span className="font-bold text-slate-300">{athleteAnalysis.pbStreak.max}大会</span></div>
                </div>
              )}

              {/* キャリアタイムライン */}
              {athleteAnalysis.timeline.length > 0 && (
                <div className="mb-6">
                  <div className="overflow-x-auto pb-1 mb-3">
                    <div className="flex min-w-max items-center gap-0">
                      {athleteAnalysis.timeline.map((milestone, i) => {
                        const borderColor = milestone.color === 'sky' ? 'border-sky-600/60' : milestone.color === 'amber' ? 'border-amber-600/60' : milestone.color === 'violet' ? 'border-violet-600/60' : 'border-emerald-600/60'
                        const bgColor = milestone.color === 'sky' ? 'bg-sky-950/60' : milestone.color === 'amber' ? 'bg-amber-950/60' : milestone.color === 'violet' ? 'bg-violet-950/60' : 'bg-emerald-950/60'
                        const labelColor = milestone.color === 'sky' ? 'text-sky-300' : milestone.color === 'amber' ? 'text-amber-300' : milestone.color === 'violet' ? 'text-violet-300' : 'text-emerald-300'
                        return (
                          <div key={i} className="flex items-center">
                            {i > 0 && <div className="w-6 h-px bg-gradient-to-r from-slate-600 to-slate-500 shrink-0" />}
                            <button
                              type="button"
                              title={`第${milestone.round}回の記録へジャンプ`}
                              className={`shrink-0 rounded-xl border ${borderColor} ${bgColor} px-3 py-2 text-center min-w-[80px] cursor-pointer hover:brightness-125 transition-[filter] duration-150`}
                              onClick={() => {
                                setAthleteDetailOpenSections((prev) => new Set([...prev, 'records']))
                                setTimeout(() => {
                                  document.getElementById(`athlete-meet-${milestone.round}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                }, 100)
                              }}
                            >
                              <div className="text-lg">{milestone.icon}</div>
                              <div className={`text-[11px] font-bold mt-0.5 ${labelColor}`}>{milestone.label}</div>
                              <div className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">{milestone.detail}</div>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {athleteAnalysis.careerSummary && (
                    <p className="text-xs text-slate-400 leading-relaxed mb-3 px-1">{athleteAnalysis.careerSummary}</p>
                  )}

                  {athleteAnalysis.nextMilestone && (() => {
                    const m = athleteAnalysis.nextMilestone!
                    const borderCls = m.color === 'amber' ? 'border-amber-600/50' : m.color === 'violet' ? 'border-violet-600/50' : 'border-sky-600/50'
                    const bgCls = m.color === 'amber' ? 'bg-amber-950/40' : m.color === 'violet' ? 'bg-violet-950/40' : 'bg-sky-950/40'
                    const gapCls = m.color === 'amber' ? 'text-amber-300' : m.color === 'violet' ? 'text-violet-300' : 'text-sky-300'
                    return (
                      <div className={`rounded-xl border ${borderCls} ${bgCls} px-4 py-3 flex items-center gap-3`}>
                        <span className="text-2xl shrink-0">{m.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-white">{m.label}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">{m.detail}</div>
                        </div>
                        <div className={`shrink-0 font-mono text-sm font-black ${gapCls}`}>{m.gap}</div>
                      </div>
                    )
                  })()}
                </div>
              )}

              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <section className="overflow-hidden rounded-2xl border border-fuchsia-600/50 bg-gradient-to-r from-violet-950/80 via-fuchsia-950/55 to-slate-950 shadow-lg shadow-fuchsia-950/25">
                  <div className="flex items-center gap-4 px-5 py-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/30 bg-fuchsia-950/70 text-3xl shadow-[0_0_24px_rgba(217,70,239,0.2)]">
                      {athleteAnalysis.athleteType.icon}
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-fuchsia-400">SWIMMER TYPE</div>
                      <h3 className="mt-1 text-base font-black text-white sm:text-lg">{athleteAnalysis.athleteType.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-fuchsia-100/75">{athleteAnalysis.athleteType.detail}</p>
                    </div>
                  </div>
                </section>

                {athleteAnalysis.bestMeet && (
                  <section className="overflow-hidden rounded-2xl border border-rose-700/50 bg-rose-950/20">
                    <div className="border-b border-rose-800/40 bg-gradient-to-r from-rose-950/80 to-pink-950/60 px-4 py-3">
                      <h3 className="font-bold text-rose-100">🏆 ベスト大会</h3>
                      <p className="mt-0.5 text-[10px] text-rose-300/70">最もパフォーマンスが高かった大会</p>
                    </div>
                    <div className="p-4 flex flex-col items-center justify-center gap-2 text-center">
                      <div className="text-4xl font-black text-rose-300">第{athleteAnalysis.bestMeet.round}回</div>
                      <div className="text-xs text-slate-400">{athleteAnalysis.bestMeet.poolType}</div>
                      <div className="mt-1 flex gap-4 text-xs">
                        <div><span className="font-bold text-white">{formatPoints(athleteAnalysis.bestMeet.points)}pt</span><span className="ml-1 text-slate-500">獲得</span></div>
                        {athleteAnalysis.bestMeet.podiums > 0 && <div><span className="font-bold text-amber-300">{athleteAnalysis.bestMeet.podiums}回</span><span className="ml-1 text-slate-500">表彰台</span></div>}
                        {athleteAnalysis.bestMeet.records > 0 && <div><span className="font-bold text-violet-300">{athleteAnalysis.bestMeet.records}回</span><span className="ml-1 text-slate-500">大会新</span></div>}
                      </div>
                      <button
                        type="button"
                        className="mt-2 text-[10px] text-rose-400 hover:text-rose-300 underline"
                        onClick={() => {
                          setAthleteDetailOpenSections((prev) => new Set([...prev, 'records']))
                          setTimeout(() => document.getElementById(`athlete-meet-${athleteAnalysis.bestMeet!.round}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                        }}
                      >
                        この大会の記録を見る →
                      </button>
                    </div>
                  </section>
                )}
              </div>

              {/* 種目ヒートマップ */}
              {athleteAnalysis.heatmap.strokes.length > 0 && athleteAnalysis.heatmap.distances.length > 0 && (
                <section className="mb-6 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/50">
                  <div className="border-b border-slate-700 bg-slate-800/60 px-4 py-3">
                    <h3 className="font-bold text-slate-100">🗺️ 競技マップ</h3>
                    <p className="mt-0.5 text-[10px] text-slate-400">各競技のベスト順位（短水路/長水路）</p>
                  </div>
                  <div className="overflow-x-auto p-4">
                    <table className="min-w-max text-[11px]">
                      <thead>
                        <tr>
                          <th className="pr-3 text-left font-medium text-slate-500" />
                          {athleteAnalysis.heatmap.distances.map((d) => (
                            <th key={d} className="px-2 py-1 text-center font-medium text-slate-400">{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {athleteAnalysis.heatmap.strokes.map((stroke) => (
                          <tr key={stroke}>
                            <td className="pr-4 py-1 text-right text-xs font-medium text-slate-400 whitespace-nowrap">{stroke}</td>
                            {athleteAnalysis.heatmap.distances.map((dist) => {
                              const key2 = `${stroke}|${dist}`
                              const longCell = athleteAnalysis.heatmap.long.get(key2)
                              const shortCell = athleteAnalysis.heatmap.short.get(key2)
                              const hasAny = longCell || shortCell
                              const rankColor = (r: number) => r === 1 ? 'bg-amber-400/80 text-amber-900' : r === 2 ? 'bg-slate-300/80 text-slate-900' : r === 3 ? 'bg-orange-500/70 text-orange-100' : r <= 6 ? 'bg-sky-600/60 text-sky-100' : 'bg-slate-700/60 text-slate-300'
                              return (
                                <td key={dist} className="px-1 py-0.5">
                                  {hasAny ? (
                                    <div className="flex gap-0.5 justify-center">
                                      {shortCell ? <div className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${rankColor(shortCell.bestRank)}`} title={`短水路 ${shortCell.bestRank}位`}>{shortCell.bestRank}位<span className="ml-0.5 opacity-60">短</span></div> : <div className="w-8" />}
                                      {longCell ? <div className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${rankColor(longCell.bestRank)}`} title={`長水路 ${longCell.bestRank}位`}>{longCell.bestRank}位<span className="ml-0.5 opacity-60">長</span></div> : <div className="w-8" />}
                                    </div>
                                  ) : (
                                    <div className="text-center text-slate-700">—</div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* チーム内貢献ランキング */}
              {teamRanking != null && teamRanking.length > 0 && athleteForHistory && (
                <section className="mb-6 overflow-hidden rounded-2xl border border-teal-700/50 bg-teal-950/20">
                  <div className="border-b border-teal-800/40 bg-gradient-to-r from-teal-950/80 to-cyan-950/60 px-4 py-3">
                    <h3 className="font-bold text-teal-100">👥 チーム内得点ランキング</h3>
                    <p className="mt-0.5 text-[10px] text-teal-300/70">{teamRankingName}の全選手（個人＋リレー総計）</p>
                  </div>
                  <div className="p-4">
                    <div className="space-y-2">
                      {teamRanking.slice(0, 10).map((member) => {
                        const isMe = member.id === athleteForHistory.id
                        const maxPts = teamRanking[0].totalPoints
                        return (
                          <div key={member.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${isMe ? 'bg-teal-900/40 border border-teal-600/40' : 'bg-slate-800/30'}`}>
                            <span className={`w-7 text-center text-xs font-bold ${member.rank === 1 ? 'text-amber-300' : member.rank === 2 ? 'text-slate-300' : member.rank === 3 ? 'text-orange-400' : 'text-slate-500'}`}>
                              {member.rank === 1 ? '🥇' : member.rank === 2 ? '🥈' : member.rank === 3 ? '🥉' : `${member.rank}位`}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-medium truncate ${isMe ? 'text-teal-200' : 'text-slate-300'}`}>{member.name}</span>
                                {isMe && <span className="shrink-0 rounded bg-teal-700/60 px-1 py-0.5 text-[9px] font-bold text-teal-200">YOU</span>}
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-700">
                                <div className={`h-full rounded-full ${isMe ? 'bg-teal-400' : 'bg-teal-700'}`} style={{ width: `${member.totalPoints / maxPts * 100}%` }} />
                              </div>
                            </div>
                            <span className={`shrink-0 font-mono text-xs font-bold ${isMe ? 'text-teal-300' : 'text-slate-400'}`}>{formatPoints(member.totalPoints)}pt</span>
                          </div>
                        )
                      })}
                      {teamRanking.length > 10 && (
                        <p className="text-center text-[10px] text-slate-500">… 他{teamRanking.length - 10}名</p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* SNSシェアカードボタン + モーダル */}
              {/* キャリアカード（常時表示） */}
              {athleteForHistory && (() => {
                const avgDev = athleteStats && athleteStats.length > 0
                  ? Math.round(athleteStats.reduce((s, e) => s + e.deviation, 0) / athleteStats.length * 10) / 10
                  : null
                const grade = avgDev == null ? null : avgDev >= 65 ? 'SS' : avgDev >= 60 ? 'S' : avgDev >= 55 ? 'A' : avgDev >= 50 ? 'B' : avgDev >= 45 ? 'C' : 'D'
                const gradeColor = grade === 'SS' ? 'text-amber-300' : grade === 'S' ? 'text-yellow-300' : grade === 'A' ? 'text-sky-300' : grade === 'B' ? 'text-emerald-300' : 'text-slate-400'
                const handleDownload = () => {
                  const canvas = shareCanvasRef.current
                  if (!canvas) return
                  const ctx = canvas.getContext('2d')
                  if (!ctx) return
                  const W = 800, H = 460
                  canvas.width = W; canvas.height = H
                  const bg = ctx.createLinearGradient(0, 0, W, H)
                  bg.addColorStop(0, '#0f172a'); bg.addColorStop(0.5, '#1e1b4b'); bg.addColorStop(1, '#0f172a')
                  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
                  const acc = ctx.createLinearGradient(0, 0, W, 0)
                  acc.addColorStop(0, '#6366f1'); acc.addColorStop(1, '#8b5cf6')
                  ctx.fillStyle = acc; ctx.fillRect(0, 0, W, 5)
                  ctx.font = '14px sans-serif'; ctx.fillStyle = '#64748b'
                  ctx.fillText('セントラルマスターズ水泳大会', 36, 36)
                  ctx.font = `bold ${athleteForHistory.name.length > 6 ? '40px' : '52px'} sans-serif`
                  ctx.fillStyle = '#f8fafc'; ctx.fillText(athleteForHistory.name, 36, 100)
                  ctx.font = '16px sans-serif'; ctx.fillStyle = '#94a3b8'
                  ctx.fillText(`${athleteForHistory.teamName}　${athleteForHistory.gender}`, 36, 130)
                  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1
                  ctx.beginPath(); ctx.moveTo(36, 148); ctx.lineTo(W - 36, 148); ctx.stroke()
                  const stats2 = [['出場', `${athleteAnalysis.meetCount}回`], ['個人', `${athleteAnalysis.individualCount}本`], ['表彰台', `${athleteAnalysis.podiums}回`], ['大会新', `${athleteAnalysis.records}回`], ['得点', `${formatPoints(athleteAnalysis.totalPoints)}pt`]]
                  stats2.forEach(([label, value], i) => {
                    const x = 36 + i * 148
                    ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = '#f1f5f9'; ctx.fillText(value, x, 192)
                    ctx.font = '12px sans-serif'; ctx.fillStyle = '#64748b'; ctx.fillText(label, x, 212)
                  })
                  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1
                  ctx.beginPath(); ctx.moveTo(36, 228); ctx.lineTo(W - 36, 228); ctx.stroke()
                  if (avgDev != null && grade != null) {
                    const gc = grade === 'SS' ? '#fbbf24' : grade === 'S' ? '#fde047' : grade === 'A' ? '#38bdf8' : grade === 'B' ? '#34d399' : '#94a3b8'
                    ctx.font = 'bold 72px sans-serif'; ctx.fillStyle = gc; ctx.fillText(grade, 36, 318)
                    ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = '#f1f5f9'; ctx.fillText(`偏差値 ${avgDev}`, 130, 290)
                  }
                  ctx.font = '18px sans-serif'; ctx.fillStyle = '#c4b5fd'
                  ctx.fillText(`${athleteAnalysis.athleteType.icon} ${athleteAnalysis.athleteType.title}`, 36, 360)
                  ctx.font = '13px sans-serif'; ctx.fillStyle = '#94a3b8'
                  let line3 = '', ly = 390
                  for (const ch of athleteAnalysis.careerSummary) {
                    const test = line3 + ch
                    if (ctx.measureText(test).width > W - 72 && line3) { ctx.fillText(line3, 36, ly); line3 = ch; ly += 18 }
                    else line3 = test
                  }
                  if (line3) ctx.fillText(line3, 36, ly)
                  ctx.font = '11px sans-serif'; ctx.fillStyle = '#334155'
                  ctx.fillText('central-masters.vercel.app', W - 220, H - 14)
                  const link = document.createElement('a')
                  link.download = `${athleteForHistory.name}_キャリアカード.png`
                  link.href = canvas.toDataURL('image/png')
                  link.click()
                }
                return (
                  <section className="mb-6 overflow-hidden rounded-2xl border border-indigo-700/50 bg-gradient-to-br from-slate-900 via-indigo-950/30 to-slate-900 shadow-lg shadow-indigo-950/30">
                    <div className="h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500" />
                    <div className="p-5">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-1 text-[10px] font-medium tracking-widest text-indigo-400/70 uppercase">Career Card — セントラルマスターズ水泳大会</div>
                          <div className="flex items-baseline gap-3 flex-wrap">
                            <span className="text-3xl font-black text-white">{athleteForHistory.name}</span>
                            <span className={`text-sm font-bold ${athleteForHistory.gender === '男子' ? 'text-sky-400' : 'text-rose-400'}`}>{athleteForHistory.gender}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">{athleteForHistory.teamName}</div>
                        </div>
                        <button
                          type="button"
                          onClick={handleDownload}
                          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-indigo-600/50 bg-indigo-900/50 px-3 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-800/60 transition-colors"
                          title="PNG ダウンロード"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          PNG
                        </button>
                      </div>

                      <div className="mb-4 grid grid-cols-5 gap-2 rounded-xl border border-slate-700/60 bg-slate-800/40 px-3 py-3">
                        {[['出場', `${athleteAnalysis.meetCount}回`], ['個人', `${athleteAnalysis.individualCount}本`], ['表彰台', `${athleteAnalysis.podiums}回`], ['大会新', `${athleteAnalysis.records}回`], ['得点', `${formatPoints(athleteAnalysis.totalPoints)}pt`]].map(([l, v]) => (
                          <div key={l} className="text-center">
                            <div className="text-sm font-black text-white">{v}</div>
                            <div className="text-[9px] text-slate-500">{l}</div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        {avgDev != null && grade != null && (
                          <div className="flex items-baseline gap-2">
                            <span className={`text-3xl font-black ${gradeColor}`}>{grade}</span>
                            <span className="text-sm text-slate-400">偏差値 <span className="font-bold text-white">{avgDev}</span></span>
                          </div>
                        )}
                        <div className="text-sm text-violet-300">{athleteAnalysis.athleteType.icon} {athleteAnalysis.athleteType.title}</div>
                      </div>

                      {athleteAnalysis.careerSummary && (
                        <p className="mt-3 text-[11px] leading-relaxed text-slate-400 border-t border-slate-700/50 pt-3">{athleteAnalysis.careerSummary}</p>
                      )}
                    </div>
                    <canvas ref={shareCanvasRef} className="hidden" />
                  </section>
                )
              })()}

              <div className="mb-6 grid gap-4 lg:grid-cols-2">
                <section className="overflow-hidden rounded-2xl border border-amber-700/50 bg-amber-950/20">
                  <div className="border-b border-amber-800/40 bg-gradient-to-r from-amber-950/80 to-orange-950/60 px-4 py-3">
                    <h3 className="font-bold text-amber-100">🏅 順位コレクション</h3>
                    <p className="mt-0.5 text-[10px] text-amber-300/70">これまで獲得した順位の回数</p>
                  </div>
                  <div className="space-y-2.5 p-4">
                    {athleteAnalysis.rankCounts.slice(0, 8).map(([rank, count]) => {
                      const maxCount = Math.max(...athleteAnalysis.rankCounts.map((entry) => entry[1]), 1)
                      return (
                        <div key={rank} className="grid grid-cols-[48px_1fr_42px] items-center gap-3 text-xs">
                          <span className={`font-bold ${rank <= 3 ? 'text-amber-300' : 'text-slate-300'}`}>
                            {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}位`}
                          </span>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${rank === 1 ? 'bg-amber-400' : rank === 2 ? 'bg-slate-300' : rank === 3 ? 'bg-orange-500' : 'bg-sky-500'}`}
                              style={{ width: `${count / maxCount * 100}%` }}
                            />
                          </div>
                          <span className="text-right font-mono font-bold text-white">{count}回</span>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-emerald-700/50 bg-emerald-950/20">
                  <div className="border-b border-emerald-800/40 bg-gradient-to-r from-emerald-950/80 to-teal-950/60 px-4 py-3">
                    <h3 className="font-bold text-emerald-100">🤝 チーム貢献度</h3>
                    <p className="mt-0.5 text-[10px] text-emerald-300/70">大会ごとのチーム総得点に占める割合</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
                    {athleteAnalysis.meetPoints.filter((meet) => meet.contribution != null).map((meet) => (
                      <div key={meet.round} className="rounded-xl border border-emerald-800/40 bg-slate-950/30 p-3 text-center">
                        <div
                          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
                          style={{ background: `conic-gradient(#34d399 ${Math.min(meet.contribution ?? 0, 100) * 3.6}deg, #1e293b 0deg)` }}
                        >
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-emerald-300">
                            {meet.contribution?.toFixed(1)}%
                          </div>
                        </div>
                        <div className="mt-2 text-xs font-bold text-white">第{meet.round}回</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{formatPoints(meet.total)}pt獲得</div>
                      </div>
                    ))}
                    {athleteAnalysis.meetPoints.every((meet) => meet.contribution == null) && (
                      <p className="col-span-full py-8 text-center text-xs text-slate-500">チーム得点を算出できる大会がありません</p>
                    )}
                  </div>
                </section>
              </div>

              <section className="mb-6 overflow-hidden rounded-2xl border border-sky-700/50 bg-sky-950/20">
                <div className="border-b border-sky-800/40 bg-gradient-to-r from-sky-950/80 to-indigo-950/60 px-4 py-3">
                  <h3 className="font-bold text-sky-100">📊 大会ごとの獲得得点</h3>
                  <p className="mt-0.5 text-[10px] text-sky-300/70">個人得点＋リレー得点の4分の1を本人分として表示</p>
                </div>
                <div className="overflow-x-auto p-4">
                  <div className="flex min-w-max items-end gap-3" style={{ height: '180px' }}>
                    {athleteAnalysis.meetPoints.map((meet) => {
                      const maxPoints = Math.max(...athleteAnalysis.meetPoints.map((entry) => entry.total), 1)
                      const individualHeight = meet.individual / maxPoints * 120
                      const relayHeight = meet.relay / maxPoints * 120
                      return (
                        <div key={meet.round} className="flex w-16 shrink-0 flex-col items-center justify-end">
                          <span className="mb-1 text-[10px] font-bold text-amber-300">{formatPoints(meet.total)}pt</span>
                          <div className="flex w-9 flex-col-reverse overflow-hidden rounded-t-md bg-slate-800" style={{ height: `${Math.max(individualHeight + relayHeight, 3)}px` }}>
                            <div className="w-full bg-sky-500" style={{ height: `${individualHeight}px` }} title={`個人 ${formatPoints(meet.individual)}pt`} />
                            <div className="w-full bg-violet-500" style={{ height: `${relayHeight}px` }} title={`リレー ${formatPoints(meet.relay)}pt`} />
                          </div>
                          <span className="mt-2 text-[10px] font-bold text-white">第{meet.round}回</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-4 text-[10px]">
                    <span className="flex items-center gap-1 text-sky-300"><span className="h-2 w-2 rounded bg-sky-500" />個人</span>
                    <span className="flex items-center gap-1 text-violet-300"><span className="h-2 w-2 rounded bg-violet-500" />リレー本人分</span>
                  </div>
                </div>
              </section>

              {/* パフォーマンス偏差値 + 種目別ランキングバッジ */}
              {athleteStats != null && athleteStats.length > 0 && (() => {
                const avgDeviation = Math.round(athleteStats.reduce((s, e) => s + e.deviation, 0) / athleteStats.length * 10) / 10
                const grade = avgDeviation >= 65 ? 'SS' : avgDeviation >= 60 ? 'S' : avgDeviation >= 55 ? 'A' : avgDeviation >= 50 ? 'B' : avgDeviation >= 45 ? 'C' : avgDeviation >= 40 ? 'D' : 'E'
                const gradeColor = grade === 'SS' ? 'text-amber-300' : grade === 'S' ? 'text-yellow-300' : grade === 'A' ? 'text-sky-300' : grade === 'B' ? 'text-emerald-300' : grade === 'C' ? 'text-slate-300' : 'text-slate-400'
                return (
                  <div className="mb-6 grid gap-4 lg:grid-cols-2">
                    {/* 偏差値 */}
                    <section className="overflow-hidden rounded-2xl border border-indigo-700/50 bg-indigo-950/20">
                      <div className="border-b border-indigo-800/40 bg-gradient-to-r from-indigo-950/80 to-violet-950/60 px-4 py-3">
                        <h3 className="font-bold text-indigo-100">📊 パフォーマンス偏差値</h3>
                        <p className="mt-0.5 text-[10px] text-indigo-300/70">同性・同年代・同競技の全参加者と比較</p>
                      </div>
                      <div className="p-4">
                        <div className="mb-4 flex items-center gap-4">
                          <div className="text-center">
                            <div className={`text-5xl font-black ${gradeColor}`}>{avgDeviation}</div>
                            <div className="mt-1 text-[10px] text-slate-500">総合偏差値</div>
                          </div>
                          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl font-black ${grade === 'SS' ? 'border-amber-500/50 bg-amber-950/50 text-amber-300' : grade === 'S' ? 'border-yellow-500/50 bg-yellow-950/50 text-yellow-300' : grade === 'A' ? 'border-sky-500/50 bg-sky-950/50 text-sky-300' : grade === 'B' ? 'border-emerald-500/50 bg-emerald-950/50 text-emerald-300' : 'border-slate-600/50 bg-slate-800/50 text-slate-300'}`}>
                            {grade}
                          </div>
                          <div className="flex-1 text-[10px] text-slate-500 leading-relaxed">
                            {grade === 'SS' ? '傑出した成績。このカテゴリーのエリートです' : grade === 'S' ? '非常に高い水準。上位グループで輝いています' : grade === 'A' ? '平均を大きく上回る実力です' : grade === 'B' ? '平均よりやや上の水準' : grade === 'C' ? '平均的な水準' : 'これからの成長が楽しみ'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {athleteStats.slice(0, 5).map((stat, index) => {
                            const barWidth = Math.min(Math.max((stat.deviation - 30) / 40 * 100, 0), 100)
                            const barColor = stat.deviation >= 65 ? 'bg-amber-400' : stat.deviation >= 55 ? 'bg-sky-400' : stat.deviation >= 45 ? 'bg-slate-500' : 'bg-slate-600'
                            return (
                              <div key={`${stat.event}|${stat.poolType}|${stat.ageName}|${index}`} className="grid grid-cols-[1fr_48px] items-center gap-2 text-xs">
                                <div>
                                  <div className="flex items-center justify-between gap-1 mb-0.5">
                                    <span className="text-white truncate">{formatEventDisplay(stat.event)}<span className="ml-1 text-slate-500 text-[9px]">({stat.poolType === '短水路' ? '短' : '長'})</span></span>
                                    <span className={`shrink-0 font-bold ${stat.deviation >= 60 ? 'text-amber-300' : 'text-slate-300'}`}>{stat.deviation}</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
                                  </div>
                                </div>
                                <div className="text-right text-[9px] text-slate-500 whitespace-nowrap">{stat.overallRank}位<br />{stat.totalParticipants}人中</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </section>
                    {/* 競技別ランキング */}
                    <section className="overflow-hidden rounded-2xl border border-rose-700/50 bg-rose-950/20">
                      <div className="border-b border-rose-800/40 bg-gradient-to-r from-rose-950/80 to-pink-950/60 px-4 py-3">
                        <h3 className="font-bold text-rose-100">🏅 競技別ランキング</h3>
                        <p className="mt-0.5 text-[10px] text-rose-300/70">全大会を通じた自己ベストで同性・同年代と比較</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
                        {athleteStats.map((stat, index) => {
                          const isGold = stat.overallRank === 1
                          const isSilver = stat.overallRank === 2
                          const isBronze = stat.overallRank === 3
                          const isTop10pct = stat.overallRank / stat.totalParticipants <= 0.1
                          const borderCls = isGold ? 'border-amber-500/60' : isSilver ? 'border-slate-400/60' : isBronze ? 'border-orange-600/60' : isTop10pct ? 'border-sky-600/40' : 'border-slate-700/40'
                          const bgCls = isGold ? 'bg-amber-950/50' : isSilver ? 'bg-slate-800/50' : isBronze ? 'bg-orange-950/50' : isTop10pct ? 'bg-sky-950/40' : 'bg-slate-900/30'
                          const rankLabel = isGold ? '🥇 1位' : isSilver ? '🥈 2位' : isBronze ? '🥉 3位' : `${stat.overallRank}位`
                          const rankColor = isGold ? 'text-amber-300' : isSilver ? 'text-slate-300' : isBronze ? 'text-orange-400' : isTop10pct ? 'text-sky-300' : 'text-white'
                          return (
                            <div key={`${stat.event}|${stat.poolType}|${stat.ageName}|${index}`} className={`rounded-xl border ${borderCls} ${bgCls} p-2 text-center`}>
                              <div className={`text-sm font-black ${rankColor}`}>{rankLabel}</div>
                              <div className="text-[10px] text-white mt-0.5 font-medium leading-tight">{formatEventDisplay(stat.event)}</div>
                              <div className="text-[9px] text-slate-400 mt-0.5">{stat.poolType === '短水路' ? '短' : '長'} · {stat.ageName}</div>
                              <div className="text-[9px] text-slate-500 mt-0.5">{stat.myBestDisplay} / {stat.totalParticipants}人中</div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  </div>
                )
              })()}

              <div className="mb-6 grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-cyan-700/50 bg-cyan-950/20 p-4">
                  <h3 className="font-bold text-cyan-100">🎯 次の順位まで、あと少し！</h3>
                  <div className="mt-3 space-y-2">
                    {athleteAnalysis.nextRankTargets.slice(0, 4).map((target) => (
                      <div key={`${target.round}-${target.event}-${target.rank}`} className="rounded-xl border border-cyan-800/40 bg-slate-950/30 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-bold text-white">{formatEventDisplay(target.event)}</span>
                          <span className="shrink-0 font-mono text-sm font-black text-cyan-300">あと{target.gap.toFixed(2)}秒</span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">第{target.round}回・{target.rank}位 → {target.nextRank}位</p>
                      </div>
                    ))}
                    {athleteAnalysis.nextRankTargets.length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-500">比較できる上位記録がありません</p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-fuchsia-700/50 bg-fuchsia-950/20 p-4">
                  <h3 className="font-bold text-fuchsia-100">✨ 大会新への最短距離</h3>
                  {athleteAnalysis.closestRecord ? (
                    <div className="mt-4 rounded-xl border border-fuchsia-700/40 bg-slate-950/30 p-4 text-center">
                      <div className="text-sm font-bold text-white">{formatEventDisplay(athleteAnalysis.closestRecord.event)}</div>
                      <div className="mt-2 text-3xl font-black text-fuchsia-300">あと{athleteAnalysis.closestRecord.gap.toFixed(2)}秒</div>
                      <p className="mt-2 text-[11px] text-fuchsia-200/70">次の一本で、歴史が変わるかも。</p>
                    </div>
                  ) : (
                    <p className="py-8 text-center text-xs text-slate-500">大会新との差を算出できる記録がありません</p>
                  )}
                </section>
              </div>

              <section className="mb-6 overflow-hidden rounded-2xl border border-orange-600/50 bg-orange-950/20 shadow-lg shadow-orange-950/20">
                <div className="border-b border-orange-700/40 bg-gradient-to-r from-orange-950/90 via-rose-950/70 to-violet-950/70 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black text-white">🔥 ライバル比較</h3>
                      <p className="mt-0.5 text-[11px] text-orange-200/70">同じ性別・年代・競技で泳いだ選手と、同じ水路の記録を比較します</p>
                    </div>
                    <span className="rounded-full border border-orange-500/30 bg-orange-950/60 px-3 py-1 text-[10px] font-bold text-orange-200">
                      最大3人
                    </span>
                  </div>
                </div>
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select
                      value=""
                      disabled={selectedRivalIds.length >= 3 || rivalCandidates.length === 0}
                      onChange={(event) => {
                        const candidate = rivalCandidates.find((item) => item.id === Number(event.target.value))
                        if (candidate) toggleRival(candidate)
                      }}
                      className="min-w-0 flex-1 rounded-xl border border-orange-700/50 bg-[#333b47] px-3 py-2.5 text-sm text-white outline-none focus:border-orange-400 disabled:opacity-50"
                    >
                      <option value="">
                        {rivalCandidates.length === 0
                          ? '比較できるライバルを探しています…'
                          : selectedRivalIds.length >= 3
                            ? '3人選択済みです'
                            : 'ライバルを選択'}
                      </option>
                      {rivalCandidates
                        .filter((candidate) => !selectedRivalIds.includes(candidate.id))
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}｜{teamDisplayName(candidate.teamName)}｜共通条件 {candidate.sharedEvents}
                          </option>
                        ))}
                    </select>
                    <span className="shrink-0 text-[10px] text-slate-500">候補 {rivalCandidates.length}人</span>
                  </div>

                  {selectedRivalIds.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedRivalIds.map((id, index) => {
                        const candidate = rivalCandidates.find((item) => item.id === id)
                        if (!candidate) return null
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => toggleRival(candidate)}
                            className="flex items-center gap-2 rounded-full border bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-800"
                            style={{ borderColor: RIVAL_COLORS[index + 1] }}
                            title={`${candidate.name}を比較から外す`}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RIVAL_COLORS[index + 1] }} />
                            {candidate.name}
                            <span className="text-slate-500">×</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {rivalLoading && (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-orange-200">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
                      ライバルの記録を集計中…
                    </div>
                  )}

                  {!rivalLoading && selectedRivalIds.length === 0 && (
                    <div className="rounded-xl border border-dashed border-orange-800/50 bg-slate-950/20 py-10 text-center">
                      <div className="text-3xl">🏊‍♂️ ⚡ 🏊‍♀️</div>
                      <p className="mt-3 text-sm font-bold text-orange-100">気になる選手を選んで勝負！</p>
                      <p className="mt-1 text-[11px] text-slate-500">直接対戦や自己ベストの差を見比べられます</p>
                    </div>
                  )}

                  {!rivalLoading && selectedRivalIds.length > 0 && rivalComparison.eventKeys.length === 0 && (
                    <p className="rounded-xl border border-slate-700 py-8 text-center text-xs text-slate-500">
                      同じ競技・同じ水路で比較できる記録がありません
                    </p>
                  )}

                  {!rivalLoading && rivalComparison.eventKeys.length > 0 && (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="text-xs font-bold text-orange-200">比較する競技</label>
                        <select
                          value={rivalEventKey || rivalComparison.eventKeys[0]}
                          onChange={(event) => setRivalEventKey(event.target.value)}
                          className="min-w-[220px] flex-1 rounded-xl border border-orange-800/50 bg-[#333b47] px-3 py-2 text-sm font-bold text-white outline-none focus:border-orange-400"
                        >
                          {rivalComparison.eventKeys.map((key) => {
                            const [eventName, poolType] = key.split('|')
                            return <option key={key} value={key}>{formatEventDisplay(eventName)}（{poolType}）</option>
                          })}
                        </select>
                      </div>
                      <RivalComparisonChart series={rivalComparison.series} />
                      {(() => {
                        const main = rivalComparison.series[0]
                        if (!main) return null
                        const mainBest = Math.min(...main.points.map((point) => point.seconds))
                        return (
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {rivalComparison.series.slice(1).map((rival, index) => {
                              const rivalBest = Math.min(...rival.points.map((point) => point.seconds))
                              const mainByRound = new Map(main.points.map((point) => [point.round, point.seconds]))
                              const direct = rival.points.filter((point) => mainByRound.has(point.round))
                              const mainWins = direct.filter((point) => (mainByRound.get(point.round) ?? Infinity) < point.seconds).length
                              const rivalWins = direct.filter((point) => point.seconds < (mainByRound.get(point.round) ?? -Infinity)).length
                              const bestDiff = rivalBest - mainBest
                              return (
                                <div key={rival.id} className="rounded-xl border border-slate-700 bg-slate-950/30 p-3">
                                  <div className="flex items-center gap-2">
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RIVAL_COLORS[index + 1] }} />
                                    <span className="font-bold text-white">{rival.name}</span>
                                  </div>
                                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                                    <div className="rounded-lg bg-slate-900/70 px-2 py-2">
                                      <div className={`text-sm font-black ${bestDiff >= 0 ? 'text-cyan-300' : 'text-orange-300'}`}>
                                        {bestDiff === 0 ? '同タイム' : `${Math.abs(bestDiff).toFixed(2)}秒${bestDiff > 0 ? 'リード' : 'ビハインド'}`}
                                      </div>
                                      <div className="mt-0.5 text-[9px] text-slate-500">自己ベスト差</div>
                                    </div>
                                    <div className="rounded-lg bg-slate-900/70 px-2 py-2">
                                      <div className="text-sm font-black text-amber-300">{mainWins}勝–{rivalWins}敗</div>
                                      <div className="mt-0.5 text-[9px] text-slate-500">直接対戦 {direct.length}回</div>
                                    </div>
                                  </div>
                                  <p className="mt-2 text-center text-[10px] text-slate-500">
                                    通算得点差 {formatPoints(Math.abs(main.totalPoints - rival.totalPoints))}pt
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>
              </section>

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

              {/* 記録 collapsible block */}
              <section className="mb-6 overflow-hidden rounded-2xl border border-sky-700/60 bg-sky-950/25 shadow-lg shadow-sky-950/20">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between bg-gradient-to-r from-sky-900/90 to-blue-950/90 px-5 py-4 text-left transition-colors hover:from-sky-800/90 hover:to-blue-900/90 ${athleteDetailOpenSections.has('records') ? 'border-b border-sky-700/60' : ''}`}
                  onClick={() => setAthleteDetailOpenSections(prev => { const n = new Set(prev); n.has('records') ? n.delete('records') : n.add('records'); return n })}
                >
                  <span><span className="mr-2">📋</span><span className="text-base font-black text-white">記録</span><span className="ml-2 text-xs font-medium text-sky-200">全大会のレース結果</span></span>
                  <span className="rounded-full bg-sky-950/80 px-2 py-1 text-xs font-bold text-white">{athleteDetailOpenSections.has('records') ? '▲ 閉じる' : '▼ 開く'}</span>
                </button>
                {athleteDetailOpenSections.has('records') && (
                  <div className="space-y-5 bg-gradient-to-b from-sky-950/35 to-slate-950/20 p-4 sm:p-5">
                    {athleteHistory.map((meet) => (
                      <section key={meet.round} id={`athlete-meet-${meet.round}`} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50">
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
                                  <td className="px-3 py-2 text-slate-200">{formatEventDisplay(result.event)}</td>
                                  <td className="px-3 py-2 text-slate-400">{result.age_group}</td>
                                  <td className="px-3 py-2 text-right font-mono text-white">
                                    {result.time_display != null ? (
                                      <>
                                        {result.time_display}
                                        {result.is_meet_record && <span className="ml-1 text-amber-400">★</span>}
                                      </>
                                    ) : result.disqualification_code != null ? (
                                      <span className="text-red-400 font-semibold text-xs">失格 {result.disqualification_code}</span>
                                    ) : result.is_withdrawal ? (
                                      <span className="text-slate-400 text-xs">棄権</span>
                                    ) : '－'}
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
                                  <td className="px-3 py-2 text-slate-200">{formatEventDisplay(result.event)}</td>
                                  <td className="px-3 py-2 text-slate-400">{result.age_group ?? '－'}</td>
                                  <td className="px-3 py-2 text-right font-mono text-white">
                                    {result.time_display != null ? result.time_display
                                      : result.disqualification_code != null ? (
                                        <span className="text-red-400 font-semibold text-xs">失格 {result.disqualification_code}</span>
                                      ) : result.is_withdrawal ? (
                                        <span className="text-slate-400 text-xs">棄権</span>
                                      ) : '－'}
                                  </td>
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
              </section>

              {/* タイム推移 collapsible block */}
              <section className="mb-6 overflow-hidden rounded-2xl border border-cyan-700/60 bg-cyan-950/25 shadow-lg shadow-cyan-950/20">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between bg-gradient-to-r from-cyan-900/90 to-teal-950/90 px-5 py-4 text-left transition-colors hover:from-cyan-800/90 hover:to-teal-900/90 ${athleteDetailOpenSections.has('trends') ? 'border-b border-cyan-700/60' : ''}`}
                  onClick={() => setAthleteDetailOpenSections(prev => { const n = new Set(prev); n.has('trends') ? n.delete('trends') : n.add('trends'); return n })}
                >
                  <span><span className="mr-2">📈</span><span className="text-base font-black text-white">タイム推移</span><span className="ml-2 text-xs font-medium text-cyan-200">個人・リレーの変化</span></span>
                  <span className="rounded-full bg-cyan-950/80 px-2 py-1 text-xs font-bold text-white">{athleteDetailOpenSections.has('trends') ? '▲ 閉じる' : '▼ 開く'}</span>
                </button>
                {athleteDetailOpenSections.has('trends') && (
                  <div className="bg-gradient-to-b from-cyan-950/30 to-slate-950/20 p-4 sm:p-5">
                    <p className="text-[11px] text-slate-500 mb-3">タイムと順位は個別に表示を切り替えられます。グラフ上側ほど速いタイム・上位の順位です。</p>
                    {athleteAnalysis.trends.length === 0 && athleteAnalysis.relayTrends.length === 0 ? (
                      <p className="rounded-xl border border-slate-700 py-10 text-center text-sm text-slate-500">
                        タイム推移を表示できる記録がありません
                      </p>
                    ) : (
                      <div className="space-y-5">
                        {athleteAnalysis.trends.length > 0 && (
                          <section>
                            <h3 className="mb-2 text-sm font-bold text-sky-300">個人競技</h3>
                            <div className="grid gap-4 lg:grid-cols-2">
                              {athleteAnalysis.trends.map((trend) => (
                                <AthleteTrendCard key={trend.key} trend={trend} />
                              ))}
                            </div>
                          </section>
                        )}
                        {athleteAnalysis.relayTrends.length > 0 && (
                          <section>
                            <h3 className="mb-2 text-sm font-bold text-indigo-300">リレー（担当泳順・スプリットタイム）</h3>
                            <div className="grid gap-4 lg:grid-cols-2">
                              {athleteAnalysis.relayTrends.map((trend) => (
                                <AthleteTrendCard key={trend.key} trend={trend} />
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 年代順位 collapsible block */}
              {(() => {
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
                const allRelayResults = athleteHistory
                  .flatMap((meet) =>
                    meet.relay.map((r) => ({ ...r, round: meet.round, poolType: meet.pool_type }))
                  )
                  .sort((a, b) => {
                    const eventOrder = compareEventNames(a.event, b.event)
                    if (eventOrder !== 0) return eventOrder
                    const ra = a.rank ?? 9999
                    const rb = b.rank ?? 9999
                    return ra - rb || b.round - a.round
                  })
                return (
                  <section className="mb-6 overflow-hidden rounded-2xl border border-violet-700/60 bg-violet-950/25 shadow-lg shadow-violet-950/20">
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between bg-gradient-to-r from-violet-900/90 to-indigo-950/90 px-5 py-4 text-left transition-colors hover:from-violet-800/90 hover:to-indigo-900/90 ${athleteDetailOpenSections.has('age-rank') ? 'border-b border-violet-700/60' : ''}`}
                      onClick={() => setAthleteDetailOpenSections(prev => { const n = new Set(prev); n.has('age-rank') ? n.delete('age-rank') : n.add('age-rank'); return n })}
                    >
                      <span><span className="mr-2">🏅</span><span className="text-base font-black text-white">年代順位</span><span className="ml-2 text-xs font-medium text-violet-200">全レースの順位情報</span></span>
                      <span className="rounded-full bg-violet-950/80 px-2 py-1 text-xs font-bold text-white">{athleteDetailOpenSections.has('age-rank') ? '▲ 閉じる' : '▼ 開く'}</span>
                    </button>
                    {athleteDetailOpenSections.has('age-rank') && (
                      allIndResults.length === 0 && allRelayResults.length === 0 ? (
                        <p className="rounded-xl border border-slate-700 py-10 text-center text-sm text-slate-500">
                          レース記録がありません
                        </p>
                      ) : (
                        <div className="bg-gradient-to-b from-violet-950/30 to-slate-950/20 p-4 sm:p-5">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-[11px] text-slate-500">全大会の個人・リレーレースを表示</p>
                            <p className="text-[10px] text-sky-600">行クリック → 年代別順位タブへ移動</p>
                          </div>
                          {allIndResults.length > 0 && <div className="overflow-x-auto rounded-xl border border-slate-700">
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
                                      <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{formatEventDisplay(r.event)}</td>
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
                          </div>}
                          {allRelayResults.length > 0 && (
                            <div className="mt-4 overflow-x-auto rounded-xl border border-indigo-800/60">
                              <div className="bg-indigo-950/70 px-3 py-2 text-xs font-bold text-indigo-200">リレー記録</div>
                              <table className="w-full min-w-[720px] text-xs">
                                <thead>
                                  <tr className="border-b border-indigo-800/50 bg-gradient-to-r from-indigo-950 to-sky-950 text-left">
                                    <th className="px-3 py-2.5 text-center font-semibold text-white">順位</th>
                                    <th className="px-3 py-2.5 font-semibold text-white">大会</th>
                                    <th className="px-3 py-2.5 font-semibold text-white">競技名</th>
                                    <th className="px-3 py-2.5 font-semibold text-white">泳順・担当</th>
                                    <th className="px-3 py-2.5 font-semibold text-white">年齢区分</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-white">スプリット</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-white">リレータイム</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {allRelayResults.map((result, index) => (
                                    <tr
                                      key={`relay-rank-${result.round}-${result.event}-${index}`}
                                      className="cursor-pointer border-t border-slate-800 hover:bg-indigo-950/40"
                                      onClick={() => handleJumpToAgeRank(result.round, result.event, result.age_group ?? '', true)}
                                      title="年代別順位タブで同条件を表示"
                                    >
                                      <td className="px-3 py-2 text-center text-amber-300">{result.rank != null ? `${result.rank}位` : '－'}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-white">第{result.round}回</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-indigo-200">{formatEventDisplay(result.event)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-white">
                                        {result.swim_order != null ? `${result.swim_order}泳` : '－'}
                                        {result.stroke && <span className="ml-1 text-cyan-300">{result.stroke}</span>}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-white">{result.age_group ?? '－'}</td>
                                      <td className="px-3 py-2 text-right font-mono text-cyan-300">{formatSplitTime(result.split_seconds)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-white">{result.time_display ?? '－'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </section>
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
  const ageRankEventSections = useMemo(() => {
    const sections = new Map<string, {
      key: string
      name: string
      type: '個人' | 'リレー'
      individual: IndividualResult[]
      relay: RelayResult[]
    }>()
    for (const result of ageRankResults) {
      const name = result.mst_category.name
      const key = `individual:${name}`
      const section = sections.get(key) ?? { key, name, type: '個人' as const, individual: [], relay: [] }
      section.individual.push(result)
      sections.set(key, section)
    }
    for (const result of ageRankRelayResults) {
      const name = result.mst_category.name
      const isMixed = result.mst_category.gender === '混合'
      const key = `relay:${name}:${isMixed ? 'mixed' : 'standard'}`
      const section = sections.get(key) ?? { key, name, type: 'リレー' as const, individual: [], relay: [] }
      section.relay.push(result)
      sections.set(key, section)
    }
    return [...sections.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === '個人' ? -1 : 1
      const eventA = parseEventName(a.name)
      const eventB = parseEventName(b.name)
      return eventA.typeIdx - eventB.typeIdx || eventA.distNum - eventB.distNum || a.name.localeCompare(b.name, 'ja')
    })
  }, [ageRankResults, ageRankRelayResults])

  const ageRankGenerationStats = useMemo(() => {
    const generations = new Map<string, {
      age: string
      races: number
      wins: number
      podiums: number
      records: number
      points: number
      athletes: Set<number>
      athleteScores: Map<number, { name: string; team: string; points: number; wins: number; podiums: number; records: number }>
    }>()
    for (const result of ageRankResults) {
      const age = result.mst_age?.name ?? '年齢区分なし'
      const current = generations.get(age) ?? {
        age, races: 0, wins: 0, podiums: 0, records: 0, points: 0,
        athletes: new Set<number>(),
        athleteScores: new Map(),
      }
      const athleteId = result.player_id
      const points = Number(result.points ?? 0)
      current.races += 1
      current.wins += result.rank === 1 ? 1 : 0
      current.podiums += result.rank != null && result.rank <= 3 ? 1 : 0
      current.records += result.is_meet_record ? 1 : 0
      current.points += points
      current.athletes.add(athleteId)
      const athlete = current.athleteScores.get(athleteId) ?? {
        name: result.dt_player_person.name,
        team: result.dt_player_person.mst_team.name,
        points: 0,
        wins: 0,
        podiums: 0,
        records: 0,
      }
      athlete.points += points
      athlete.wins += result.rank === 1 ? 1 : 0
      athlete.podiums += result.rank != null && result.rank <= 3 ? 1 : 0
      athlete.records += result.is_meet_record ? 1 : 0
      current.athleteScores.set(athleteId, athlete)
      generations.set(age, current)
    }
    return [...generations.values()]
      .map((generation) => ({
        ...generation,
        athleteCount: generation.athletes.size,
        mvp: [...generation.athleteScores.values()].sort((a, b) =>
          b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.name.localeCompare(b.name, 'ja')
        )[0],
      }))
      .sort((a, b) => {
        const ageA = Number(a.age.match(/\d+/)?.[0] ?? 999)
        const ageB = Number(b.age.match(/\d+/)?.[0] ?? 999)
        return ageA - ageB || a.age.localeCompare(b.age, 'ja')
      })
  }, [ageRankResults])
  const ageRankMaxRaces = Math.max(1, ...ageRankGenerationStats.map((generation) => generation.races))
  const ageRankHottestGeneration = [...ageRankGenerationStats].sort((a, b) =>
    b.races - a.races || b.athleteCount - a.athleteCount
  )[0]
  const ageRankRecordGeneration = [...ageRankGenerationStats].sort((a, b) =>
    b.records - a.records || b.wins - a.wins
  )[0]

  const ageRankAllEventsView = (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">第{ageRankCurrentMeet?.round}回 全競技</h2>
          <p className="mt-0.5 text-xs text-slate-500">競技名を押すと一覧を開閉できます</p>
        </div>
        <span className="shrink-0 text-xs text-slate-400">{ageRankResults.length + ageRankRelayResults.length}件</span>
      </div>
      {ageRankGenerationStats.length > 0 && (
        <div className="mb-5 space-y-4">
          <section className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/80 via-slate-950 to-cyan-950/70">
            <div className="border-b border-emerald-500/20 px-4 py-3">
              <h3 className="font-bold text-white">🌊 年代別パワーマップ</h3>
              <p className="mt-0.5 text-[11px] text-emerald-200/60">長いバーほど出場レースが多い、今大会の熱い世代です</p>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {ageRankGenerationStats.map((generation) => (
                <div key={generation.age} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-emerald-100">{generation.age}</span>
                    <span className="text-[10px] text-slate-400">
                      {generation.athleteCount}名・{generation.races}レース
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-400"
                      style={{ width: `${Math.max(8, (generation.races / ageRankMaxRaces) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex gap-3 text-[10px]">
                    <span className="text-amber-300">🥇 {generation.wins}</span>
                    <span className="text-orange-200">表彰台 {generation.podiums}</span>
                    <span className="text-fuchsia-300">大会新 {generation.records}</span>
                    <span className="ml-auto text-cyan-200">{formatPoints(generation.points)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            {ageRankHottestGeneration && (
              <div className="rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-950/70 to-slate-950 p-4">
                <p className="text-[11px] font-bold text-orange-300">🔥 今大会で最も熱い世代</p>
                <p className="mt-1 text-xl font-black text-white">{ageRankHottestGeneration.age}</p>
                <p className="mt-1 text-xs text-slate-300">{ageRankHottestGeneration.athleteCount}名が{ageRankHottestGeneration.races}レースに挑戦</p>
              </div>
            )}
            {ageRankRecordGeneration && ageRankRecordGeneration.records > 0 && (
              <div className="rounded-xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-950/70 to-slate-950 p-4">
                <p className="text-[11px] font-bold text-fuchsia-300">⚡ 記録クラッシャー世代</p>
                <p className="mt-1 text-xl font-black text-white">{ageRankRecordGeneration.age}</p>
                <p className="mt-1 text-xs text-slate-300">大会新を{ageRankRecordGeneration.records}個更新</p>
              </div>
            )}
          </div>

          <section className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-4">
            <div className="mb-3">
              <h3 className="font-bold text-white">👑 世代MVP</h3>
              <p className="mt-0.5 text-[11px] text-violet-200/60">各年齢区分で最も多く得点した選手</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ageRankGenerationStats.filter((generation) => generation.mvp).map((generation) => (
                <div key={generation.age} className="rounded-xl border border-violet-400/15 bg-slate-950/60 p-3">
                  <div className="text-[10px] font-bold text-violet-300">{generation.age}</div>
                  <div className="mt-1 font-bold text-white">{generation.mvp.name}</div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="truncate text-[10px] text-slate-500">{teamDisplayName(generation.mvp.team)}</span>
                    <span className="shrink-0 font-mono text-xs font-bold text-amber-300">{formatPoints(generation.mvp.points)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      <div className="space-y-3">
        {ageRankEventSections.map((section) => {
          const closed = ageRankClosedEvents.has(section.key)
          const count = section.individual.length + section.relay.length
          return (
            <section key={section.key} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50">
              <button
                type="button"
                onClick={() => setAgeRankClosedEvents((current) => {
                  const next = new Set(current)
                  if (next.has(section.key)) next.delete(section.key)
                  else next.add(section.key)
                  return next
                })}
                className="flex w-full items-center gap-3 bg-gradient-to-r from-sky-950/90 to-indigo-950/70 px-4 py-3 text-left transition-colors hover:from-sky-900/90 hover:to-indigo-900/70"
              >
                <span className="text-xs text-sky-400">{closed ? '▶' : '▼'}</span>
                <span className="font-bold text-white">
                  {formatEventDisplay(section.name)}
                  {section.type === 'リレー' && section.relay.some((result) => result.mst_category.gender === '混合') && (
                    <span className="ml-2 text-purple-300">混合</span>
                  )}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${section.type === '個人' ? 'bg-sky-900 text-sky-300' : 'bg-indigo-900 text-indigo-300'}`}>
                  {section.type}
                </span>
                <span className="ml-auto text-xs text-slate-400">{count}件</span>
              </button>
              {!closed && section.type === '個人' && (
                <div className="space-y-3 p-3">
                  {[...new Map(section.individual.map((result) => {
                    const gender = genderDisplay(result.dt_player_person.gender)
                    const age = result.mst_age?.name ?? '年齢区分なし'
                    const key = `${gender}:${age}`
                    return [key, { key, gender, age }]
                  })).values()]
                    .sort((a, b) => {
                      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender, 'ja')
                      return Number(a.age.match(/\d+/)?.[0] ?? 999) - Number(b.age.match(/\d+/)?.[0] ?? 999)
                    })
                    .map((division) => {
                      const divisionResults = section.individual
                        .filter((result) =>
                          genderDisplay(result.dt_player_person.gender) === division.gender
                          && (result.mst_age?.name ?? '年齢区分なし') === division.age
                        )
                        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
                      return (
                        <div key={division.key} className="overflow-hidden rounded-xl border border-sky-800/30 bg-slate-950/40">
                          <div className="flex items-center gap-2 border-b border-sky-900/40 bg-sky-950/40 px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${division.gender === '男子' ? 'bg-sky-500/15 text-sky-300' : 'bg-rose-500/15 text-rose-300'}`}>
                              {division.gender}
                            </span>
                            <span className="font-bold text-white">{division.age}</span>
                            <span className="ml-auto text-[10px] text-slate-500">{divisionResults.length}名</span>
                          </div>
                          <div className="grid gap-2 p-3 sm:grid-cols-3">
                            {divisionResults.slice(0, 3).map((result, index) => (
                              <button
                                key={result.id}
                                type="button"
                                onClick={() => handleAthleteClick(result)}
                                className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 ${
                                  index === 0
                                    ? 'border-amber-400/40 bg-amber-500/10'
                                    : index === 1
                                      ? 'border-slate-400/30 bg-slate-400/10'
                                      : 'border-orange-700/30 bg-orange-900/10'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-lg">{index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</span>
                                  <span className="font-mono text-sm font-bold text-white">{result.time_display ?? '－'}</span>
                                </div>
                                <div className="mt-2 font-bold text-sky-200">{result.dt_player_person.name}</div>
                                <div className="mt-0.5 truncate text-[10px] text-slate-500">{teamDisplayName(result.dt_player_person.mst_team.name)}</div>
                              </button>
                            ))}
                          </div>
                          {divisionResults.length > 3 && (
                            <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-400">
                              {divisionResults.slice(3).map((result) => (
                                <button
                                  key={result.id}
                                  type="button"
                                  onClick={() => handleAthleteClick(result)}
                                  className="mr-3 inline-flex items-center gap-1 py-1 hover:text-sky-300"
                                >
                                  <span>{result.rank ?? '－'}位</span>
                                  <span>{result.dt_player_person.name}</span>
                                  <span className="font-mono text-slate-500">{result.time_display ?? '－'}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
              {!closed && section.type === 'リレー' && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-center">順位</th>
                        <th className="px-3 py-2 text-left">区分</th>
                        <th className="px-3 py-2 text-left">年齢区分</th>
                        <th className="px-3 py-2 text-left">チーム</th>
                        <th className="px-3 py-2 text-right">タイム</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...section.relay].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)).map((result) => (
                        <tr key={result.id} className="border-t border-slate-800 hover:bg-indigo-950/40">
                          <td className="px-3 py-2 text-center text-amber-300">{result.rank != null ? `${result.rank}位` : '－'}</td>
                          <td className="px-3 py-2 text-slate-300">{genderDisplay(result.mst_category.gender)}</td>
                          <td className="px-3 py-2 text-slate-400">{result.age_group_label ?? '－'}</td>
                          <td className="px-3 py-2 text-indigo-300">{teamDisplayName(result.mst_team.name)}</td>
                          <td className="px-3 py-2 text-right font-mono text-white">{result.time_display ?? '－'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )

  // ── Results area ─────────────────────────────────────────────
  const resultsArea = (
    <div data-results-scroll className="h-full overflow-y-auto flex flex-col">
      {tournamentTitle}
      {glowingTabTitle}
      {activeTab === 'results' && (
        <div className="sticky top-0 z-20 shrink-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/50 px-3 py-2 space-y-1.5">
          {/* 大会クイックセレクター */}
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setMeetId(null)}
              className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors ${!meetId ? 'bg-sky-500/20 border-sky-500/60 text-sky-300' : 'border-slate-600 text-slate-500 hover:text-slate-200 hover:border-slate-500'}`}
            >
              全大会
            </button>
            {meets.map((m) => {
              const isLatest = m.round === Math.max(...meets.map((x) => x.round))
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMeetId(m.id)}
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors ${meetId === m.id ? 'bg-sky-500/20 border-sky-500/60 text-sky-300' : 'border-slate-600 text-slate-500 hover:text-slate-200 hover:border-slate-500'}`}
                >
                  {isLatest ? `★ 第${m.round}回` : `第${m.round}回`}
                </button>
              )
            })}
          </div>
          {/* 種目ピル + 距離チップ */}
          {strokePills.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {strokePills.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => { setQuickStroke(quickStroke === p.name ? null : p.name); setQuickDist(null) }}
                    className={`flex-shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors ${quickStroke === p.name ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-300' : 'border-slate-600 text-slate-500 hover:text-slate-200 hover:border-slate-500'}`}
                  >
                    <span>{STROKE_ICONS[p.name] ?? ''}</span>
                    <span>{p.name}</span>
                    <span className="text-[9px] text-slate-500">{p.count}</span>
                  </button>
                ))}
              </div>
              {distChips.length > 0 && (
                <>
                  <div className="w-px h-4 bg-slate-700 shrink-0" />
                  <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {distChips.map(({ dist }) => (
                      <button
                        key={dist}
                        type="button"
                        onClick={() => setQuickDist(quickDist === dist ? null : dist)}
                        className={`flex-shrink-0 rounded px-2 py-1 text-[11px] font-bold border transition-colors ${quickDist === dist ? 'bg-slate-600 border-slate-400 text-white' : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500'}`}
                      >
                        {dist}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 p-4 pb-24">
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
              const sortedCurrentStandings = [...teamStandings].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
              const championStanding = sortedCurrentStandings.find((standing) => standing.rank === 1) ?? sortedCurrentStandings[0]
              const currentRank = currentStanding?.rank ?? null
              const nextStanding = currentRank != null && currentRank > 1
                ? sortedCurrentStandings.find((standing) => standing.rank === currentRank - 1)
                : null
              const chasingStanding = currentRank != null
                ? sortedCurrentStandings.find((standing) => standing.rank === currentRank + 1)
                : null
              const pointsToNext = nextStanding
                ? Math.max(0, Number(nextStanding.total_points ?? 0) - currentTotal)
                : 0
              const leadOverChaser = chasingStanding
                ? Math.max(0, currentTotal - Number(chasingStanding.total_points ?? 0))
                : 0
              const previousRoundByTeam = new Map<string, TeamStanding>()
              for (const standing of teamHistoryStandings) {
                const round = standing.mst_event?.round ?? 0
                if (round >= (currentMeet?.round ?? 0)) continue
                const key = normalizeOptionName(standing.mst_team.name)
                const existing = previousRoundByTeam.get(key)
                if (!existing || (existing.mst_event?.round ?? 0) < round) previousRoundByTeam.set(key, standing)
              }
              const biggestClimber = sortedCurrentStandings
                .map((standing) => {
                  const previous = previousRoundByTeam.get(normalizeOptionName(standing.mst_team.name))
                  const change = previous?.rank != null && standing.rank != null ? previous.rank - standing.rank : 0
                  return { standing, previous, change }
                })
                .sort((a, b) => b.change - a.change || (a.standing.rank ?? 9999) - (b.standing.rank ?? 9999))[0]
              const individualTeamPoints = results.reduce((sum, result) => {
                const rankPoints = result.rank != null && result.rank >= 1 && result.rank <= 10 ? 11 - result.rank : 0
                return sum + rankPoints + (result.is_meet_record ? 10 : 0) + (result.is_japan_record ? 10 : 0) + (result.is_world_record ? 10 : 0)
              }, 0)
              const relayTeamPoints = relayResults.reduce((sum, result) => {
                const rankPoints = result.rank != null && result.rank >= 1 && result.rank <= 10 ? 11 - result.rank : 0
                return sum + rankPoints + (result.is_meet_record ? 10 : 0)
              }, 0)
              const calculatedTeamPoints = individualTeamPoints + relayTeamPoints
              const relayRatio = calculatedTeamPoints > 0 ? relayTeamPoints / calculatedTeamPoints : 0
              const maleRatio = currentTotal > 0 ? Number(currentStanding?.male_points ?? 0) / currentTotal : 0
              const femaleRatio = currentTotal > 0 ? Number(currentStanding?.female_points ?? 0) / currentTotal : 0
              const mixedRatio = currentTotal > 0 ? Number(currentStanding?.mixed_points ?? 0) / currentTotal : 0
              const topPlayerRatio = meetPlayerTotal > 0 ? (meetPlayerScores[0]?.points ?? 0) / meetPlayerTotal : 0
              const teamType = relayRatio >= 0.32
                ? { icon: '🤝', title: 'リレー王国', description: `得点の${Math.round(relayRatio * 100)}%をリレーで獲得。チームの絆が最大の武器！`, color: 'from-violet-950/80 to-indigo-950/60 border-violet-500/40' }
                : femaleRatio >= 0.55
                  ? { icon: '🌹', title: '女子パワー型', description: `女子得点が全体の${Math.round(femaleRatio * 100)}%。華やかにチームを牽引！`, color: 'from-rose-950/80 to-fuchsia-950/60 border-rose-500/40' }
                  : maleRatio >= 0.65
                    ? { icon: '⚡', title: '男子突破型', description: `男子得点が全体の${Math.round(maleRatio * 100)}%。力強く順位を押し上げる！`, color: 'from-sky-950/80 to-cyan-950/60 border-sky-500/40' }
                    : mixedRatio >= 0.2
                      ? { icon: '🧩', title: '混合の絆型', description: `混合得点が全体の${Math.round(mixedRatio * 100)}%。男女の力を合わせて勝負！`, color: 'from-purple-950/80 to-fuchsia-950/60 border-purple-500/40' }
                      : topPlayerRatio <= 0.22 && meetPlayerScores.length >= 6
                        ? { icon: '🌊', title: '全員得点型', description: `${meetPlayerScores.length}名で得点を積み上げる、層の厚いチーム！`, color: 'from-emerald-950/80 to-teal-950/60 border-emerald-500/40' }
                        : { icon: '⚖️', title: 'バランス型', description: '男女・個人・リレーで着実に得点を重ねる総合力タイプ！', color: 'from-amber-950/80 to-orange-950/60 border-amber-500/40' }
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
                    <div className="sticky top-0 z-20 mb-4 hidden rounded-xl border border-amber-500/70 bg-gradient-to-r from-amber-950 to-yellow-950 px-3 py-2 shadow-lg shadow-amber-950/40 md:block md:px-5 md:py-4">
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
                    <section className="overflow-hidden rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-950/70 via-slate-950 to-orange-950/50 shadow-xl shadow-amber-950/20">
                      <div className="border-b border-amber-500/20 px-4 py-3">
                        <h3 className="font-bold text-white">🎉 第{currentMeet.round}回 チーム順位ダイジェスト</h3>
                        <p className="mt-0.5 text-[11px] text-amber-200/60">優勝争い、逆転条件、チームの個性をまとめてチェック</p>
                      </div>
                      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 p-3">
                          <p className="text-[10px] font-bold text-yellow-300">🏆 総合チャンピオン</p>
                          <p className="mt-1 truncate text-lg font-black text-white">{teamDisplayName(championStanding?.mst_team.name ?? '－')}</p>
                          <p className="mt-1 font-mono text-xs font-bold text-yellow-200">{formatPoints(Number(championStanding?.total_points ?? 0))}pt</p>
                        </div>
                        <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3">
                          <p className="text-[10px] font-bold text-cyan-300">{currentStanding.rank === 1 ? '🛡️ 首位防衛ライン' : '🎯 次の順位まで'}</p>
                          {currentStanding.rank === 1 ? (
                            <>
                              <p className="mt-1 text-lg font-black text-white">リード {formatPoints(leadOverChaser)}pt</p>
                              <p className="mt-1 truncate text-[10px] text-slate-400">2位 {teamDisplayName(chasingStanding?.mst_team.name ?? '－')}との差</p>
                            </>
                          ) : (
                            <>
                              <p className="mt-1 text-lg font-black text-white">あと {formatPoints(pointsToNext)}pt</p>
                              <p className="mt-1 truncate text-[10px] text-slate-400">{nextStanding?.rank ?? '－'}位 {teamDisplayName(nextStanding?.mst_team.name ?? '－')}を追走中</p>
                            </>
                          )}
                        </div>
                        <div className={`rounded-xl border bg-gradient-to-br p-3 ${teamType.color}`}>
                          <p className="text-[10px] font-bold text-slate-300">{teamType.icon} チームタイプ診断</p>
                          <p className="mt-1 text-lg font-black text-white">{teamType.title}</p>
                          <p className="mt-1 text-[10px] leading-relaxed text-slate-300">{teamType.description}</p>
                        </div>
                        <button
                          type="button"
                          disabled={!meetPlayerScores[0]}
                          onClick={() => {
                            const mvp = meetPlayerScores[0]
                            if (!mvp) return
                            fetchAthleteHistory(mvp.playerId, mvp.name, mvp.gender, selectedTeam?.name ?? '')
                            setMobileDrawerOpen(true)
                          }}
                          className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-left transition hover:-translate-y-0.5 hover:bg-emerald-500/15 disabled:cursor-default"
                        >
                          <p className="text-[10px] font-bold text-emerald-300">👑 チームMVP</p>
                          <p className="mt-1 truncate text-lg font-black text-white">{meetPlayerScores[0]?.name ?? '－'}</p>
                          <p className="mt-1 font-mono text-xs font-bold text-emerald-200">{formatPoints(meetPlayerScores[0]?.points ?? 0)}pt</p>
                        </button>
                      </div>
                      {biggestClimber && biggestClimber.change > 0 && (
                        <div className="border-t border-amber-500/15 bg-black/15 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="font-bold text-orange-300">🚀 急上昇チーム</span>
                            <span className="font-bold text-white">{teamDisplayName(biggestClimber.standing.mst_team.name)}</span>
                            <span className="text-emerald-300">前回から {biggestClimber.change}ランクアップ</span>
                            <span className="text-slate-500">
                              {biggestClimber.previous?.rank ?? '－'}位 → {biggestClimber.standing.rank ?? '－'}位
                            </span>
                          </div>
                        </div>
                      )}
                    </section>

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

                    <div className="overflow-hidden rounded-xl border border-violet-600/50 bg-violet-950/25 shadow-lg shadow-violet-950/20">
                      <button
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-violet-950/90 to-fuchsia-950/70 hover:from-violet-900/90 hover:to-fuchsia-900/70 transition-colors"
                        onClick={() => setScoreBreakdownOpen((v) => !v)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-1 h-4 rounded bg-violet-400 shrink-0" />
                          <h3 className="text-sm font-bold text-violet-100">{focusTeamDisplayName}　第{currentMeet.round}回 得点構成</h3>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-sm font-bold text-amber-300">{formatPoints(currentTotal)}pt</span>
                          <span className="text-slate-400 text-xs">{scoreBreakdownOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>
                      {scoreBreakdownOpen && (
                        <div className="space-y-3 bg-violet-950/20 px-4 py-3">
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
                  <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-sky-600/50 bg-sky-950/25 shadow-lg shadow-sky-950/20">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 bg-gradient-to-r from-sky-950/90 to-cyan-950/70 px-4 py-3 text-left transition-colors hover:from-sky-900/90 hover:to-cyan-900/70"
                      onClick={() => setTeamTableOpen((v) => !v)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
                        <h3 className="text-sm font-bold text-sky-100">
                          第{currentMeet?.round}回 全チーム順位
                        </h3>
                      </div>
                      <span className="text-xs text-slate-300">
                        {teamTableOpen ? '▲' : '▼'}
                      </span>
                    </button>
                    {teamTableOpen && (
                    <div className="bg-sky-950/15 p-3">
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
                    )}
                  </div>

                  {meetPlayerScores.length > 0 && (
                    <div className="w-full overflow-hidden rounded-xl border border-emerald-600/50 bg-emerald-950/25 shadow-lg shadow-emerald-950/20 md:w-72 md:shrink-0">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 bg-gradient-to-r from-emerald-950/90 to-teal-950/70 px-4 py-3 text-left transition-colors hover:from-emerald-900/90 hover:to-teal-900/70"
                        onClick={() => setPlayerScoresOpen((open) => !open)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-4 w-1 shrink-0 rounded bg-emerald-400" />
                          <h3 className="text-sm font-bold text-emerald-100">{focusTeamDisplayName} 取得得点</h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-sm font-bold text-amber-300">{formatPoints(meetPlayerTotal)}pt</span>
                          <span className="text-xs text-slate-300">{playerScoresOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>
                      {playerScoresOpen && (
                      <div className="bg-emerald-950/20 p-4">
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
                      )}
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
            <div className="sticky top-0 z-20 -mx-3 mb-5 border-b border-slate-800/80 bg-slate-900/95 px-3 py-3 text-center backdrop-blur">
              <div className="inline-flex items-center gap-3">
                <span className="text-amber-400 text-base animate-pulse select-none">✦✦</span>
                <h2 className="text-2xl font-black bg-gradient-to-r from-amber-400 via-yellow-100 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_16px_rgba(251,191,36,0.5)]">
                  大会新一覧
                </h2>
                <span className="text-amber-400 text-base animate-pulse select-none">✦✦</span>
              </div>
              {mrMainView === 'records' && (
                <div className="mt-2 flex items-center justify-center gap-1.5 sm:absolute sm:right-3 sm:top-3 sm:mt-0">
                  <button
                    type="button"
                    onClick={() => {
                      setMrClosedCourses(new Set())
                      setMrClosedEvents(new Set())
                    }}
                    className="rounded-lg border border-emerald-700/60 bg-emerald-950/70 px-2.5 py-1.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-900/80"
                  >
                    全て開く
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMrClosedCourses(new Set(['短水路', '長水路']))
                      setMrClosedEvents(new Set([
                        ...Array.from(mrGroupedByEvent.short.keys()).map((key) => `短水路:${key}`),
                        ...Array.from(mrGroupedByEvent.long.keys()).map((key) => `長水路:${key}`),
                      ]))
                    }}
                    className="rounded-lg border border-slate-600 bg-[#333b47] px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-600"
                  >
                    全て閉じる
                  </button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/30 px-3 py-2">
                {([['records', '記録一覧'], ['ranking', '保持順位']] as const).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setMrMainView(val)}
                    className={`text-xs font-bold rounded px-2.5 py-0.5 transition-colors ${
                      mrMainView === val
                        ? 'bg-amber-700/80 text-amber-200'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                    }`}
                  >{label}</button>
                ))}
                {mrMainView === 'records' && (
                  <>
                    {(['短水路', '長水路'] as const).map((val) => (
                      <button key={val} type="button" onClick={() => setMrCourse(mrCourse === val ? '' : val)}
                        className={`text-xs font-bold rounded px-2.5 py-0.5 transition-colors ${
                          mrCourse === val
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                        }`}
                      >{val}</button>
                    ))}
                    <span className="text-slate-600">|</span>
                  </>
                )}
                {mrMainView === 'records' && <span className="rounded bg-sky-950/80 px-2 py-1 text-xs font-bold text-sky-200">水路：{mrCourse || '両方'}</span>}
                {mrMainView === 'records' && <span className="rounded bg-slate-800 px-2 py-1 text-xs font-bold text-white">競技：{mrEvent ? formatEventDisplay(mrEvent) : '全競技'}</span>}
                {mrMainView === 'records' && <span className={`rounded px-2 py-1 text-xs font-bold ${mrGender === '男性' ? 'text-sky-300 bg-sky-950/60 border border-sky-800/50' : mrGender === '女性' ? 'text-rose-300 bg-rose-950/60 border border-rose-800/50' : mrGender === '混合' ? 'text-purple-300 bg-purple-950/60 border border-purple-800/50' : 'bg-slate-800 text-white'}`}>性別：{mrGender || 'すべて'}</span>}
                {mrMainView === 'records' && <span className="rounded bg-slate-800 px-2 py-1 text-xs font-bold text-white">年齢：{mrAgeGroup ? ageGroupLabel(Number(mrAgeGroup)) : 'すべて'}</span>}
                {mrMainView === 'records' && <span className="text-xs font-bold text-amber-300">{mrFiltered.length}件</span>}
                {mrMainView === 'ranking' && <span className="text-xs font-bold text-amber-300">{mrAthleteRanking.length}名</span>}
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
              <p className="py-12 text-center text-sm text-slate-500">大会新記録が登録されていません</p>
            ) : mrFiltered.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">条件に一致する記録がありません</p>
            ) : (
              <div>
                {/* 保持順位ビュー */}
                {mrMainView === 'ranking' ? (() => {
                  const sortedRanking = [...mrAthleteRanking].sort((a, b) => {
                    const { field, dir } = mrRankSort
                    let cmp = 0
                    if (field === 'rank' || field === 'total') cmp = b.total - a.total
                    else if (field === 'name') cmp = a.name.localeCompare(b.name, 'ja')
                    else if (field === 'gender') cmp = a.gender.localeCompare(b.gender, 'ja')
                    else if (field === 'team') cmp = a.teamName.localeCompare(b.teamName, 'ja')
                    else if (field === 'short') cmp = b.shortCount - a.shortCount
                    else if (field === 'long') cmp = b.longCount - a.longCount
                    return dir === 'asc' ? -cmp : cmp
                  })
                  const RankTh = ({ field, children, className }: { field: typeof mrRankSort.field; children: React.ReactNode; className?: string }) => {
                    const active = mrRankSort.field === field
                    return (
                      <th
                        className={`px-3 py-2 text-xs cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap ${active ? 'text-amber-300' : 'text-slate-400'} ${className ?? ''}`}
                        onClick={() => setMrRankSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'total' || field === 'short' || field === 'long' ? 'desc' : 'asc' })}
                      >
                        {children}{active ? (mrRankSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    )
                  }
                  return (
                  <div className="overflow-x-auto rounded-xl border border-sky-900/40">
                    <table className="w-full text-sm" style={{ minWidth: '500px' }}>
                      <thead>
                        <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 border-b border-sky-800/40 text-left">
                          <th className="px-3 py-2 text-xs text-white text-center w-8">#</th>
                          <RankTh field="name">選手名</RankTh>
                          <RankTh field="gender" className="text-center">性別</RankTh>
                          <RankTh field="team">チーム</RankTh>
                          <RankTh field="total" className="text-right">合計</RankTh>
                          <RankTh field="short" className="text-right">短水路</RankTh>
                          <RankTh field="long" className="text-right">長水路</RankTh>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRanking.map((a, i) => (
                          <tr key={a.name} className={`border-t border-slate-700/40 transition-colors ${mrHighlightName === a.name ? 'bg-amber-950/50 ring-1 ring-inset ring-amber-500/60' : i % 2 === 0 ? 'bg-sky-950/40' : 'bg-slate-900/40'}`}>
                            <td className="px-3 py-2 text-center text-xs text-white tabular-nums">{i + 1}</td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const isMobile = window.matchMedia('(max-width: 767px)').matches
                                  setMrHighlightName(isMobile ? a.name : (mrHighlightName === a.name ? '' : a.name))
                                  if (isMobile) setMobileDrawerOpen(true)
                                }}
                                className={`text-sm text-left hover:underline transition-colors ${mrHighlightName === a.name ? 'text-amber-200 font-bold' : 'text-sky-300 hover:text-sky-200'}`}
                              >{a.name}</button>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs font-bold ${genderDisplay(a.gender) === '男性' ? 'text-sky-400' : genderDisplay(a.gender) === '女性' ? 'text-rose-400' : 'text-purple-400'}`}>
                                {genderDisplay(a.gender)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-white whitespace-nowrap">{teamDisplayName(a.teamName)}</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-400 tabular-nums">{a.total}</td>
                            <td className="px-3 py-2 text-right text-white tabular-nums">{a.shortCount > 0 ? a.shortCount : '－'}</td>
                            <td className="px-3 py-2 text-right text-white tabular-nums">{a.longCount > 0 ? a.longCount : '－'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )
                })() : (
                <>{/* 水路別セクション */}
                {(['短水路', '長水路'] as const).map((course) => {
                  const courseMap = course === '短水路' ? mrGroupedByEvent.short : mrGroupedByEvent.long
                  if (courseMap.size === 0) return null
                  const isCourseOpen = !mrClosedCourses.has(course)
                  return (
                  <div key={course} className="mb-10">
                    {/* 水路ヘッダー（開閉ボタン） */}
                    <div className="mb-5">
                      <button
                        type="button"
                        onClick={() => setMrClosedCourses(prev => { const n = new Set(prev); if (n.has(course)) n.delete(course); else n.add(course); return n })}
                        className="w-full rounded-xl border border-sky-500/60 bg-gradient-to-r from-sky-900 via-blue-900 to-indigo-900 px-5 py-3 text-left text-base font-black text-white shadow-lg shadow-sky-950/40 transition-colors hover:from-sky-800 hover:to-indigo-800"
                      >
                        <span className="mr-1 text-[10px] text-sky-400">{isCourseOpen ? '▼' : '▶'}</span>
                        ⛊ {course}
                        <span className="ml-2 text-xs font-normal text-white">{[...courseMap.values()].flat().length}件</span>
                      </button>
                    </div>
                    {/* 競技別テーブル */}
                    {isCourseOpen && <div className="w-full">
                  {Array.from(courseMap.entries()).map(([eventKey, evRecords]) => {
                    const sorted = evRecords
                    const isOpen = !mrClosedEvents.has(`${course}:${eventKey}`)
                    return (
                      <div key={eventKey} className="mb-7">
                        {/* 競技名ヘッダー */}
                        <div className="mb-2">
                          <button
                            type="button"
                            onClick={() => setMrClosedEvents((current) => {
                              const next = new Set(current)
                              const key = `${course}:${eventKey}`
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })}
                            className="w-full rounded-lg border border-cyan-700/60 bg-gradient-to-r from-slate-800 to-sky-950 px-4 py-2.5 text-left text-sm font-bold text-cyan-200 shadow-md transition-colors hover:from-slate-700 hover:to-sky-900"
                          >
                            <span className="mr-1 text-[10px] text-sky-500">{isOpen ? '▼' : '▶'}</span>
                            {eventKey}
                            <span className="ml-2 text-xs text-white">{sorted.length}件</span>
                          </button>
                        </div>
                        {/* テーブル */}
                        {isOpen && <div className="overflow-x-auto rounded-xl border border-sky-900/40">
                          <table className="w-full text-sm" style={{ minWidth: '580px' }}>
                            <thead>
                              <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 border-b border-sky-800/40 text-left">
                                <th className="px-2 py-2 font-semibold text-xs text-slate-500 text-center w-7">#</th>
                                <th className="px-2 py-2 font-semibold text-xs text-sky-400 whitespace-nowrap">水路</th>
                                <SortTh field="age" current={mrSortField} dir={mrSortDir} onSort={handleMeetRecordSort}>年齢区分</SortTh>
                                <SortTh field="gender" current={mrSortField} dir={mrSortDir} onSort={handleMeetRecordSort} className="text-center">性別</SortTh>
                                <SortTh field="name" current={mrSortField} dir={mrSortDir} onSort={handleMeetRecordSort}>選手名</SortTh>
                                <SortTh field="team" current={mrSortField} dir={mrSortDir} onSort={handleMeetRecordSort}>チーム</SortTh>
                                <SortTh field="record" current={mrSortField} dir={mrSortDir} onSort={handleMeetRecordSort} className="text-right text-amber-400">大会新</SortTh>
                                <SortTh field="date" current={mrSortField} dir={mrSortDir} onSort={handleMeetRecordSort} className="text-right">樹立日</SortTh>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((r, i) => {
                                const relayTeam = r.is_relay ? meetRecordRelayTeam(r) : ''
                                const isTeamHit = !!mrHighlightTeam && (
                                  r.team_name === mrHighlightTeam ||
                                  relayTeam === mrHighlightTeam ||
                                  (!r.team_name && !relayTeam && r.name_team_raw.includes(mrHighlightTeam))
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
                                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                                      <span className={`font-bold ${r.course === '短水路' ? 'text-sky-400' : 'text-emerald-400'}`}>
                                        {r.course === '短水路' ? '短' : '長'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">
                                      {ageGroupLabel(r.age_group)}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <span className={`text-xs font-bold ${genderDisplay(r.gender) === '男性' ? 'text-sky-400' : genderDisplay(r.gender) === '女性' ? 'text-rose-400' : 'text-purple-400'}`}>
                                        {genderDisplay(r.gender)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">
                                      {r.is_relay ? (
                                        <span className="text-xs text-slate-300">{meetRecordRelayMembers(r)}</span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const isMobile = window.matchMedia('(max-width: 767px)').matches
                                            setMrHighlightName(isMobile ? (r.athlete_name ?? '') : (mrHighlightName === r.athlete_name ? '' : (r.athlete_name ?? '')))
                                            if (isMobile) setMobileDrawerOpen(true)
                                          }}
                                          className={`text-sm text-left transition-colors hover:underline ${
                                            isNameHit ? 'text-amber-200 font-bold' : 'text-sky-300 hover:text-sky-200'
                                          }`}
                                        >
                                          {r.athlete_name}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-400">
                                      {r.is_relay ? relayTeam : r.team_name}
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
                        </div>}
                      </div>
                    )
                  })}
                    </div>}
                  </div>
                  )
                })}
                </>)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'disqualification' && (
          <div className="max-w-5xl mx-auto">
            <div className="mb-5 flex gap-1.5 border-b border-slate-700">
              {([
                ['offenders', '失格/棄権一覧', disqualifiedEntries.length],
                ['rules', 'ルール一覧', disqualificationRules.length],
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
            ) : filteredAndSortedOffenders.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">条件に一致する失格・棄権者はいません</p>
            ) : (
              (() => {
                const dqCodeMap = new Map(disqualificationRules.map((r) => [r.code, r.description]))
                const SortTh = ({ label }: { label: string }) => {
                  const isActive = dqSortKey === label
                  return (
                    <th
                      className={`px-3 py-2.5 font-semibold cursor-pointer select-none whitespace-nowrap transition-colors hover:text-white ${isActive ? 'text-sky-300' : ''}`}
                      onClick={() => handleDqSort(label)}
                    >
                      {label}
                      {isActive && <span className="ml-1 text-[10px]">{dqSortDir === 'asc' ? '▲' : '▼'}</span>}
                    </th>
                  )
                }
                return (
                  <div className="overflow-x-auto rounded-xl border border-slate-700">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="bg-gradient-to-r from-sky-950 to-indigo-950 text-left text-xs text-slate-300">
                          <SortTh label="大会" />
                          <SortTh label="区分" />
                          <SortTh label="選手名" />
                          <SortTh label="性別" />
                          <SortTh label="チーム" />
                          <SortTh label="競技名" />
                          <SortTh label="年齢区分" />
                          <SortTh label="失格区分" />
                          <SortTh label="失格コード" />
                          <th className="px-3 py-2.5 font-semibold">理由</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAndSortedOffenders.map((entry, index, entries) => {
                          const isDQ = entry.disqualificationCode !== null
                          const isWD = entry.isWithdrawal
                          const statusLabel  = isDQ ? '失格' : isWD ? '棄権' : '－'
                          const statusColor  = isDQ ? 'text-red-400 font-semibold' : isWD ? 'text-slate-400' : 'text-slate-500'
                          const dqDesc = entry.disqualificationCode
                            ? (dqCodeMap.get(entry.disqualificationCode) ?? '')
                            : ''
                          const canShowHistory = entry.type === '個人' && entry.playerId != null
                          const startsArea = index === 0 || entries[index - 1]?.type !== entry.type
                          const areaIndex = entries.slice(0, index).filter((item) => item.type === entry.type).length
                          return (
                            <Fragment key={entry.id}>
                              {startsArea && (
                                <tr className={entry.type === '個人' ? 'bg-gradient-to-r from-sky-950 to-cyan-950' : 'bg-gradient-to-r from-violet-950 to-indigo-950'}>
                                  <td colSpan={10} className="border-y border-white/10 px-4 py-3">
                                    <div className="flex items-center justify-between">
                                      <span className={`font-bold ${entry.type === '個人' ? 'text-sky-200' : 'text-violet-200'}`}>
                                        {entry.type === '個人' ? '個人競技' : 'リレー競技'}
                                      </span>
                                      <span className="text-xs text-white">
                                        {entries.filter((item) => item.type === entry.type).length}件
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              <tr
                                className={`border-t border-slate-700/50 ${
                                  areaIndex % 2 === 0 ? 'bg-slate-800/60' : 'bg-slate-900/60'
                                }`}
                              >
                              <td
                                className="whitespace-nowrap px-3 py-2 text-slate-300 cursor-pointer hover:text-sky-300 hover:underline"
                                title="クリックで大会フィルター"
                                onClick={() => setMeetId(entry.meet.id)}
                              >第{entry.meet.round}回</td>
                              <td
                                className="whitespace-nowrap px-3 py-2 text-indigo-300 cursor-pointer hover:text-indigo-100 hover:underline"
                                title="クリックで区分フィルター"
                                onClick={() => setDqTypeFilter(entry.type === '個人' ? 'individual' : 'relay')}
                              >
                                {entry.type}
                              </td>
                              <td
                                className={`px-3 py-2 font-medium ${canShowHistory ? 'text-sky-200 cursor-pointer hover:underline hover:text-sky-100 whitespace-nowrap' : 'text-white'}`}
                                title={canShowHistory ? `${entry.name}の過去レース記録を表示` : undefined}
                                onClick={() => {
                                  if (canShowHistory) {
                                    setHistoryDisqualification({
                                      code: entry.disqualificationCode,
                                      isWithdrawal: entry.isWithdrawal,
                                    })
                                    fetchAthleteHistory(entry.playerId!, entry.name, entry.gender, entry.team)
                                    setMobileDrawerOpen(true)
                                  }
                                }}
                              >
                                {entry.type === 'リレー' && entry.members && entry.members.length > 0 ? (
                                  <div className="text-xs leading-relaxed">
                                    {entry.members.map((member, i) => (
                                      <button
                                        key={member.id}
                                        type="button"
                                        className="block whitespace-nowrap text-sky-200 hover:text-sky-100 hover:underline"
                                        title={`${member.name}の過去レース記録を表示`}
                                        onClick={() => {
                                          setHistoryDisqualification({
                                            code: entry.disqualificationCode,
                                            isWithdrawal: entry.isWithdrawal,
                                          })
                                          fetchAthleteHistory(member.id, member.name, member.gender, entry.team)
                                          setMobileDrawerOpen(true)
                                        }}
                                      >
                                        {i + 1}. {member.name}
                                      </button>
                                    ))}
                                  </div>
                                ) : entry.name}
                              </td>
                              <td className={`whitespace-nowrap px-3 py-2 ${entry.gender === '男子' ? 'text-sky-300' : entry.gender === '女子' ? 'text-rose-300' : 'text-purple-300'}`}>
                                {entry.gender}
                              </td>
                              <td
                                className="whitespace-nowrap px-3 py-2 text-slate-300 cursor-pointer hover:text-sky-300 hover:underline"
                                title="クリックでチームフィルター"
                                onClick={() => setTeamKey(normalizeOptionName(entry.team))}
                              >
                                {teamDisplayName(entry.team)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-slate-200">{formatEventDisplay(entry.event)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{entry.ageGroup || '－'}</td>
                              <td className={`whitespace-nowrap px-3 py-2 ${statusColor}`}>{statusLabel}</td>
                              <td className="whitespace-nowrap px-3 py-2 font-mono text-amber-300">
                                {entry.disqualificationCode ?? ''}
                              </td>
                              <td className="px-3 py-2 text-slate-400 text-xs leading-snug">{dqDesc}</td>
                              </tr>
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()
            )}
          </div>
        )}

        {activeTab === 'race-game' && (
          <RaceGame results={sortedResults} />
        )}

        {activeTab === 'athlete' && athleteDetailPanel}

        {activeTab === 'age-rank' && (
          <div className="max-w-5xl mx-auto">
            {ageRankLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
                <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                検索中…
              </div>
            ) : !ageRankMeetId ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="text-4xl mb-3">🏊</span>
                <p className="text-sm font-medium text-slate-300">大会回数を選択してください</p>
              </div>
            ) : !ageRankEventKey ? (
              ageRankEventSections.length === 0
                ? <p className="text-center py-12 text-slate-500 text-sm">この大会の記録がありません</p>
                : ageRankAllEventsView
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

  const meetRecordSidePanel = (
    <div className="p-3">
      {!mrSelectedAthlete ? (
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-4 text-xs">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600">ALL RECORDS</div>
          <p className="mt-2 leading-relaxed text-slate-400">
            選手名をクリックすると、この大会新一覧内の保持記録を表示します。
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-950/80 to-slate-900/80 border-b border-amber-800/40 px-4 py-3">
            <div>
              <div className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">ALL RECORDS</div>
              <div className="mt-1 text-base font-bold text-white">{mrSelectedAthlete.name}</div>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              <span className={`font-bold ${mrSelectedAthlete.gender === '男性' ? 'text-sky-400' : mrSelectedAthlete.gender === '女性' ? 'text-rose-400' : 'text-purple-400'}`}>
                {mrSelectedAthlete.gender}
              </span>
              {mrSelectedAthlete.teamName && (
                <>
                  <span className="text-slate-600">/</span>
                  <span className="text-white">{teamDisplayName(mrSelectedAthlete.teamName)}</span>
                </>
              )}
            </div>
            <div className="mt-2 inline-flex rounded border border-amber-900/40 bg-slate-950/30 px-2 py-1 text-[11px]">
              <span className="text-amber-600">新記録保持数</span>
              <span className="ml-2 font-bold text-amber-300">{mrSelectedAthlete.count}件</span>
            </div>
          </div>
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {(['短水路', '長水路'] as const).map((panelCourse) => {
              const panelRecs = mrAthleteRecords.filter(r => r.course === panelCourse)
              if (panelRecs.length === 0) return null
              const panelKey = `panel:${panelCourse}`
              const isPanelOpen = !mrClosedCourses.has(panelKey)
              return (
                <div key={panelCourse}>
                  <button
                    type="button"
                    onClick={() => setMrClosedCourses(prev => { const n = new Set(prev); if (n.has(panelKey)) n.delete(panelKey); else n.add(panelKey); return n })}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-sky-950/60 border-b border-sky-900/40 text-xs font-bold text-sky-300 hover:bg-sky-900/40 transition-colors"
                  >
                    <span className="text-[10px]">{isPanelOpen ? '▼' : '▶'}</span>
                    ⛊ {panelCourse}
                    <span className="text-[10px] text-slate-400 ml-auto">{panelRecs.length}件</span>
                  </button>
                  {isPanelOpen && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-900/60 border-b border-amber-900/30 text-left">
                          <th className="px-3 py-1.5 text-slate-400 font-semibold">競技</th>
                          <th className="px-2 py-1.5 text-slate-400 font-semibold whitespace-nowrap">年齢</th>
                          <th className="px-2 py-1.5 text-amber-500 font-semibold text-right whitespace-nowrap">大会新</th>
                          <th className="px-2 py-1.5 text-slate-400 font-semibold text-right whitespace-nowrap">樹立日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {panelRecs.map((r, i) => (
                          <tr key={r.id} className={`border-t border-amber-900/20 ${i % 2 === 0 ? 'bg-amber-950/20' : ''}`}>
                            <td className="px-3 py-2 font-medium text-white leading-tight whitespace-nowrap">{formatEventDisplay(`${r.event} ${r.distance}`)}</td>
                            <td className="px-2 py-2 text-white whitespace-nowrap">{ageGroupLabel(r.age_group)}</td>
                            <td className="px-2 py-2 text-right font-mono font-bold text-amber-300 whitespace-nowrap">{r.record}</td>
                            <td className="px-2 py-2 text-right text-white whitespace-nowrap">{r.established_date ?? '－'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  // ── Layout ────────────────────────────────────────────────────
  const roundValues = meets.map((meet) => meet.round)
  const siteRoundRange = roundValues.length > 0
    ? `第${Math.min(...roundValues)}回～第${Math.max(...roundValues)}回`
    : ''
  return (
    <div className="flex h-full flex-col overflow-hidden [&_.text-slate-300]:text-white [&_.text-slate-400]:text-white [&_.text-slate-500]:text-white">
      <div className="md:hidden shrink-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-sky-900/50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-2 py-2 shadow-lg">
        <button
          type="button"
          onClick={() => setMobileFilterOpen(true)}
          className="min-w-[64px] rounded-lg border border-sky-700/70 bg-sky-950/70 px-2.5 py-2 text-xs font-bold text-sky-200 transition-colors hover:bg-sky-900/80"
        >
          検索
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate text-xs font-bold tracking-wide bg-gradient-to-r from-sky-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
            セントラルマスターズ
          </div>
          {siteRoundRange && <div className="mt-0.5 text-[9px] font-bold text-sky-300/80">{siteRoundRange}</div>}
        </div>
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          className="min-w-[78px] rounded-lg border border-indigo-700/70 bg-indigo-950/70 px-2.5 py-2 text-xs font-bold text-indigo-200 transition-colors hover:bg-indigo-900/80"
        >
          {activeTab === 'meet-records' ? '大会新一覧' : 'レース記録'}
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
          {/* Header: 2-tab strip for results, plain title for other tabs */}
          {activeTab === 'results' ? (
            <div className="flex shrink-0 border-b border-slate-700/80">
              <button
                type="button"
                onClick={() => setRightPanelTab('digest')}
                className={`flex-1 px-3 py-2.5 text-xs font-bold transition-colors border-b-2 ${rightPanelTab === 'digest' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                🎉 統計
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('history')}
                className={`flex-1 px-3 py-2.5 text-xs font-bold transition-colors border-b-2 ${rightPanelTab === 'history' ? 'border-sky-400 text-sky-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                🏊 過去記録
              </button>
            </div>
          ) : (
            <div className="px-4 py-2.5 border-b border-slate-700/80 shrink-0 flex items-center justify-between">
              {activeTab === 'meet-records' ? (
                <span className="text-xs font-black tracking-wide bg-gradient-to-r from-amber-400 via-yellow-100 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]">
                  大会新一覧
                </span>
              ) : (
                <span className="text-xs font-bold text-white tracking-wide">過去レース記録</span>
              )}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {/* Results tab — 統計 */}
            {activeTab === 'results' && rightPanelTab === 'digest' && (
              <div className="p-3 flex flex-col gap-4">
                {(individualTable || relayTable) ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-3 text-center">
                        <div className="text-lg font-black text-white">{resultsDigest.athleteCount}</div>
                        <div className="text-[9px] text-slate-500">参加選手</div>
                      </div>
                      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-3 text-center">
                        <div className="text-lg font-black text-white">{resultsDigest.raceCount}</div>
                        <div className="text-[9px] text-slate-500">レース</div>
                      </div>
                      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-3 text-center">
                        <div className="text-lg font-black text-amber-300">{formatPoints(resultsDigest.totalPoints)}pt</div>
                        <div className="text-[9px] text-slate-500">合計得点</div>
                      </div>
                    </div>
                    {resultsDigest.awards.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-[10px] font-bold text-fuchsia-300 uppercase tracking-wider">🏆 今回の称号</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {resultsDigest.awards.map((award) => {
                            const athlete = award.athlete
                            if (!athlete) return null
                            return (
                              <button
                                key={award.label}
                                type="button"
                                onClick={() => fetchAthleteHistory(athlete.id, athlete.name, athlete.gender, athlete.team)}
                                className="group rounded-lg border border-fuchsia-800/40 bg-gradient-to-br from-slate-900/80 to-fuchsia-950/30 p-2.5 text-left transition-all hover:border-fuchsia-500/70"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-base">{award.icon}</span>
                                  <span className="text-[9px] font-bold text-fuchsia-300">{award.label}</span>
                                </div>
                                <div className="mt-1.5 truncate text-xs font-black text-white">{athlete.name}</div>
                                <div className="mt-0.5 text-[10px] font-bold text-amber-300">{award.metric(athlete)}</div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {resultsDigest.spotlights.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-[10px] font-bold text-cyan-300 uppercase tracking-wider">✨ 注目レース</h3>
                        <div className="flex flex-col gap-2">
                          {resultsDigest.spotlights.map((spotlight) => {
                            const colors = spotlight.tone === 'amber'
                              ? 'border-amber-700/50 bg-amber-950/25 text-amber-300'
                              : spotlight.tone === 'violet'
                                ? 'border-violet-700/50 bg-violet-950/25 text-violet-300'
                                : 'border-cyan-700/50 bg-cyan-950/25 text-cyan-300'
                            return (
                              <button
                                key={spotlight.key}
                                type="button"
                                disabled={spotlight.athleteId == null}
                                onClick={() => {
                                  if (spotlight.athleteId == null) return
                                  fetchAthleteHistory(spotlight.athleteId, spotlight.name, spotlight.gender, spotlight.team)
                                }}
                                className={`rounded-lg border p-2.5 text-left transition-colors hover:bg-slate-800/60 disabled:cursor-default ${colors}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-black">{spotlight.headline}</span>
                                  <span className="shrink-0 text-[9px] text-white">第{spotlight.round}回</span>
                                </div>
                                <div className="mt-1 text-xs font-bold text-white">{spotlight.name}</div>
                                <div className="mt-0.5 text-[9px] text-slate-300">{formatEventDisplay(spotlight.event)}・{spotlight.detail}</div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-10 text-center text-xs text-slate-600">
                    <p className="mb-2 text-2xl">🔍</p>
                    <p>検索すると統計が表示されます</p>
                  </div>
                )}
              </div>
            )}

            {/* Results tab — 過去記録 */}
            {activeTab === 'results' && rightPanelTab === 'history' && (
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setRightPanelTab('digest')}
                  className="flex shrink-0 items-center gap-1.5 px-3 py-2 border-b border-slate-700/60 text-xs font-bold text-cyan-400 hover:bg-slate-700/40 transition-colors"
                >
                  ← 統計に戻る
                </button>
                {!athleteForHistory ? (
                  <div className="p-4 text-xs text-slate-600">
                    <p className="mt-1 leading-relaxed">選手名をクリックすると<br />全大会の記録が表示されます</p>
                  </div>
                ) : (
                  <div className="p-3 flex flex-col gap-5">
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
                        onClick={() => handleTabChange('athlete')}
                        className="mt-3 w-full rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-xs font-bold text-white transition-colors"
                      >
                        詳しく見る →
                      </button>
                    </div>
                    {historyLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-xs">
                        <span className="w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                        読込中…
                      </div>
                    ) : !athleteHistory || athleteHistory.length === 0 ? (
                      <div className="py-4 text-xs text-slate-500">記録が見つかりません</div>
                    ) : athleteHistory.map((meet) => {
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
                          <table className="w-full text-xs">
                            <tbody>
                              {meet.individual.map((r, i) => (
                                <tr
                                  key={i}
                                  className="group border-t border-slate-700/40 cursor-pointer hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_16px_rgba(251,191,36,0.14)] transition-all"
                                  onClick={() => handleJumpToAgeRank(meet.round, r.event, r.age_group)}
                                  title="年代別順位タブで同条件を表示"
                                >
                                  <td className="py-1 pr-1 text-slate-100 group-hover:text-amber-200 transition-colors">{formatEventDisplay(r.event)}</td>
                                  <td className="py-1 pr-2 text-white whitespace-nowrap">{r.age_group}</td>
                                  <td className="py-1 pr-2 font-mono text-white whitespace-nowrap">
                                    {r.time_display != null ? (
                                      <>{r.time_display}{r.is_meet_record && <span className="ml-1 text-amber-400">★</span>}</>
                                    ) : r.disqualification_code != null ? (
                                      <span className="text-red-400 font-semibold text-xs">失格 {r.disqualification_code}</span>
                                    ) : r.is_withdrawal ? (
                                      <span className="text-slate-400 text-xs">棄権</span>
                                    ) : '－'}
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
                                  <td className="py-1 pr-1 text-indigo-300 group-hover:text-amber-200 transition-colors">R {formatEventDisplay(r.event)}</td>
                                  <td className="py-1 pr-2 text-white whitespace-nowrap">{r.age_group ?? ''}</td>
                                  <td className="py-1 pr-2 font-mono text-white whitespace-nowrap">
                                    {r.time_display != null ? r.time_display
                                      : r.disqualification_code != null ? (
                                        <span className="text-red-400 font-semibold text-xs">失格 {r.disqualification_code}</span>
                                      ) : r.is_withdrawal ? (
                                        <span className="text-slate-400 text-xs">棄権</span>
                                      ) : '－'}
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
                            </tbody>
                          </table>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Other tabs — meet records or athlete history */}
            {activeTab !== 'results' && (
              activeTab === 'meet-records' ? meetRecordSidePanel : !athleteForHistory ? (
                <div className="p-4 text-xs text-slate-600">
                  <p className="mt-1 leading-relaxed">選手名をクリックすると<br />全大会の記録が表示されます</p>
                </div>
              ) : (
                <div className="p-3 flex flex-col gap-5">
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
                  {historyLoading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-xs">
                      <span className="w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                      読込中…
                    </div>
                  ) : !athleteHistory || athleteHistory.length === 0 ? (
                    <div className="py-4 text-xs text-slate-500">記録が見つかりません</div>
                  ) : athleteHistory.map((meet) => {
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
                        <table className="w-full text-xs">
                          <tbody>
                            {meet.individual.map((r, i) => (
                              <tr
                                key={i}
                                className="group border-t border-slate-700/40 cursor-pointer hover:bg-amber-900/35 hover:ring-1 hover:ring-inset hover:ring-amber-400/60 hover:shadow-[inset_0_0_16px_rgba(251,191,36,0.14)] transition-all"
                                onClick={() => handleJumpToAgeRank(meet.round, r.event, r.age_group)}
                                title="年代別順位タブで同条件を表示"
                              >
                                <td className="py-1 pr-1 text-slate-100 group-hover:text-amber-200 transition-colors">{formatEventDisplay(r.event)}</td>
                                <td className="py-1 pr-2 text-white whitespace-nowrap">{r.age_group}</td>
                                <td className="py-1 pr-2 font-mono text-white whitespace-nowrap">
                                  {r.time_display != null ? (
                                    <>{r.time_display}{r.is_meet_record && <span className="ml-1 text-amber-400">★</span>}</>
                                  ) : r.disqualification_code != null ? (
                                    <span className="text-red-400 font-semibold text-xs">失格 {r.disqualification_code}</span>
                                  ) : r.is_withdrawal ? (
                                    <span className="text-slate-400 text-xs">棄権</span>
                                  ) : '－'}
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
                                <td className="py-1 pr-1 text-indigo-300 group-hover:text-amber-200 transition-colors">R {formatEventDisplay(r.event)}</td>
                                <td className="py-1 pr-2 text-white whitespace-nowrap">{r.age_group ?? ''}</td>
                                <td className="py-1 pr-2 font-mono text-white whitespace-nowrap">
                                  {r.time_display != null ? r.time_display
                                    : r.disqualification_code != null ? (
                                      <span className="text-red-400 font-semibold text-xs">失格 {r.disqualification_code}</span>
                                    ) : r.is_withdrawal ? (
                                      <span className="text-slate-400 text-xs">棄権</span>
                                    ) : '－'}
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
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              )
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
            {activeTab === 'meet-records' ? (
              <span className="text-sm font-black bg-gradient-to-r from-amber-400 via-yellow-100 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]">大会新一覧</span>
            ) : (
              <span className="text-sm font-bold text-white">過去レース記録</span>
            )}
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
            {activeTab === 'meet-records' ? meetRecordSidePanel : !athleteForHistory ? (
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
                {historyLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
                    <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                    読込中…
                  </div>
                ) : !athleteHistory || athleteHistory.length === 0 ? (
                  <div className="py-5 text-sm text-slate-500">記録が見つかりません</div>
                ) : athleteHistory.map((meet) => {
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
                              <td className="py-1.5 pr-1 text-slate-100">{formatEventDisplay(r.event)}</td>
                              <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">{r.age_group}</td>
                              <td className="py-1.5 pr-2 font-mono text-white whitespace-nowrap">
                                {r.time_display != null ? (
                                  <>{r.time_display}{r.is_meet_record && <span className="ml-1 text-amber-400">★</span>}</>
                                ) : r.disqualification_code != null ? (
                                  <span className="text-red-400 font-semibold text-xs">失格 {r.disqualification_code}</span>
                                ) : r.is_withdrawal ? (
                                  <span className="text-slate-400 text-xs">棄権</span>
                                ) : '－'}
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
                              <td className="py-1.5 pr-1 text-indigo-300">R {formatEventDisplay(r.event)}</td>
                              <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">{r.age_group ?? ''}</td>
                              <td className="py-1.5 pr-2 font-mono text-white whitespace-nowrap">
                                {r.time_display != null ? r.time_display
                                  : r.disqualification_code != null ? (
                                    <span className="text-red-400 font-semibold text-xs">失格 {r.disqualification_code}</span>
                                  ) : r.is_withdrawal ? (
                                    <span className="text-slate-400 text-xs">棄権</span>
                                  ) : '－'}
                              </td>
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

      {/* Compact shared back action that does not cover the analysis content. */}
      {canGoBack && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-sky-700/70 bg-slate-900/95 p-1 shadow-2xl shadow-black/60 backdrop-blur">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-lg bg-sky-950/80 px-4 py-1.5 text-xs font-bold text-sky-200 transition-colors hover:bg-sky-900 hover:text-white"
            >
              ← 戻る
            </button>
            <button
              type="button"
              onClick={() => setMobileFilterOpen(true)}
              className="rounded-lg bg-indigo-950/80 px-4 py-1.5 text-xs font-bold text-indigo-200 transition-colors hover:bg-indigo-900 hover:text-white md:hidden"
            >
              検索
            </button>
            <button
              type="button"
              onClick={() => {
                document.querySelectorAll<HTMLElement>('[data-results-scroll]').forEach((element) => {
                  element.scrollTo({ top: 0, behavior: 'smooth' })
                })
              }}
              className="rounded-lg bg-emerald-950/80 px-4 py-1.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-900 hover:text-white"
            >
              ↑ 一番上へ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
