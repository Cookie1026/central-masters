"""
第80回 谷津チーム 混合4×50mフリーリレー（混合）240～279歳 失格の
dt_player_relay レコードを追加する

メンバー:
  1. 猪野 周九
  2. 小島 律子
  3. 堀内 浩子
  4. 温井 芳浩

使い方:
  python scripts/fix_relay_dq_80.py [--dry-run]
"""

import sys
import unicodedata

try:
    from dotenv import load_dotenv
    load_dotenv('.env.local')
except ImportError:
    pass

try:
    from supabase import create_client, Client
except ImportError:
    print("pip install supabase python-dotenv")
    sys.exit(1)

DRY_RUN = '--dry-run' in sys.argv

import os
url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
key = os.environ.get('SUPABASE_SERVICE_KEY', '') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
if not url or not key:
    print("ERROR: Supabase env vars not set")
    sys.exit(1)

supabase: Client = create_client(url, key)

def normalize(s: str) -> str:
    return unicodedata.normalize('NFKC', s).replace(' ', '').replace('　', '')

# --- 1. Find the relay result ---
print("=== 1. Finding relay result ===")
# event_id = 7 (第80回)
# team = 谷津
# category = 4×50mフリーリレー（混合）
# age = 240～279歳
# Should have rank=NULL, time_seconds=NULL, disqualification_code='競12'

# First find event_id for round 80
event_resp = supabase.table('mst_event').select('id, round').eq('round', 80).execute()
if not event_resp.data:
    print("ERROR: Round 80 event not found")
    sys.exit(1)
event_id = event_resp.data[0]['id']
print(f"  event_id for round 80: {event_id}")

# Find team_id for 谷津
team_resp = supabase.table('mst_team').select('id, name').ilike('name', '%谷津%').execute()
print(f"  Teams matching 谷津: {[(t['id'], t['name']) for t in team_resp.data]}")

# Also check alias
alias_resp = supabase.table('mst_team_alias').select('team_id, alias').ilike('alias', '%谷津%').execute()
print(f"  Aliases matching 谷津: {[(a['team_id'], a['alias']) for a in alias_resp.data]}")

team_id = None
if team_resp.data:
    team_id = team_resp.data[0]['id']
elif alias_resp.data:
    team_id = alias_resp.data[0]['team_id']

if not team_id:
    print("ERROR: Team 谷津 not found")
    sys.exit(1)
print(f"  team_id: {team_id}")

# Find the relay result
relay_resp = supabase.table('dt_result_relay').select('id, event_id, team_id, disqualification_code') \
    .eq('event_id', event_id) \
    .eq('team_id', team_id) \
    .is_('rank', 'null') \
    .execute()

print(f"  dt_result_relay candidates: {relay_resp.data}")

if not relay_resp.data:
    print("ERROR: Relay DQ result not found in DB")
    sys.exit(1)

relay_result_id = relay_resp.data[0]['id']
print(f"  relay_result_id: {relay_result_id}")

# Check if dt_player_relay already has entries
existing = supabase.table('dt_player_relay').select('id, swim_order').eq('relay_result_id', relay_result_id).execute()
print(f"  Existing dt_player_relay entries: {existing.data}")
if existing.data:
    print("  Members already exist! Exiting.")
    sys.exit(0)

# --- 2. Find player IDs ---
print("\n=== 2. Finding player IDs ===")
MEMBERS = [
    (1, '猪野周九'),
    (2, '小島律子'),
    (3, '堀内浩子'),
    (4, '温井芳浩'),
]

# Paginate through all dt_player_person
all_players = []
offset = 0
PAGE = 1000
while True:
    resp = supabase.table('dt_player_person').select('id, name, team_id').range(offset, offset + PAGE - 1).execute()
    batch = resp.data or []
    all_players.extend(batch)
    if len(batch) < PAGE:
        break
    offset += PAGE
print(f"  Total players: {len(all_players)}")

player_map = {}
for p in all_players:
    key = normalize(p['name'])
    if key not in player_map:
        player_map[key] = []
    player_map[key].append(p)

inserts = []
for swim_order, raw_name in MEMBERS:
    name_norm = normalize(raw_name)
    candidates = player_map.get(name_norm, [])
    # Prefer same team
    same_team = [c for c in candidates if c['team_id'] == team_id]
    chosen = same_team[0] if same_team else (candidates[0] if candidates else None)
    status = 'OK' if chosen else 'NOT FOUND'
    team_match = f"(team_id={chosen['team_id']})" if chosen else ''
    print(f"  {swim_order}. {raw_name} -> {status} player_id={chosen['id'] if chosen else None} {team_match}")
    if chosen:
        inserts.append({'relay_result_id': relay_result_id, 'player_id': chosen['id'], 'swim_order': swim_order})
    else:
        print(f"  ERROR: Player {raw_name} not found")
        sys.exit(1)

# --- 3. Insert ---
print(f"\n=== 3. Inserting {len(inserts)} dt_player_relay records ===")
for row in inserts:
    print(f"  {row}")

if DRY_RUN:
    print("\n[DRY RUN] No changes made.")
else:
    resp = supabase.table('dt_player_relay').insert(inserts).execute()
    if resp.data:
        print(f"  Inserted {len(resp.data)} records: IDs={[r['id'] for r in resp.data]}")
    else:
        print(f"  ERROR: {resp}")
