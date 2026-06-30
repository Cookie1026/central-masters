import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are required')
}

const supabase = createClient(supabaseUrl, supabaseKey)
const APPLY = process.argv.includes('--apply')
const SEP = '・'

const manualOverrides = new Map([
  [324, { team: '西京極', members: '田中・辻・森名・秋山' }],
])

function compact(value) {
  return String(value || '').replace(/[ \u3000]+/g, '')
}

function hasSep(value) {
  return String(value || '').includes(SEP)
}

function normalizeTeamName(team) {
  return compact(team).replace(/^Ｓ/, 'S').replace(/^ＣＳ/, 'CS')
}

function splitParts(raw) {
  return String(raw || '')
    .trim()
    .split(/ +/)
    .filter(Boolean)
    .filter((part) => part !== '-' && !/^\d+$/.test(part))
}

function mergeMembers(chunks) {
  return chunks
    .join(SEP)
    .replace(/・+/g, SEP)
    .replace(/^・|・$/g, '')
    .replace(/[ \u3000]+/g, '')
}

function buildCandidates(parts, knownTeams = null) {
  const candidates = []

  for (let idx = 1; idx < parts.length - 1; idx++) {
    const team = normalizeTeamName(parts[idx])
    if (!team || hasSep(team)) continue
    if (knownTeams && !knownTeams.has(team)) continue

    const leftRaw = parts.slice(0, idx).join('')
    const rightRaw = parts.slice(idx + 1).join('')
    if (hasSep(leftRaw) && hasSep(rightRaw)) {
      candidates.push({
        team,
        members: mergeMembers([leftRaw, rightRaw]),
        mode: 'team-middle',
      })
    }
  }

  if (!knownTeams && parts.length >= 3 && !hasSep(parts[0])) {
    const memberTokens = parts.slice(1).filter(hasSep)
    const members = mergeMembers(memberTokens)
    if (members.split(SEP).length >= 4) {
      candidates.push({
        team: normalizeTeamName(parts[0]),
        members,
        mode: 'team-first',
      })
    }
  }

  return candidates.filter((candidate) => candidate.members.split(SEP).length >= 4)
}

function pickUnique(candidates) {
  if (candidates.length !== 1) return null
  return candidates[0]
}

async function main() {
  const { data, error } = await supabase
    .from('mst_record_tournament_short')
    .select('id, name_team_raw, athlete_name, team_name')
    .eq('is_relay', true)
    .order('id')

  if (error) throw error

  const knownTeams = new Set()
  const parsed = new Map()
  const unresolved = []

  for (const row of data ?? []) {
    const unique = pickUnique(buildCandidates(splitParts(row.name_team_raw)))
    if (unique) {
      parsed.set(row.id, unique)
      knownTeams.add(unique.team)
    } else {
      unresolved.push(row)
    }
  }

  for (const row of unresolved) {
    const manual = manualOverrides.get(row.id)
    if (manual) {
      parsed.set(row.id, manual)
      knownTeams.add(manual.team)
      continue
    }

    const unique = pickUnique(buildCandidates(splitParts(row.name_team_raw), knownTeams))
    if (unique) {
      parsed.set(row.id, unique)
      knownTeams.add(unique.team)
    }
  }

  const missing = (data ?? [])
    .filter((row) => !parsed.has(row.id))
    .map((row) => ({ id: row.id, raw: row.name_team_raw }))

  if (missing.length > 0) {
    console.error('Unresolved relay rows:')
    console.error(JSON.stringify(missing, null, 2))
    process.exit(1)
  }

  const updates = (data ?? []).map((row) => {
    const fixed = parsed.get(row.id)
    return {
      id: row.id,
      team_name: fixed.team,
      athlete_name: fixed.members,
      name_team_raw: fixed.members,
    }
  })

  console.log(`relay rows: ${updates.length}`)
  console.log('sample:')
  console.log(JSON.stringify(updates.slice(0, 8), null, 2))

  if (!APPLY) {
    console.log('dry-run only. re-run with --apply to update Supabase.')
    return
  }

  for (const row of updates) {
    const { error: updateError } = await supabase
      .from('mst_record_tournament_short')
      .update({
        team_name: row.team_name,
        athlete_name: row.athlete_name,
        name_team_raw: row.name_team_raw,
      })
      .eq('id', row.id)

    if (updateError) {
      throw new Error(`failed to update id=${row.id}: ${updateError.message}`)
    }
  }

  console.log(`updated ${updates.length} relay rows`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
