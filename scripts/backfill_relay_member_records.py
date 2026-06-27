#!/usr/bin/env python3
"""
リレーメンバーの記録フラグをバックフィルする。
事前に dt_player_relay に is_meet_record / is_japan_record / is_world_record 列を追加しておくこと。

対象:
  74回(event_id=1): 参照CSV 大会新 → is_meet_record
  75回(event_id=2): 参照CSV 大会新 → is_meet_record
  80回(event_id=7): 参照CSV 大会新 → is_meet_record
  80回(event_id=7): 永瀬秀子 女子4×50mフリーリレー 240〜279歳 泳順1 → is_japan_record
"""
import sys, os, unicodedata, argparse
sys.stdout.reconfigure(encoding='utf-8')
import pandas as pd
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

# ── ユーティリティ ──────────────────────────────────────────────────

def norm(s: str) -> str:
    """全角→半角、空白除去、NFKC正規化"""
    s = unicodedata.normalize('NFKC', str(s).strip())
    return s.replace('　', ' ').strip()

def to_bool_flag(v) -> bool:
    return bool(v) and str(v).strip() not in ('', 'False', 'false', 'nan', 'NaN', '0', 'None')

# ── キャッシュ ──────────────────────────────────────────────────────

def load_event_map():
    """round → event_id"""
    res = sb.table('mst_event').select('id,round').execute()
    return {r['round']: r['id'] for r in res.data}

def load_category_map():
    """(name, gender) → [id, ...] (リレー種目、pool_type違い複数あり) — キーをNFKC正規化済み"""
    res = sb.table('mst_category').select('id,name,gender').eq('type','リレー').execute()
    m: dict[tuple, list[int]] = {}
    for r in res.data:
        key = (norm(r['name']), r['gender'])
        m.setdefault(key, []).append(r['id'])
    return m

def load_age_map():
    """name → id (type=リレー) — キーをNFKC正規化済み"""
    res = sb.table('mst_age').select('id,name').eq('type','リレー').execute()
    return {norm(r['name']): r['id'] for r in res.data}

def load_team_map():
    """name → id  /  norm_team(name) → id  (両方格納)"""
    res = sb.table('mst_team').select('id,name').execute()
    m = {}
    for r in res.data:
        m[norm(r['name'])]       = r['id']
        m[norm_team(r['name'])]  = r['id']  # prefix除去版も登録
    return m

# ── マッチング ──────────────────────────────────────────────────────

TEAM_STRIP = ['セ・', 'CS ', 'ザバス ', 'クリーンスパ ', 'ミズノ ', 'JS ', '東京SC ']

def norm_team(name: str) -> str:
    n = norm(name)
    for prefix in TEAM_STRIP:
        if n.startswith(prefix):
            return n[len(prefix):]
    return n

def find_relay_result_id(event_id, cat_ids, age_id, team_id, rank) -> int | None:
    res = sb.table('dt_result_relay').select('id').eq('event_id', event_id)
    if cat_ids: res = res.in_('category_id', cat_ids)
    if age_id:  res = res.eq('age_id', age_id)
    if team_id: res = res.eq('team_id', team_id)
    if rank:    res = res.eq('rank', rank)
    rows = res.execute()
    if len(rows.data) == 1:
        return rows.data[0]['id']
    return None

def find_player_relay_id(relay_result_id, swim_order) -> int | None:
    res = sb.table('dt_player_relay').select('id').eq('relay_result_id', relay_result_id).eq('swim_order', swim_order).execute()
    if res.data:
        return res.data[0]['id']
    return None

def set_flag(player_relay_id: int, field: str, dry_run: bool):
    if dry_run:
        print(f'  [DRY] UPDATE dt_player_relay id={player_relay_id} {field}=True')
    else:
        sb.table('dt_player_relay').update({field: True}).eq('id', player_relay_id).execute()

# ── メイン ──────────────────────────────────────────────────────────

def process_reference_csv(round_no: int, csv_path: str, event_map: dict, cat_map: dict, age_map: dict, team_map: dict, dry_run: bool):
    event_id = event_map.get(round_no)
    if not event_id:
        print(f'第{round_no}回: event_id 不明')
        return

    df = pd.read_csv(csv_path, encoding='utf-8-sig')
    mbr = df[df['リレー泳順'].notna() & df['選手名'].notna()].copy()

    # 大会新フラグ付きメンバーのみ
    flagged = mbr[mbr['大会新'].apply(to_bool_flag)]
    print(f'第{round_no}回: 大会新フラグあり = {len(flagged)}件 (全メンバー{len(mbr)}件)')

    updated = 0
    miss = 0
    for _, row in flagged.iterrows():
        cat_name = norm(row.get('競技名',''))
        gender   = norm(row.get('競技性別',''))
        age_name = norm(row.get('リレー年齢区分',''))
        team_raw = norm(row.get('チーム名',''))
        rank     = int(row['順位']) if str(row.get('順位','')).strip().isdigit() else None
        sw_order = int(row['リレー泳順'])

        cat_ids = cat_map.get((cat_name, gender), [])
        age_id  = age_map.get(age_name)
        team_id = team_map.get(norm(team_raw)) or team_map.get(norm_team(team_raw))

        relay_result_id = find_relay_result_id(event_id, cat_ids, age_id, team_id, rank)
        if not relay_result_id:
            print(f'  MISS relay_result: {cat_name} {gender} {age_name} {team_raw} rank={rank}')
            miss += 1
            continue

        pr_id = find_player_relay_id(relay_result_id, sw_order)
        if not pr_id:
            print(f'  MISS player_relay: relay_result_id={relay_result_id} swim_order={sw_order} ({row.get("選手名","")})')
            miss += 1
            continue

        set_flag(pr_id, 'is_meet_record', dry_run)
        updated += 1

    print(f'  → updated={updated} miss={miss}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    event_map = load_event_map()
    cat_map   = load_category_map()
    age_map   = load_age_map()
    team_map  = load_team_map()

    print(f'event_map: {event_map}')
    print(f'age_map keys (リレー): {list(age_map.keys())[:10]}')
    print()

    # 74回
    process_reference_csv(
        74, 'data/第74回競技結果（チーム）.csv',
        event_map, cat_map, age_map, team_map, args.dry_run
    )

    # 75回
    process_reference_csv(
        75, 'data/第75回競技結果（チーム）.csv',
        event_map, cat_map, age_map, team_map, args.dry_run
    )

    # 80回
    process_reference_csv(
        80, 'data/第80回競技結果（チーム）.csv',
        event_map, cat_map, age_map, team_map, args.dry_run
    )

    # 永瀬秀子 女子4×50mフリーリレー 240〜279歳 → is_japan_record
    print()
    print('=== 永瀬秀子 日本新バックフィル ===')
    event_id = event_map.get(80)
    cat_ids  = cat_map.get((norm('4×50mフリーリレー'), '女子'), [])
    age_id   = age_map.get(norm('240～279歳'))

    # セ・二俣川のteam_id
    team_id = team_map.get('セ・二俣川')
    if not team_id:
        for t_name, t_id in team_map.items():
            if '二俣川' in t_name:
                team_id = t_id
                print(f'  team found: {t_name} id={t_id}')
                break

    print(f'  event_id={event_id} cat_ids={cat_ids} age_id={age_id} team_id={team_id}')

    rr_id = find_relay_result_id(event_id, cat_ids, age_id, team_id, None)
    if not rr_id:
        print('  rank指定なしで再検索:')
        q = sb.table('dt_result_relay').select('id,rank').eq('event_id', event_id)
        if cat_id:  q = q.eq('category_id', cat_id)
        if age_id:  q = q.eq('age_id', age_id)
        if team_id: q = q.eq('team_id', team_id)
        res = q.execute()
        print(f'  候補: {res.data}')
        if res.data:
            rr_id = res.data[0]['id']

    if not rr_id:
        print('  ERROR: relay_result_id 見つからず')
    else:
        pr_id = find_player_relay_id(rr_id, 1)  # swim_order=1 が 永瀬秀子
        if not pr_id:
            print(f'  ERROR: player_relay 見つからず relay_result_id={rr_id} swim_order=1')
        else:
            set_flag(pr_id, 'is_japan_record', args.dry_run)
            print(f'  OK: player_relay id={pr_id} is_japan_record=True')


if __name__ == '__main__':
    main()
