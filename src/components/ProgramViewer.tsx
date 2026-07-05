'use client'

import { useState } from 'react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const BUCKET = 'meet-programs'

const MEETS = [
  { round: 80, label: '第80回（長水路）', pages: 100 },
]

function pageUrl(round: number, page: number) {
  const filename = `page_${String(page).padStart(3, '0')}.png`
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/round${round}/${filename}`
}

export default function ProgramViewer() {
  const [selectedRound, setSelectedRound] = useState(MEETS[0].round)
  const [currentPage, setCurrentPage] = useState(1)
  const [jumpInput, setJumpInput] = useState('')

  const meet = MEETS.find((m) => m.round === selectedRound)!
  const totalPages = meet.pages

  const goTo = (page: number) => {
    const p = Math.max(1, Math.min(totalPages, page))
    setCurrentPage(p)
  }

  const handleJump = () => {
    const n = parseInt(jumpInput)
    if (!isNaN(n)) goTo(n)
    setJumpInput('')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
      {/* ヘッダー */}
      <div className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/40 p-5 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-sky-300/80">Program Viewer</p>
        <h2 className="mt-1 text-2xl font-black text-white">大会プログラム</h2>

        {/* 大会選択 */}
        <div className="mt-4 flex flex-wrap gap-2">
          {MEETS.map((m) => (
            <button
              key={m.round}
              onClick={() => { setSelectedRound(m.round); setCurrentPage(1) }}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
                selectedRound === m.round
                  ? 'bg-sky-500 text-white'
                  : 'border border-slate-600 text-slate-300 hover:border-sky-500/50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ページャー */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3">
        <button
          onClick={() => goTo(currentPage - 1)}
          disabled={currentPage === 1}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 transition-all hover:border-sky-500 hover:text-white disabled:opacity-30"
        >
          ← 前
        </button>

        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className="font-bold text-white">{currentPage}</span>
          <span className="text-slate-500">/</span>
          <span>{totalPages}</span>
        </div>

        <button
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 transition-all hover:border-sky-500 hover:text-white disabled:opacity-30"
        >
          次 →
        </button>
      </div>

      {/* ジャンプ */}
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={jumpInput}
          onChange={(e) => setJumpInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJump()}
          placeholder="ページ番号"
          min={1}
          max={totalPages}
          className="w-32 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
        />
        <button
          onClick={handleJump}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-sky-500"
        >
          ジャンプ
        </button>
      </div>

      {/* 画像 */}
      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={`${selectedRound}-${currentPage}`}
          src={pageUrl(selectedRound, currentPage)}
          alt={`第${selectedRound}回 p.${currentPage}`}
          className="w-full"
        />
      </div>

      {/* 下部ページャー */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3">
        <button
          onClick={() => goTo(currentPage - 1)}
          disabled={currentPage === 1}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 transition-all hover:border-sky-500 hover:text-white disabled:opacity-30"
        >
          ← 前
        </button>
        <span className="text-sm text-slate-400">{currentPage} / {totalPages}</span>
        <button
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 transition-all hover:border-sky-500 hover:text-white disabled:opacity-30"
        >
          次 →
        </button>
      </div>
    </div>
  )
}
