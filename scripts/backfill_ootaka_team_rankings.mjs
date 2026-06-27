import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const apply = process.argv.includes('--apply')

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const sources = [
  [74, '第74回(短水路)'],
  [75, '第75回(長水路)'],
  [76, '第76回(短水路)'],
  [77, '第77回(長水路)'],
  [78, '第78回(長水路)'],
  [79, '第79回(短水路)'],
  [80, '第80回(長水路)'],
]

function parseOotakaRow(round, folder) {
  const file = path.join('マスターズPDF', folder, `第${round}回M総合成績.csv`)
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const headers = lines[0].split(',')
  const row = lines.slice(1).find((line) => line.includes('おおたか'))
  if (!row) throw new Error(`第${round}回におおたかの行がありません`)

  const values = row.split(',')
  const get = (name) => values[headers.indexOf(name)]
  const number = (name) => {
    const value = Number(String(get(name) ?? '').replace(/[^\d.-]/g, ''))
    return Number.isFinite(value) ? value : null
  }

  return {
    round,
    rank: number('順位'),
    total_points: number('得点'),
    male_points: number('男子'),
    female_points: number('女子'),
    mixed_points: number('混合'),
  }
}

const sourceRows = sources.map(([round, folder]) => parseOotakaRow(round, folder))
const [{ data: events, error: eventError }, { data: teams, error: teamError }] = await Promise.all([
  supabase.from('mst_event').select('id, round').in('round', sourceRows.map((row) => row.round)),
  supabase.from('mst_team').select('id, name').ilike('name', '%おおたか%'),
])

if (eventError) throw eventError
if (teamError) throw teamError
if (!teams?.length) throw new Error('おおたかのチームマスターが見つかりません')

const team = teams.find((item) => item.name === 'セ・おおたか') ?? teams[0]
const eventByRound = new Map((events ?? []).map((event) => [event.round, event.id]))
const rows = sourceRows.map((row) => {
  const eventId = eventByRound.get(row.round)
  if (!eventId) throw new Error(`第${row.round}回の大会マスターが見つかりません`)
  return {
    event_id: eventId,
    team_id: team.id,
    rank: row.rank,
    total_points: row.total_points,
    male_points: row.male_points,
    female_points: row.female_points,
    mixed_points: row.mixed_points,
  }
})

console.table(sourceRows)

if (!apply) {
  console.log('DRY RUN: --apply を付けるとSupabaseへ反映します')
} else {
  const { error } = await supabase
    .from('dt_ranking_team')
    .upsert(rows, { onConflict: 'event_id,team_id' })
  if (error) throw error
  console.log(`おおたかのチーム順位を${rows.length}大会分反映しました`)
}
