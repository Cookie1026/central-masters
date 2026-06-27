import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ── 得点計算ヘルパー ──────────────────────────────────────────
// 個人: 1位=10pt〜10位=1pt、11位以降=0pt + 記録ボーナス(大会新/日本新/世界新 各+10pt)
// リレー: 同上 + 大会新のみ+10pt (日本新・世界新フラグなし)
function calcIndPoints(rank, isMeetRecord, isJapanRecord, isWorldRecord) {
  const rankPt = (rank >= 1 && rank <= 10) ? (11 - rank) : 0
  const bonus = (isMeetRecord ? 10 : 0) + (isJapanRecord ? 10 : 0) + (isWorldRecord ? 10 : 0)
  return rankPt + bonus
}
function calcRelayPoints(rank, isMeetRecord) {
  const rankPt = (rank >= 1 && rank <= 10) ? (11 - rank) : 0
  return rankPt + (isMeetRecord ? 10 : 0)
}

// ── 個人成績 全件チェック ─────────────────────────────────────
console.log('個人成績チェック中...')
let indOffset = 0
const IND_BATCH = 1000
const indFixes = []

while (true) {
  const { data, error } = await supabase
    .from('dt_result_person')
    .select('id, rank, points, is_meet_record, is_japan_record, is_world_record, mst_event!inner(round)')
    .range(indOffset, indOffset + IND_BATCH - 1)
    .order('id')
  if (error) { console.error(error.message); break }
  if (!data.length) break

  for (const r of data) {
    if (r.rank == null) continue
    const expected = calcIndPoints(r.rank, r.is_meet_record, r.is_japan_record, r.is_world_record)
    const actual = r.points != null ? Math.round(Number(r.points)) : null
    if (actual !== expected) {
      indFixes.push({ id: r.id, round: r.mst_event.round, rank: r.rank, actual, expected })
    }
  }
  indOffset += IND_BATCH
  if (data.length < IND_BATCH) break
}

// 大会回別集計
const indByRound = {}
for (const f of indFixes) {
  if (!indByRound[f.round]) indByRound[f.round] = []
  indByRound[f.round].push(f)
}
console.log('\n=== 個人成績 得点不一致 ===')
if (Object.keys(indByRound).length === 0) {
  console.log('  なし（全件正常）')
} else {
  for (const [round, fixes] of Object.entries(indByRound).sort((a,b)=>Number(a[0])-Number(b[0]))) {
    const nullCount = fixes.filter(f => f.actual == null).length
    const mismatch = fixes.filter(f => f.actual != null).length
    console.log(`  第${round}回: 得点null ${nullCount}件 / 値違い ${mismatch}件`)
  }
}

// ── リレー成績 全件チェック ───────────────────────────────────
console.log('\nリレー成績チェック中...')
let relOffset = 0
const relFixes = []

while (true) {
  const { data, error } = await supabase
    .from('dt_result_relay')
    .select('id, rank, team_points, is_meet_record, mst_event!inner(round)')
    .range(relOffset, relOffset + IND_BATCH - 1)
    .order('id')
  if (error) { console.error(error.message); break }
  if (!data.length) break

  for (const r of data) {
    if (r.rank == null) continue
    const expected = calcRelayPoints(r.rank, r.is_meet_record)
    const actual = r.team_points != null ? Math.round(Number(r.team_points)) : null
    if (actual !== expected) {
      relFixes.push({ id: r.id, round: r.mst_event.round, rank: r.rank, actual, expected })
    }
  }
  relOffset += IND_BATCH
  if (data.length < IND_BATCH) break
}

const relByRound = {}
for (const f of relFixes) {
  if (!relByRound[f.round]) relByRound[f.round] = []
  relByRound[f.round].push(f)
}
console.log('\n=== リレー成績 得点不一致 ===')
if (Object.keys(relByRound).length === 0) {
  console.log('  なし（全件正常）')
} else {
  for (const [round, fixes] of Object.entries(relByRound).sort((a,b)=>Number(a[0])-Number(b[0]))) {
    const nullCount = fixes.filter(f => f.actual == null).length
    const mismatch = fixes.filter(f => f.actual != null).length
    console.log(`  第${round}回: 得点null ${nullCount}件 / 値違い ${mismatch}件`)
  }
}

console.log(`\n修正候補: 個人 ${indFixes.length}件 / リレー ${relFixes.length}件`)
console.log('\n修正を適用するには: node fix_missing_points.mjs --fix で実行')

// ── 修正適用 ─────────────────────────────────────────────────
const doFix = process.argv.includes('--fix')
if (doFix) {
  console.log('\n--- 修正適用中 ---')
  // 個人
  let indFixed = 0
  for (let i = 0; i < indFixes.length; i += 100) {
    const chunk = indFixes.slice(i, i + 100)
    for (const f of chunk) {
      await supabase.from('dt_result_person').update({ points: f.expected }).eq('id', f.id)
    }
    indFixed += chunk.length
    process.stdout.write(`\r個人: ${indFixed}/${indFixes.length}件`)
  }
  console.log('\n')
  // リレー
  let relFixed = 0
  for (const f of relFixes) {
    await supabase.from('dt_result_relay').update({ team_points: f.expected }).eq('id', f.id)
    relFixed++
    if (relFixed % 50 === 0) process.stdout.write(`\rリレー: ${relFixed}/${relFixes.length}件`)
  }
  console.log(`\rリレー: ${relFixed}/${relFixes.length}件完了`)
  console.log('\n修正完了!')
}
