import fs from 'node:fs'

const files = process.argv.slice(2)
const targetFiles = files.length > 0
  ? files
  : ['data/mst_meet_records.csv', 'data/mst_meet_records_long.csv']

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

    if (ch === '"') quoted = true
    else if (ch === ',') {
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

  return rows.filter((cells) => cells.some((cell) => cell !== ''))
}

function escapeCsv(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function normalizeRecordTime(value) {
  const text = String(value ?? '').trim()
  const minuteMatch = text.match(/^(\d+)-(\d{2})-(\d{2})$/)
  if (minuteMatch) return `${minuteMatch[1]}:${minuteMatch[2]}.${minuteMatch[3]}`

  const secondsMatch = text.match(/^(\d{1,2})-(\d{2})$/)
  if (secondsMatch) return `${secondsMatch[1]}.${secondsMatch[2]}`

  return text
}

for (const file of targetFiles) {
  const raw = fs.readFileSync(file, 'utf8')
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const rows = parseCsv(raw.replace(/^\uFEFF/, ''))
  const header = rows[0]
  const recordIndex = header?.indexOf('record') ?? -1
  if (recordIndex < 0) throw new Error(`${file}: record column not found`)

  let changed = 0
  for (const row of rows.slice(1)) {
    const next = normalizeRecordTime(row[recordIndex])
    if (next !== row[recordIndex]) {
      row[recordIndex] = next
      changed += 1
    }
  }

  fs.writeFileSync(
    file,
    `${bom}${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`,
    'utf8',
  )
  console.log(`${file}: changed ${changed}`)
}
