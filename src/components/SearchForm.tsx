import type { EventOption, AgeGroupOption, TeamOption } from '@/types'

interface Props {
  events: EventOption[]
  ageGroups: AgeGroupOption[]
  teams: TeamOption[]
  current: {
    q?: string
    team?: string
    gender?: string
    event?: string
    ageGroup?: string
  }
}

const selectClass =
  'w-full bg-slate-700 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

export default function SearchForm({ events, ageGroups, teams, current }: Props) {
  return (
    <form
      method="get"
      action="/"
      className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-6"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="block text-sm font-medium text-slate-300 mb-1">選手名</label>
          <input
            type="text"
            name="q"
            defaultValue={current.q ?? ''}
            placeholder="例: 田中"
            className="w-full bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">チーム</label>
          <select name="team" defaultValue={current.team ?? ''} className={selectClass}>
            <option value="">すべて</option>
            {teams.map((t) => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">性別</label>
          <select name="gender" defaultValue={current.gender ?? ''} className={selectClass}>
            <option value="">すべて</option>
            <option value="男子">男子</option>
            <option value="女子">女子</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">種目</label>
          <select name="event" defaultValue={current.event ?? ''} className={selectClass}>
            <option value="">すべて</option>
            {events.map((e) => (
              <option key={e.id} value={String(e.id)}>{e.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">年齢区分</label>
          <select name="ageGroup" defaultValue={current.ageGroup ?? ''} className={selectClass}>
            <option value="">すべて</option>
            {ageGroups.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer"
          >
            検索
          </button>
          <a
            href="/"
            className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg px-4 py-2 text-sm transition-colors"
          >
            クリア
          </a>
        </div>
      </div>
    </form>
  )
}
