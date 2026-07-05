'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const BUCKET = 'meet-programs'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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

  // 検索
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([]) // page_no の配列
  const [resultIndex, setResultIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searched, setSearched] = useState(false)

  // テキストパネル
  const [pageText, setPageText] = useState('')
  const [showText, setShowText] = useState(false)
  const firstMarkRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!showText) return
    sb.from('mst_program_pages')
      .select('text_content')
      .eq('round', selectedRound)
      .eq('page_no', currentPage)
      .single()
      .then(({ data }) => setPageText(data?.text_content ?? ''))
  }, [currentPage, selectedRound, showText])

  // ハイライトスクロール
  useEffect(() => {
    if (firstMarkRef.current) {
      firstMarkRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [pageText, searchQuery])

  function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function renderHighlighted(text: string, query: string) {
    if (!query.trim()) return <span className="whitespace-pre-wrap">{text}</span>
    const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'))
    let firstMark = true
    return (
      <span className="whitespace-pre-wrap">
        {parts.map((part, i) => {
          if (part.toLowerCase() === query.toLowerCase()) {
            const isFirst = firstMark
            firstMark = false
            return (
              <mark
                key={i}
                ref={isFirst ? (firstMarkRef as React.RefObject<HTMLElement>) : undefined}
                className="rounded bg-red-500/40 px-0.5 text-red-100 not-italic"
              >
                {part}
              </mark>
            )
          }
          return <span key={i}>{part}</span>
        })}
      </span>
    )
  }

  const meet = MEETS.find((m) => m.round === selectedRound)!
  const totalPages = meet.pages

  const isSearchHitPage = searched && searchResults.includes(currentPage)

  const goTo = (page: number) => {
    const p = Math.max(1, Math.min(totalPages, page))
    setCurrentPage(p)
  }

  const handleJump = () => {
    const n = parseInt(jumpInput)
    if (!isNaN(n)) goTo(n)
    setJumpInput('')
  }

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    setSearchError('')
    setSearched(false)
    setSearchResults([])

    const { data, error } = await sb
      .from('mst_program_pages')
      .select('page_no')
      .eq('round', selectedRound)
      .ilike('text_content', `%${q}%`)
      .order('page_no')

    setSearching(false)
    setSearched(true)

    if (error) {
      setSearchError('検索に失敗しました')
      return
    }

    const pages = (data ?? []).map((r) => r.page_no as number)
    setSearchResults(pages)
    setResultIndex(0)
    if (pages.length > 0) goTo(pages[0])
  }, [searchQuery, selectedRound]) // eslint-disable-line react-hooks/exhaustive-deps

  const goPrevResult = () => {
    if (searchResults.length === 0) return
    const next = (resultIndex - 1 + searchResults.length) % searchResults.length
    setResultIndex(next)
    goTo(searchResults[next])
  }

  const goNextResult = () => {
    if (searchResults.length === 0) return
    const next = (resultIndex + 1) % searchResults.length
    setResultIndex(next)
    goTo(searchResults[next])
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults([])
    setSearched(false)
    setSearchError('')
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
              onClick={() => { setSelectedRound(m.round); setCurrentPage(1); clearSearch() }}
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

      {/* テキストエディタ風検索バー */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm select-none">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="選手名・種目名を入力して Enter"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={clearSearch} className="text-slate-500 hover:text-white text-lg leading-none">×</button>
          )}
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="rounded-md bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {searching ? '…' : '検索'}
          </button>
        </div>

        {/* 結果ナビゲーション */}
        {searched && !searching && (
          <div className="flex items-center gap-3 border-t border-slate-700 pt-2">
            {searchError ? (
              <span className="text-xs text-red-400">{searchError}</span>
            ) : searchResults.length === 0 ? (
              <span className="text-xs text-slate-400">「{searchQuery}」は見つかりませんでした</span>
            ) : (
              <>
                <span className="text-xs text-slate-300">
                  <span className="font-bold text-white">{resultIndex + 1}</span>
                  <span className="text-slate-500"> / </span>
                  <span>{searchResults.length}</span>
                  <span className="text-slate-500 ml-1">件</span>
                  <span className="ml-2 text-slate-400">p.{searchResults[resultIndex]}</span>
                </span>
                <div className="flex gap-1 ml-auto">
                  <button
                    onClick={goPrevResult}
                    disabled={searchResults.length <= 1}
                    className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:border-sky-500 hover:text-white disabled:opacity-30"
                  >
                    ▲ 前
                  </button>
                  <button
                    onClick={goNextResult}
                    disabled={searchResults.length <= 1}
                    className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:border-sky-500 hover:text-white disabled:opacity-30"
                  >
                    次 ▼
                  </button>
                </div>
              </>
            )}
          </div>
        )}
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

        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2 text-slate-300">
            <span className="font-bold text-white">{currentPage}</span>
            <span className="text-slate-500">/</span>
            <span>{totalPages}</span>
          </div>
          {/* ジャンプ */}
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJump()}
              placeholder="p."
              min={1}
              max={totalPages}
              className="w-16 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-white placeholder-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <button
              onClick={handleJump}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
            >
              GO
            </button>
          </div>
        </div>

        <button
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 transition-all hover:border-sky-500 hover:text-white disabled:opacity-30"
        >
          次 →
        </button>
      </div>

      {/* 画像 — 検索ヒット時は赤枠 */}
      <div className={`overflow-hidden rounded-2xl border-2 transition-all ${
        isSearchHitPage ? 'border-red-500 shadow-lg shadow-red-500/30' : 'border-slate-700'
      } bg-slate-950`}>
        {isSearchHitPage && (
          <div className="flex items-center gap-2 bg-red-950/60 px-4 py-1.5">
            <span className="text-xs font-bold text-red-300">
              検索結果 {resultIndex + 1}/{searchResults.length} — 「{searchQuery}」を含むページ
            </span>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={`${selectedRound}-${currentPage}`}
          src={pageUrl(selectedRound, currentPage)}
          alt={`第${selectedRound}回 p.${currentPage}`}
          className="w-full"
        />
      </div>

      {/* テキストパネル */}
      <div className="rounded-2xl border border-slate-700 bg-slate-950 overflow-hidden">
        <button
          onClick={() => {
            setShowText((v) => !v)
            setPageText('')
          }}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-900 transition-colors"
        >
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
            OCR テキスト — p.{currentPage}
          </span>
          <span className="text-slate-500 text-sm">{showText ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>

        {showText && (
          <div className="border-t border-slate-800 px-4 py-3">
            {pageText ? (
              <pre className="font-mono text-xs leading-relaxed text-slate-300">
                {renderHighlighted(pageText, searchQuery)}
              </pre>
            ) : (
              <p className="text-xs text-slate-500">読み込み中…</p>
            )}
          </div>
        )}
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
