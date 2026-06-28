'use client'

import { useState, useEffect } from 'react'

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
  candidatesPerOrder: CandidateInfo[]
}

interface RelayOptimizeResult {
  optimizations: OptimizedRelay[]
  totalActualPoints: number
  totalOptimalPoints: number
  totalGain: number
  teamRankings: { rank: number; total_points: number; mst_team: { name: string } }[]
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

interface Props {
  eventId: number
  teamId: number
  teamName: string
  meetRound: number
}

export default function RelayOptimizer({ eventId, teamId, teamName, meetRound }: Props) {
  const [data, setData] = useState<RelayOptimizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // 現在のチーム順位を特定
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
          ※ 個人種目のタイムデータが不足している種目は計算できません
        </p>
      )}

      {/* Per-relay breakdown */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-1 h-4 rounded bg-amber-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">種目別分析</h3>
        </div>

        {optimizations.map((opt, i) => (
          <RelayCard key={i} opt={opt} />
        ))}
      </div>

      {/* Context note */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-3">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※ メドレーリレーは泳順（背泳ぎ→平泳ぎ→バタフライ→フリー）を考慮した上で最適な組み合わせを計算します。
          個人種目のタイムをスプリットタイムとして使用しています。実際のリレー飛込タイムは考慮していません。
          あくまでも参考値としてご活用ください。
        </p>
      </div>
    </div>
  )
}

// ストロークの短縮表示
const STROKE_SHORT: Record<string, string> = {
  '背泳ぎ': 'Back',
  '平泳ぎ': 'Breast',
  'バタフライ': 'Fly',
  '自由形': 'Free',
}

function RelayCard({ opt }: { opt: OptimizedRelay }) {
  const [open, setOpen] = useState(false)
  const gain = opt.pointsGain
  const improved = gain > 0
  const same = opt.isCurrentOptimal
  const isMedley = opt.relayStroke.includes('メドレー')

  // 候補者数の合計（泳順別表示用）
  const totalCandidates = opt.candidatesPerOrder.reduce((s, c) => s + c.count, 0)

  return (
    <div className={`rounded-xl border overflow-hidden ${improved ? 'border-emerald-700/40' : 'border-slate-700/40'}`}>
      {/* Header */}
      <button
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${improved ? 'bg-emerald-950/40 hover:bg-emerald-950/60' : 'bg-slate-800/60 hover:bg-slate-700/60'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-white">{opt.categoryName}</span>
            <span className="text-[10px] text-slate-400">{opt.ageGroup}</span>
            {same && <span className="text-[10px] text-emerald-400 font-semibold">✓ 最適</span>}
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
          {improved && (
            <span className="text-sm font-black text-emerald-300">+{gain}pt</span>
          )}
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Detail */}
      {open && (
        <div className="px-4 py-3 bg-slate-900/40 grid gap-4 sm:grid-cols-2">
          {/* Actual members */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 mb-2">実際のメンバー</p>
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
                  <span className="font-mono text-slate-400 shrink-0">
                    {m.splitSeconds ? formatTime(m.splitSeconds) : '－'}
                  </span>
                </div>
              ))}
              <div className="border-t border-slate-700/40 pt-1 flex justify-between text-xs font-bold">
                <span className="text-slate-300">合計</span>
                <span className="font-mono text-white">{formatTime(opt.actualTeamTime)}</span>
              </div>
            </div>
          </div>

          {/* Optimal members */}
          <div>
            <p className="text-[10px] font-bold text-emerald-400 mb-2">
              最適メンバー
              <span className="text-slate-500 font-normal ml-1">（候補{totalCandidates}名）</span>
            </p>
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

            {/* 泳順ごとの候補者数（メドレーのみ表示） */}
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
      )}
    </div>
  )
}
