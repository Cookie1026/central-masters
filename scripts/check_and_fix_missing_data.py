#!/usr/bin/env python3
"""
飛込タイム・リレーメンバー部分欠損の診断と修正

1. 飛込タイム: CSVにデータがあるがDBがnullのレコードをチェック
2. リレーメンバー: 4本泳ぐべきなのにメンバーが欠けているレースをチェック
"""
import csv, os, sys, re, unicodedata, argparse
from itertools import groupby
from typing import Optional
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

def normalize(s: str) -> str:
    return unicodedata.normalize('NFKC', s.strip()) if s else ''

def parse_time(s: str) -> Optional[float]:
    if not s: return None
    s = s.strip()
    if s in ('DNS','DQ','NC','記録なし','-',''): return None
    try:
        if ':' in s:
            parts = s.split(':')
            return int(parts[0]) * 60 + float(parts[1])
        return float(s)
    except ValueError:
        return None


# ══════════════════════════════════════════════════════════════════
# 1. 飛込タイム チェック
# ══════════════════════════════════════════════════════════════════

def check_dive_times(do_fix=False):
    print("\n" + "="*60)
    print("【飛込タイム チェック】")
    print("="*60)

    csv_files = {
        74: 'data/第74回競技結果（個人）.csv',
        75: 'data/第75回競技結果（個人）.csv',
        76: 'data/第76回競技結果（個人）.csv',
        77: 'data/第77回競技結果（個人）.csv',
        78: 'data/第78回競技結果（個人）.csv',
        79: 'data/第79回競技結果（個人）.csv',
        80: 'data/第80回競技結果（個人）.csv',
    }

    total_missing = 0
    fix_targets = []

    for round_no, csv_path in csv_files.items():
        if not os.path.exists(csv_path):
            continue

        # DBから該当大会の全レコードを取得
        db_res = sb.table('dt_result_person')\
            .select('id, dive_time, player_id, category_id, age_id, dt_player_person(name), mst_event!inner(round)')\
            .eq('mst_event.round', round_no)\
            .execute()
        db_rows = db_res.data
        db_by_key = {}  # (player_name_norm, category_id, age_id) -> db_row
        for r in db_rows:
            if r.get('dt_player_person'):
                key = (normalize(r['dt_player_person']['name']), r['category_id'], r['age_id'])
                db_by_key[key] = r

        # CSVで飛込タイムがあるレコードを検索
        with open(csv_path, encoding='utf-8-sig') as f:
            rows = [r for r in csv.DictReader(f) if r.get('タイプ','').strip() == '個人']

        # event_id取得
        ev_res = sb.table('mst_event').select('id').eq('round', round_no).execute()
        event_id = ev_res.data[0]['id'] if ev_res.data else None

        # category_idのキャッシュ
        cats = sb.table('mst_category').select('id, name, gender, pool_type').execute().data
        cat_by_name = {}
        for c in cats:
            cat_by_name[(c['name'], c.get('gender'), c.get('pool_type', '共通'))] = c['id']
            cat_by_name[(c['name'], c.get('gender'), None)] = c['id']
            cat_by_name[(c['name'],)] = c['id']  # name only fallback

        ages = sb.table('mst_age').select('id, name').execute().data
        age_by_name = {a['name']: a['id'] for a in ages}

        players = sb.table('dt_player_person').select('id, name, gender, team_id').execute().data
        player_by_name_gender = {}
        for p in players:
            key = (normalize(p['name']), p['gender'])
            player_by_name_gender[key] = p['id']

        missing = 0
        for row in rows:
            dive = parse_time(row.get('飛込タイム', ''))
            if dive is None:
                continue  # CSVにデータなし → スキップ

            # 選手名・種目・年齢区分でDBレコードを特定
            pname = normalize(row['選手名'])
            pgender = row.get('性別', '').strip()
            age_name = row.get('個人年齢区分', '').strip()
            cat_name = row.get('競技名', '').strip()
            pool = row.get('水路', '共通').strip()

            age_id = age_by_name.get(age_name)
            player_id = player_by_name_gender.get((pname, pgender))
            if not player_id:
                player_id = player_by_name_gender.get((pname, '男子')) or player_by_name_gender.get((pname, '女子'))

            # category_id
            cat_id = (cat_by_name.get((cat_name, None, pool)) or
                      cat_by_name.get((cat_name, None, '共通')) or
                      cat_by_name.get((cat_name,)))

            if not player_id or not cat_id:
                continue

            # DBレコード検索
            db_res2 = sb.table('dt_result_person')\
                .select('id, dive_time')\
                .eq('event_id', event_id)\
                .eq('player_id', player_id)\
                .eq('category_id', cat_id)\
                .execute()

            for db_row in db_res2.data:
                if db_row['dive_time'] is None:
                    missing += 1
                    total_missing += 1
                    fix_targets.append({'id': db_row['id'], 'dive_time': dive})
                    if missing <= 3:  # 最初の3件だけ表示
                        print(f"  第{round_no}回 {pname} [{cat_name}] CSV={dive:.2f}s → DBはnull (id={db_row['id']})")

        print(f"  第{round_no}回: 飛込タイムCSVあり→DBにない: {missing}件")

    print(f"\n合計修正対象: {total_missing}件")

    if do_fix and fix_targets:
        print("\n--- 修正適用中 ---")
        for i, t in enumerate(fix_targets):
            sb.table('dt_result_person').update({'dive_time': t['dive_time']}).eq('id', t['id']).execute()
            if (i+1) % 50 == 0 or (i+1) == len(fix_targets):
                print(f"  {i+1}/{len(fix_targets)}件完了")
        print("飛込タイム修正完了!")
    elif total_missing > 0:
        print("修正するには --fix オプションをつけて実行してください")


# ══════════════════════════════════════════════════════════════════
# 2. リレーメンバー部分欠損 チェック
# ══════════════════════════════════════════════════════════════════

def expected_members(cat_name: str) -> int:
    """種目名から期待メンバー数を返す"""
    m = re.match(r'^(\d+)[×x](\d+)m', cat_name)
    if m:
        return int(m.group(1))
    return 4  # デフォルト

def check_relay_members(do_fix=False):
    print("\n" + "="*60)
    print("【リレーメンバー部分欠損 チェック】")
    print("="*60)

    # 全リレー結果とメンバー数を取得
    res = sb.table('dt_result_relay')\
        .select('id, mst_event(round), mst_category(name), mst_team(name), rank, age_group_label, mst_age(name), dt_player_relay(swim_order)')\
        .order('id')\
        .execute()

    partial = []
    for r in res.data:
        cat_name = r['mst_category']['name'] if r.get('mst_category') else ''
        expected = expected_members(cat_name)
        actual = len(r.get('dt_player_relay', []))
        if 0 < actual < expected:
            partial.append({
                'id': r['id'],
                'round': r['mst_event']['round'] if r.get('mst_event') else '?',
                'team': r['mst_team']['name'] if r.get('mst_team') else '?',
                'cat': cat_name,
                'age': r['mst_age']['name'] if r.get('mst_age') else r.get('age_group_label', '?'),
                'rank': r.get('rank'),
                'actual': actual,
                'expected': expected,
                'existing_orders': sorted([m['swim_order'] for m in r.get('dt_player_relay', [])]),
            })

    print(f"\n部分欠損リレー: {len(partial)}件")

    by_round = {}
    for p in partial:
        by_round.setdefault(p['round'], []).append(p)

    for round_no in sorted(by_round):
        items = by_round[round_no]
        print(f"\n第{round_no}回: {len(items)}件")
        for p in items:
            missing_orders = [i for i in range(1, p['expected']+1) if i not in p['existing_orders']]
            print(f"  [id={p['id']}] {p['team']} {p['cat']} {p['age']} {p['actual']}/{p['expected']}人 "
                  f"欠け泳順:{missing_orders}")

    if not partial:
        print("問題なし!")
        return

    # 修正: CSVファイルを使って欠けているメンバーを補完
    if do_fix:
        fix_relay_members(partial)


def fix_relay_members(partial: list):
    """部分欠損リレーのメンバーをCSVから補完"""
    print("\n--- リレーメンバー補完中 ---")

    # チームCSVのロード
    csv_files = {
        74: 'data/第74回競技結果（チーム）.csv',
        75: 'data/第75回競技結果（チーム）.csv',
        76: 'data/第76回競技結果（チーム）.csv',
        77: 'data/第77回競技結果（チーム）.csv',
        78: 'data/第78回競技結果（チーム）.csv',
        79: 'data/第79回競技結果（チーム）.csv',
        80: 'data/第80回競技結果（チーム）.csv',
    }

    # 選手マスター
    players = sb.table('dt_player_person').select('id, name, gender, team_id').execute().data
    player_by_key = {(normalize(p['name']), p['gender'], p['team_id']): p['id'] for p in players}
    player_by_name_team = {}
    for p in players:
        key2 = (normalize(p['name']), p['team_id'])
        player_by_name_team.setdefault(key2, []).append(p['id'])

    teams = sb.table('mst_team').select('id, name').execute().data
    team_by_name = {normalize(t['name']): t['id'] for t in teams}
    team_aliases = sb.table('mst_team_alias').select('alias, team_id').execute().data
    alias_map = {normalize(a['alias']): a['team_id'] for a in team_aliases}

    def resolve_team_id(name):
        n = normalize(name)
        tid = team_by_name.get(n) or alias_map.get(n)
        if not tid:
            # "セ・" プレフィックスを付けて再検索（CSVに「二俣川」、DBに「セ・二俣川」のケース）
            se = 'セ・' + n
            tid = team_by_name.get(se) or alias_map.get(se)
        return tid

    def resolve_player_id(name, gender, team_id):
        n = normalize(name)
        pid = player_by_key.get((n, gender, team_id))
        if pid: return pid
        if not gender:
            ids = player_by_name_team.get((n, team_id), [])
            if len(ids) == 1: return ids[0]
        return None

    total_fixed = 0

    for round_no, csv_path in csv_files.items():
        if not os.path.exists(csv_path):
            continue

        # この大会の部分欠損を対象にする
        targets = [p for p in partial if p['round'] == round_no]
        if not targets:
            continue

        with open(csv_path, encoding='utf-8-sig') as f:
            rows = [r for r in csv.DictReader(f) if r.get('タイプ','').strip() == 'チーム']

        # DBのteam_idを名前から逆引き
        for target in targets:
            team_id = resolve_team_id(target['team'])
            if not team_id:
                print(f"  [SKIP] チーム未解決: {target['team']}")
                continue

            age_str = target['age']
            cat_name = target['cat']
            rank = target['rank']
            missing_orders = [i for i in range(1, target['expected']+1)
                              if i not in target['existing_orders']]

            # CSVから一致するグループを探す
            # DBカテゴリ名: "4×50mメドレーリレー（混合）"
            # CSV: 競技名="4×50mメドレーリレー", 競技性別="混合" → 結合して比較
            def rkey(r):
                return (r['競技名'], r['競技性別'], normalize(r['チーム名']), r['リレー年齢区分'], r['順位'])

            matched_members = None
            for key, group in groupby(sorted(rows, key=rkey), key=rkey):
                members = list(group)
                first = members[0]
                csv_team_id = resolve_team_id(first['チーム名'])
                csv_gender = first['競技性別'].strip()
                csv_cat_raw = first['競技名'].strip()
                # 混合種目はDB名に「（混合）」が含まれる
                full_csv_cat = f"{csv_cat_raw}（混合）" if csv_gender == '混合' else csv_cat_raw
                if (csv_team_id == team_id and
                    full_csv_cat == cat_name and
                    normalize(first['リレー年齢区分']) == normalize(age_str) and
                    str(first['順位']).strip() == str(rank)):
                    matched_members = members
                    break

            if not matched_members:
                print(f"  [NOTFOUND] 第{round_no}回 {target['team']} {cat_name} {age_str} rank={rank}")
                continue

            # 欠けている泳順のメンバーを追加
            for m in matched_members:
                swim_order = int(m.get('リレー泳順', '0') or '0')
                if swim_order not in missing_orders:
                    continue
                pname = normalize(m['選手名'])
                pgender = m.get('性別', '').strip()
                player_id = resolve_player_id(pname, pgender, team_id)
                if not player_id:
                    print(f"  [SKIP] 選手未解決: {pname} (team={target['team']})")
                    continue

                split_sec = parse_time(m.get('個人タイム', '').strip())

                sb.table('dt_player_relay').insert({
                    'relay_result_id': target['id'],
                    'swim_order': swim_order,
                    'split_seconds': split_sec,
                    'player_id': player_id,
                }).execute()
                total_fixed += 1
                print(f"  追加: 第{round_no}回 {target['team']} {cat_name} 泳順{swim_order} {pname}")

    print(f"\nリレーメンバー補完完了: {total_fixed}件追加")


# ══════════════════════════════════════════════════════════════════
# エントリーポイント
# ══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fix', action='store_true', help='修正を適用する')
    parser.add_argument('--only', choices=['dive', 'relay'], help='どちらかだけ実行')
    args = parser.parse_args()

    if args.only != 'relay':
        check_dive_times(do_fix=args.fix)
    if args.only != 'dive':
        check_relay_members(do_fix=args.fix)
