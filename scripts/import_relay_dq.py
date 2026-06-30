"""
リレー失格インポートスクリプト
第78回（長水路）・第79回（短水路）のリレー失格エントリをDBにINSERT

使い方:
  python scripts/import_relay_dq.py [--dry-run]

  --dry-run : DBを変更せず、解決できた/できないIDを表示して終了
"""

import sys
import os
import unicodedata
import re
from difflib import get_close_matches
from typing import Optional

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

# ================================================================
# TXTから手動抽出したリレー失格データ
# ================================================================
# event_id_round: 78 or 79
# dq_code: '競12', '出2', 'メ6バ8', '競13' など
# members: 泳順通りの選手名リスト

RELAY_DQ_ENTRIES = [
    # ---- 第78回 長水路 ----
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 3,  'gender': '女子',
        'event_name': '4×50mフリーリレー',
        'age_range': '160～199', 'combined_age': 160,
        'team_name': '平塚',      'dq_code': '競12',
        'members': ['佐々木美佐', '比留川美緒', '木田景子', '足立知実'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 11, 'gender': '女子',
        'event_name': '4×50mメドレーリレー',
        'age_range': '280～319', 'combined_age': 282,
        'team_name': '越谷',      'dq_code': '競12',
        'members': ['石田良子', '太田初美', '木村恵子', '坂本光子'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 11, 'gender': '女子',
        'event_name': '4×50mメドレーリレー',
        'age_range': '240～279', 'combined_age': 259,
        'team_name': '天王洲',    'dq_code': '競12',
        'members': ['鈴木由佳里', '櫻田琴', '浅野みどり', '梅田栄己子'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 12, 'gender': '男子',
        'event_name': '4×50mメドレーリレー',
        'age_range': '160～199', 'combined_age': 171,
        'team_name': '長津田',    'dq_code': '競12',
        'members': ['村田拓斗', '祖川久茂', '飯沼明', '竹下翔'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 12, 'gender': '男子',
        'event_name': '4×50mメドレーリレー',
        'age_range': '72～119',  'combined_age': 91,
        'team_name': '成城',      'dq_code': '競12',
        'members': ['服部碧', '黒田大介', '宮田遼太', '板場貴大'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 17, 'gender': '混合',
        'event_name': '4×50mメドレーリレー',
        'age_range': '200～239', 'combined_age': 208,
        'team_name': '大宮宮原',  'dq_code': '競12',
        'members': ['宮川則仁', '川瀬健次', '若林朋子', '花木尚美'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 17, 'gender': '混合',
        'event_name': '4×50mメドレーリレー',
        'age_range': '160～199', 'combined_age': 168,
        'team_name': '葛西',      'dq_code': '競12',
        'members': ['永田加那子', '原田真', '矢野匠', '溝井花代子'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 19, 'gender': '男子',
        'event_name': '4×100mメドレーリレー',
        'age_range': '160～199', 'combined_age': 162,
        'team_name': '天王洲',    'dq_code': 'メ6バ8',
        'members': ['中村翼', '加間英貴', '久保卓士', '宅間健介'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 24, 'gender': '混合',
        'event_name': '4×50mフリーリレー',
        'age_range': '240～279', 'combined_age': 243,
        'team_name': '清瀬',      'dq_code': '競12',
        'members': ['高附直樹', '大芦薫', '大橋ほづ美', '小倉秀和'],
    },
    {
        'event_id_round': 78, 'pool_type': '長水路',
        'race_no': 24, 'gender': '混合',
        'event_name': '4×50mフリーリレー',
        'age_range': '200～239', 'combined_age': 217,
        'team_name': '慶應日吉',  'dq_code': '出2',
        'members': ['河野悟', '上沢絵里奈', '井手敦子', '松崎敏明'],
    },
    # ---- 第79回 短水路 ----
    {
        'event_id_round': 79, 'pool_type': '短水路',
        'race_no': 29, 'gender': '混合',
        'event_name': '4×25mフリーリレー',
        'age_range': '280～319', 'combined_age': 284,
        'team_name': '市ヶ尾',    'dq_code': '競13',
        'members': ['井上隆史', '大雲直子', '太刀岡早苗', '山邊貴史'],
    },
]


# ================================================================
# ユーティリティ
# ================================================================

def norm_name(s: str) -> str:
    return unicodedata.normalize('NFKC', re.sub(r'\s+', '', s.strip()))


def get_client() -> Client:
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not key:
        print("エラー: NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_KEY が必要です。")
        sys.exit(1)
    return create_client(url, key)


# ================================================================
# メイン処理
# ================================================================

def main():
    sb = get_client()

    # ---- マスターデータ取得 ----
    print("マスターデータ取得中...")

    events_res = sb.table('mst_event').select('id, round, pool_type').execute()
    event_map: dict[tuple, int] = {}   # (round, pool_type) -> event_id
    for row in events_res.data:
        event_map[(row['round'], row['pool_type'])] = row['id']
    print(f"  mst_event: {len(event_map)}件")

    teams_res = sb.table('mst_team').select('id, name').execute()
    team_ids: dict[str, int] = {row['name']: row['id'] for row in teams_res.data}

    aliases_res = sb.table('mst_team_alias').select('alias, team_id').execute()
    team_aliases: dict[str, int] = {}
    for row in aliases_res.data:
        team_aliases[norm_name(row['alias'])] = row['team_id']
    print(f"  mst_team: {len(team_ids)}件, alias: {len(team_aliases)}件")

    cats_res = sb.table('mst_category').select('id, name, pool_type, gender').execute()
    category_ids: dict[tuple, int] = {}  # (name, pool_type, gender) -> id
    for row in cats_res.data:
        category_ids[(row['name'], row['pool_type'], row['gender'])] = row['id']
    print(f"  mst_category: {len(category_ids)}件")
    # デバッグ: リレー系カテゴリ名の一覧表示
    relay_cats = sorted({name for (name, _, _) in category_ids if '×' in name})
    print(f"  リレー種目サンプル: {relay_cats[:10]}")

    ages_res = sb.table('mst_age').select('id, name').execute()
    age_ids: dict[str, int] = {row['name']: row['id'] for row in ages_res.data}
    print(f"  mst_age: {len(age_ids)}件")
    print(f"  年齢区分サンプル: {sorted(list(age_ids.keys()))[:10]}")

    # ページネーションで全件取得
    all_players = []
    offset = 0
    page = 1000
    while True:
        res = sb.table('dt_player_person').select('id, name, team_id').range(offset, offset + page - 1).execute()
        all_players.extend(res.data)
        if len(res.data) < page:
            break
        offset += page
    # name -> [(id, team_id)] のマルチマップ
    player_by_name: dict[str, list[tuple[int, int]]] = {}
    player_by_normname: dict[str, list[tuple[int, int]]] = {}
    for row in all_players:
        n = row['name']
        nn = norm_name(n)
        player_by_name.setdefault(n, []).append((row['id'], row['team_id']))
        player_by_normname.setdefault(nn, []).append((row['id'], row['team_id']))
    print(f"  dt_player_person: {len(all_players)}件")

    # ---- 解決関数 ----
    def resolve_team(raw_name: str) -> Optional[int]:
        # 直接マッチ
        if raw_name in team_ids:
            return team_ids[raw_name]
        n = norm_name(raw_name)
        if n in team_ids:
            return team_ids[n]
        # エイリアスマッチ
        if n in team_aliases:
            return team_aliases[n]
        # セ・プレフィックス補完
        for prefix in ('セ・', 'ザバス'):
            cand = f'{prefix}{raw_name}'
            if cand in team_ids:
                return team_ids[cand]
            nc = norm_name(cand)
            if nc in team_ids:
                return team_ids[nc]
            if nc in team_aliases:
                return team_aliases[nc]
        # ファジーマッチ（セ・XXX）
        candidates = list(team_ids.keys())
        matches = get_close_matches(norm_name(raw_name), [norm_name(c) for c in candidates], n=1, cutoff=0.6)
        if matches:
            for k, v in team_ids.items():
                if norm_name(k) == matches[0]:
                    return v
        return None

    def resolve_category(event_name: str, pool_type: str, gender: str) -> Optional[int]:
        # 混合リレーは「4×50mフリーリレー（混合）」のように（混合）サフィックスを試す
        names_to_try = [event_name]
        if gender == '混合' and '（混合）' not in event_name:
            names_to_try.insert(0, event_name + '（混合）')
        for name in names_to_try:
            for g in (gender, None):
                key = (name, pool_type, g)
                if key in category_ids:
                    return category_ids[key]
            for g in (gender, None):
                matches = [v for (n, pt, gd), v in category_ids.items() if n == name and gd == g]
                if matches:
                    return matches[0]
        return None

    def resolve_age(age_range: str) -> Optional[int]:
        # 入力例: '160～199'
        # DBの形式: '160歳〜199歳' or '160～199歳' など試す
        candidates_to_try = [
            f'{age_range}歳',
            age_range.replace('～', '歳〜') + '歳',
            age_range.replace('～', '歳～') + '歳',
            age_range,
        ]
        for c in candidates_to_try:
            if c in age_ids:
                return age_ids[c]
        # ファジー
        matches = get_close_matches(age_range, list(age_ids.keys()), n=1, cutoff=0.5)
        if matches:
            return age_ids[matches[0]]
        return None

    def resolve_player(member_name: str, team_id: Optional[int]) -> Optional[int]:
        nn = norm_name(member_name)
        candidates = player_by_normname.get(nn, [])
        if not candidates:
            # ファジーマッチ
            all_norm = list(player_by_normname.keys())
            close = get_close_matches(nn, all_norm, n=1, cutoff=0.75)
            if close:
                candidates = player_by_normname[close[0]]
        if not candidates:
            return None
        if team_id is not None:
            # 同チームを優先
            same_team = [pid for pid, tid in candidates if tid == team_id]
            if same_team:
                return same_team[0]
        return candidates[0][0]

    # ---- エントリーごとに解決 ----
    print("\n" + "="*60)
    print(f"{'DRY RUN モード' if DRY_RUN else '本番モード'}")
    print("="*60)

    results = []
    all_ok = True

    for entry in RELAY_DQ_ENTRIES:
        label = f"第{entry['event_id_round']}回 No.{entry['race_no']} {entry['gender']} {entry['event_name']} {entry['age_range']}歳 {entry['team_name']}"

        event_id = event_map.get((entry['event_id_round'], entry['pool_type']))
        team_id  = resolve_team(entry['team_name'])
        cat_id   = resolve_category(entry['event_name'], entry['pool_type'], entry['gender'])
        age_id   = resolve_age(entry['age_range'])

        missing = []
        if not event_id: missing.append('event_id')
        if not team_id:  missing.append('team_id')
        if not cat_id:   missing.append('category_id')

        player_ids = []
        for m in entry['members']:
            pid = resolve_player(m, team_id)
            player_ids.append((m, pid))
            if pid is None:
                missing.append(f'player:{m}')

        status = 'OK' if not missing else f'NG [{", ".join(missing)}]'
        print(f"\n{status}  {label}")
        print(f"   event_id={event_id}, team_id={team_id}, category_id={cat_id}, age_id={age_id}")
        for m, pid in player_ids:
            print(f"   選手 {m} → player_id={pid}")

        if missing:
            all_ok = False

        results.append({
            'entry': entry,
            'event_id': event_id,
            'team_id': team_id,
            'cat_id': cat_id,
            'age_id': age_id,
            'age_range': entry['age_range'],
            'player_ids': player_ids,
            'missing': missing,
        })

    print("\n" + "="*60)
    if DRY_RUN:
        print("--dry-run: DBへの書き込みをスキップします。")
        return

    if not all_ok:
        print("一部のエントリでIDが解決できませんでした。")
        print("解決できたエントリのみINSERTしますか？ (y/N): ", end='', flush=True)
        ans = input().strip().lower()
        if ans != 'y':
            print("中断しました。")
            return

    # ---- INSERT ----
    inserted_relay = 0
    inserted_member = 0

    for r in results:
        if r['missing']:
            print(f"スキップ: {r['entry']['team_name']} ({', '.join(r['missing'])})")
            continue

        e = r['entry']
        age_label = f"{e['age_range']}歳"

        relay_row = {
            'event_id':        r['event_id'],
            'team_id':         r['team_id'],
            'category_id':     r['cat_id'],
            'age_id':          r['age_id'],
            'age_group_label': age_label,
            'combined_age':    e['combined_age'],
            'rank':            None,
            'time_seconds':    None,
            'time_display':    None,
            'team_points':     None,
            'is_meet_record':  False,
            'race_number':     e['race_no'],
            'disqualification_code': e['dq_code'],
            'is_withdrawal':   False,
        }

        res = sb.table('dt_result_relay').insert(relay_row).execute()
        relay_db_id = res.data[0]['id']
        inserted_relay += 1

        for i, (name, pid) in enumerate(r['player_ids'], start=1):
            if pid is None:
                continue
            sb.table('dt_player_relay').insert({
                'relay_result_id': relay_db_id,
                'player_id':       pid,
                'swim_order':      i,
                'split_seconds':   None,
            }).execute()
            inserted_member += 1

        print(f"INSERT: 第{e['event_id_round']}回 {e['team_name']} {e['event_name']} {e['age_range']}歳 → relay_id={relay_db_id}")

    print(f"\n完了: dt_result_relay {inserted_relay}件, dt_player_relay {inserted_member}件")


if __name__ == '__main__':
    main()
