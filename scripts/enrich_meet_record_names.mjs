import fs from 'node:fs'

const files = process.argv.slice(2)
const targetFiles = files.length > 0
  ? files
  : ['data/mst_meet_records.csv', 'data/mst_meet_records_long.csv']

const RELAY_SEP = '・'

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

function compact(value) {
  return String(value || '').replace(/[ \u3000]+/g, '')
}

function normalizeTeamName(team) {
  return compact(team).replace(/^Ｓ/, 'S').replace(/^ＣＳ/, 'CS')
}

function splitIndividual(raw) {
  const parts = String(raw || '').trim().split(/ +/)
  if (parts.length < 2) return { athleteName: compact(raw), teamName: '' }
  const teamName = parts.at(-1)
  const athleteName = compact(parts.slice(0, -1).join(''))
  return { athleteName, teamName }
}

function hasSep(value) {
  return String(value || '').includes(RELAY_SEP)
}

function mergeMembers(chunks) {
  return chunks
    .join(RELAY_SEP)
    .replace(/・+/g, RELAY_SEP)
    .replace(/^・|・$/g, '')
    .replace(/[ \u3000]+/g, '')
}

function parseRelay(raw) {
  const parts = String(raw || '')
    .trim()
    .split(/ +/)
    .filter(Boolean)
    .filter((part) => part !== '-' && !/^\d+$/.test(part))

  for (let idx = 1; idx < parts.length - 1; idx += 1) {
    const team = normalizeTeamName(parts[idx])
    const leftRaw = parts.slice(0, idx).join('')
    const rightRaw = parts.slice(idx + 1).join('')
    if (team && !hasSep(team) && hasSep(leftRaw) && hasSep(rightRaw)) {
      return {
        athleteName: mergeMembers([leftRaw, rightRaw]),
        teamName: team,
      }
    }
  }

  if (parts.length >= 3 && !hasSep(parts[0])) {
    const memberTokens = parts.slice(1).filter(hasSep)
    const athleteName = mergeMembers(memberTokens)
    if (athleteName.split(RELAY_SEP).length >= 4) {
      return {
        athleteName,
        teamName: normalizeTeamName(parts[0]),
      }
    }
  }

  return { athleteName: compact(raw), teamName: '' }
}

for (const file of targetFiles) {
  const raw = fs.readFileSync(file, 'utf8')
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const rows = parseCsv(raw.replace(/^\uFEFF/, ''))
  const header = rows[0]
  for (const column of ['athlete_name', 'team_name']) {
    if (!header.includes(column)) header.push(column)
  }

  const index = Object.fromEntries(header.map((key, idx) => [key, idx]))
  let individualChanged = 0
  let relayChanged = 0
  let relayWithoutTeam = 0

  for (const row of rows.slice(1)) {
    while (row.length < header.length) row.push('')
    const rawName = row[index.name_team_raw]
    const isRelay = row[index.is_relay] === '1'
    const parsed = isRelay ? parseRelay(rawName) : splitIndividual(rawName)
    row[index.athlete_name] = parsed.athleteName
    row[index.team_name] = parsed.teamName

    if (isRelay) {
      relayChanged += 1
      if (!parsed.teamName) relayWithoutTeam += 1
    } else {
      individualChanged += 1
    }
  }

  fs.writeFileSync(
    file,
    `${bom}${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`,
    'utf8',
  )
  console.log(`${file}: individuals=${individualChanged} relays=${relayChanged} relay_without_team=${relayWithoutTeam}`)
}
