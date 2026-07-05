'use client'

import { useEffect, useMemo, useState } from 'react'

type TodoCategory = 'game' | 'analysis' | 'presentation'

type TodoItem = {
  id: string
  title: string
  description: string
  category: TodoCategory
  impact: string
}

const STORAGE_KEY = 'central-masters-game-todos-v1'

const TODO_ITEMS: TodoItem[] = [
  {
    id: 'rival-finder',
    title: 'ライバル発見ゲーム',
    description: '自分のタイムに近い人、同年代の接戦相手、別チームの宿命のライバルを自動表示する。',
    category: 'game',
    impact: '自分ごと感が強く、何度も見たくなる',
  },
  {
    id: 'growth-sugoroku',
    title: 'タイム成長すごろく',
    description: '第74回〜第80回の記録推移をマップ風に表示。ベスト更新や大会新をイベント化する。',
    category: 'presentation',
    impact: '選手詳細を楽しいストーリーにできる',
  },
  {
    id: 'age-boss-battle',
    title: '年代別ラスボス戦',
    description: '同年代1位・大会新・チーム内1位まで「あと何秒」かをボス戦風に見せる。',
    category: 'analysis',
    impact: '目標が一瞬で分かって燃える',
  },
  {
    id: 'team-draft',
    title: 'チーム対抗ドラフト',
    description: '仮想チームを作って、合計得点や順位相当を競う。予算制や男女混合ルールも検討。',
    category: 'game',
    impact: 'チーム順位データをゲーム化できる',
  },
  {
    id: 'relay-maker-game',
    title: '最強リレーメーカー・ゲーム版',
    description: '4人を選んで泳順を変えると予想タイムがリアルタイム変化。他チーム仮想リレーと対決。',
    category: 'game',
    impact: '既存のリレー最適化ロジックを活かせる',
  },
  {
    id: 'prime-time-meet',
    title: 'もしも全員全盛期だったら',
    description: '各選手の過去ベストだけで仮想大会を開催。全盛期チームランキングや決勝を作る。',
    category: 'analysis',
    impact: '過去データを掘る価値が上がる',
  },
  {
    id: 'lane-intro-generator',
    title: '決勝レーン紹介ジェネレーター',
    description: '競泳中継風にレーン・選手・チーム・ベストタイムを紹介する演出画面を作る。',
    category: 'presentation',
    impact: 'レースゲームの没入感が上がる',
  },
  {
    id: 'daily-feature-card',
    title: '今日の注目カード',
    description: '0.1秒差の名勝負、大会新レース、チーム内ライバル対決などを日替わりで紹介する。',
    category: 'presentation',
    impact: 'トップページの読み物になる',
  },
  {
    id: 'title-maker',
    title: '称号メーカー',
    description: '自己ベスト職人、安定王、チーム得点職人など、記録から選手の称号を自動生成する。',
    category: 'analysis',
    impact: '選手ページが一気に楽しくなる',
  },
  {
    id: 'time-prophet',
    title: 'タイム予言機',
    description: '過去の記録推移から「次の大会で自己ベスト更新する確率」をAI風に予測・表示する。',
    category: 'analysis',
    impact: '次の大会へのモチベーションが上がる',
  },
  {
    id: 'generation-map',
    title: '世代交代マップ',
    description: '種目ごとに第74〜80回の上位選手の変遷を可視化。誰が台頭し誰が引退したかを一覧できる。',
    category: 'analysis',
    impact: '過去データに新しい見方が生まれる',
  },
  {
    id: 'golden-generation',
    title: '黄金世代診断',
    description: 'チームの年齢構成・タイム推移から「今が全盛期」「これから伸びる」「次世代育成中」を診断する。',
    category: 'analysis',
    impact: 'チームの強さの背景が見えてくる',
  },
  {
    id: 'same-age-battle',
    title: 'もしも同年代だったら',
    description: 'FINAポイントを使って年齢を揃えた仮想比較。世代を超えた名勝負を再現する。',
    category: 'game',
    impact: '世代を超えた比較が可能になる',
  },
  {
    id: 'photo-book-report',
    title: '大会フォトブック風レポート',
    description: '大会ごとのハイライト（最速タイム・大会新・接戦）をページめくり形式で振り返る演出画面。',
    category: 'presentation',
    impact: '大会の思い出が詰まったコンテンツになる',
  },
  {
    id: 'player-card',
    title: '選手名鑑カード',
    description: 'ポケモン図鑑風に選手の得意種目・称号・チーム・ベストタイムをカード形式で表示する。',
    category: 'presentation',
    impact: '選手への愛着が深まる',
  },
]

const CATEGORY_LABELS: Record<TodoCategory, { label: string; icon: string; className: string }> = {
  game: {
    label: 'ゲーム',
    icon: '🎮',
    className: 'border-violet-500/40 bg-violet-950/30 text-violet-200',
  },
  analysis: {
    label: '分析',
    icon: '📊',
    className: 'border-sky-500/40 bg-sky-950/30 text-sky-200',
  },
  presentation: {
    label: '演出',
    icon: '✨',
    className: 'border-amber-500/40 bg-amber-950/30 text-amber-200',
  },
}

export default function TodoTab() {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const ids = JSON.parse(saved)
        if (Array.isArray(ids)) setCheckedIds(new Set(ids.filter((id) => typeof id === 'string')))
      }
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...checkedIds]))
  }, [checkedIds, loaded])

  const completedCount = checkedIds.size
  const progressPercent = useMemo(
    () => Math.round((completedCount / TODO_ITEMS.length) * 100),
    [completedCount],
  )

  const toggle = (id: string) => {
    setCheckedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-24">
      <div className="overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/40 shadow-2xl shadow-violet-950/20">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-violet-300/80">Idea backlog</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
                遊べるサイト化 ToDo
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                競技結果データを使って、検索だけでなく「遊ぶ・燃える・眺めて楽しい」機能に育てるためのアイデア置き場です。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-right">
              <p className="text-xs text-slate-400">進捗</p>
              <p className="text-2xl font-black text-violet-200">
                {completedCount}/{TODO_ITEMS.length}
              </p>
              <p className="text-xs text-slate-500">{progressPercent}% complete</p>
            </div>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-amber-300 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {TODO_ITEMS.map((item) => {
          const category = CATEGORY_LABELS[item.category]
          const checked = checkedIds.has(item.id)
          return (
            <label
              key={item.id}
              className={`group flex cursor-pointer gap-3 rounded-2xl border p-4 transition-all ${
                checked
                  ? 'border-emerald-500/40 bg-emerald-950/20'
                  : 'border-slate-700 bg-slate-900/70 hover:border-violet-500/50 hover:bg-slate-800/80'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(item.id)}
                className="mt-1 h-5 w-5 shrink-0 rounded border-slate-600 bg-slate-950 accent-violet-500"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${category.className}`}>
                    {category.icon} {category.label}
                  </span>
                  {checked && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                      DONE
                    </span>
                  )}
                </div>
                <h3 className={`mt-2 text-base font-bold ${checked ? 'text-emerald-100 line-through decoration-emerald-400/70' : 'text-white'}`}>
                  {item.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{item.description}</p>
                <p className="mt-2 text-xs text-slate-500">
                  期待効果：<span className="text-slate-300">{item.impact}</span>
                </p>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}
