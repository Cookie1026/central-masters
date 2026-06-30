import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const CSV_PATH = process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[1] && arg !== process.argv[0]) ?? 'data/mst_meet_records.csv'
const DRY_RUN = process.argv.includes('--dry-run')
const CHUNK_SIZE = 500

function loadEnv(path = '.env.local') {
  if (!fs.existsSync(path)) return
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (!match) continue
    const key = match[1].trim()
    if (!process.env[key]) process.env[key] = match[2].trim()
  }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (quoted) {
      if (ch === '"' && next === '"') {
        value += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        value += ch
      }
      continue
    }

    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(value)
      value = ''
    } else if (ch === '\n') {
      row.push(value.replace(/\r$/, ''))
      rows.push(row)
      row = []
      value = ''
    } else {
      value += ch
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ''))
    rows.push(row)
  }

  const header = rows.shift()
  if (!header) return []

  return rows
    .filter((cells) => cells.some((cell) => cell !== ''))
    .map((cells, rowIndex) => {
      if (cells.length !== header.length) {
        throw new Error(`CSV column mismatch at line ${rowIndex + 2}: expected ${header.length}, got ${cells.length}`)
      }
      return Object.fromEntries(header.map((key, index) => [key, cells[index]]))
    })
}

function parseDate(value) {
  if (!value) return null
  const match = value.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function normalizeRecordTime(value) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d+)-(\d{2})-(\d{2})$/)
  if (match) return `${match[1]}:${match[2]}.${match[3]}`

  const secondsMatch = text.match(/^(\d{1,2})-(\d{2})$/)
  if (secondsMatch) return `${secondsMatch[1]}.${secondsMatch[2]}`

  return text
}

function normalizeGender(value) {
  const text = String(value ?? '').trim()
  if (text === '男' || text === '男子') return '男性'
  if (text === '女' || text === '女子') return '女性'
  return text
}

function tableForCourse(course) {
  return course === '長水路' ? 'mst_record_tournament_long' : 'mst_record_tournament_short'
}

function toRecord(row) {
  return {
    course: row.course,
    gender: normalizeGender(row.gender),
    event: row.event,
    distance: row.distance,
    age_group: Number.parseInt(row.age_group, 10),
    is_relay: row.is_relay === '1',
    name_team_raw: row.name_team_raw,
    record: normalizeRecordTime(row.record),
    established_date: parseDate(row.established_date),
    athlete_name: row.athlete_name || null,
    team_name: row.team_name || null,
  }
}

loadEnv()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!DRY_RUN && (!supabaseUrl || !supabaseKey)) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
}

const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, ''))
const records = rows.map(toRecord)
const duplicateKeys = new Set()
const seenKeys = new Set()

for (const record of records) {
  const key = [record.course, record.gender, record.event, record.distance, record.age_group].join('|')
  if (seenKeys.has(key)) duplicateKeys.add(key)
  seenKeys.add(key)
}

if (duplicateKeys.size > 0) {
  throw new Error(`Duplicate record keys found: ${Array.from(duplicateKeys).slice(0, 5).join(', ')}`)
}

const recordsByTable = records.reduce((acc, record) => {
  const table = tableForCourse(record.course)
  acc[table] ??= []
  acc[table].push(record)
  return acc
}, {})

for (const [table, tableRecords] of Object.entries(recordsByTable)) {
  const courseCounts = tableRecords.reduce((acc, record) => {
    acc[record.course] = (acc[record.course] ?? 0) + 1
    return acc
  }, {})
  console.log(`${table}: ${tableRecords.length} records ${JSON.stringify(courseCounts)}`)
}

if (DRY_RUN) {
  console.log('Dry run complete')
  process.exit(0)
}

const supabase = createClient(supabaseUrl, supabaseKey)

for (const [table, tableRecords] of Object.entries(recordsByTable)) {
  const courses = Array.from(new Set(tableRecords.map((record) => record.course))).sort()

  for (const course of courses) {
    const { error } = await supabase.from(table).delete().eq('course', course)
    if (error) throw new Error(`${table}: failed to delete ${course}: ${error.message}`)
  }

  for (let i = 0; i < tableRecords.length; i += CHUNK_SIZE) {
    const chunk = tableRecords.slice(i, i + CHUNK_SIZE)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) throw new Error(`${table}: failed to insert rows ${i + 1}-${i + chunk.length}: ${error.message}`)
    console.log(`${table}: inserted ${i + chunk.length}/${tableRecords.length}`)
  }
}

console.log(`Done: ${records.length} records imported`)
