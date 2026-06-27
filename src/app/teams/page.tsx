import { supabase } from '@/lib/supabase'
import type { TeamStanding } from '@/types'

export const metadata = {
  title: 'チーム成績 | セントラルマスターズ 記録検索',
}

async function loadTeamStandings(): Promise<{ data: TeamStanding[]; meetName: string }> {
  const [standingsRes, meetRes] = await Promise.all([
    supabase
      .from('dt_ranking_team')
      .select('rank, total_points, male_points, female_points, mixed_points, mst_team!inner (name)')
      .order('rank'),
    supabase
      .from('mst_event')
      .select('name, round, pool_type')
      .order('round', { ascending: false })
      .limit(1)
      .single(),
  ])
  const meet = meetRes.data
  const meetName = meet ? meet.name ?? `第${meet.round}回（${meet.pool_type}）` : ''
  return {
    data: (standingsRes.data ?? []) as unknown as TeamStanding[],
    meetName,
  }
}

export default async function TeamsPage() {
  const { data: standings, meetName } = await loadTeamStandings()

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-slate-100">チーム総合成績</h2>
        {meetName && <p className="text-sm text-slate-500 mt-1">{meetName}</p>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-sky-900 text-sky-100 text-left">
              <th className="px-3 py-3 font-semibold w-12 text-center">順位</th>
              <th className="px-3 py-3 font-semibold">チーム名</th>
              <th className="px-3 py-3 font-semibold text-right">総合</th>
              <th className="px-3 py-3 font-semibold text-right">男子</th>
              <th className="px-3 py-3 font-semibold text-right">女子</th>
              <th className="px-3 py-3 font-semibold text-right">混合</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr
                key={i}
                className={
                  i % 2 === 0
                    ? 'bg-slate-800 hover:bg-slate-700/60'
                    : 'bg-slate-900 hover:bg-slate-700/60'
                }
              >
                <td className="px-3 py-2 text-center font-medium text-slate-300">
                  {s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank ?? '－'}
                </td>
                <td className="px-3 py-2 font-medium text-slate-100">{s.mst_team.name}</td>
                <td className="px-3 py-2 text-right font-semibold text-sky-400">
                  {s.total_points ? Number(s.total_points).toFixed(1) : '－'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {s.male_points ? Number(s.male_points).toFixed(1) : '－'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {s.female_points ? Number(s.female_points).toFixed(1) : '－'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {s.mixed_points ? Number(s.mixed_points).toFixed(1) : '－'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  )
}
