"""第74〜79回の dt_ranking_team に男女・混合得点を補完する。

戦略：比率方式
  calc_male / calc_total で比率を出し、公式の total_points に掛ける。
  公式合計は正しいので、補完後も合計は変わらない。

既定はドライラン。--apply で実際に更新する。
第80回以降は更新しない（公式データが正確なため）。
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit('scripts', 1)[0] + 'scripts')
from import_to_supabase import get_client


def rank_pts(rank: int | None) -> int:
    if rank is None:
        return 0
    return max(0, 11 - rank) if 1 <= rank <= 10 else 0


def load_all(client, table: str, select: str, **filters) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        q = client.table(table).select(select)
        for col, val in filters.items():
            q = q.eq(col, val)
        chunk = q.range(offset, offset + 999).execute().data
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        offset += 1000
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Supabaseへupsertする')
    args = parser.parse_args()

    client = get_client()

    # ---- マスターデータ ----
    cats = {c['id']: c for c in load_all(client, 'mst_category', 'id, gender, type')}
    players = {p['id']: p for p in load_all(client, 'dt_player_person', 'id, team_id')}
    events = client.table('mst_event').select('id, round, pool_type').order('round').execute().data

    # 第80回以降はスキップ（公式データが正確）
    target_events = [e for e in events if e['round'] < 80]

    print(f'対象: {[e["round"] for e in target_events]}回')
    print(f'プレーヤーマスター: {len(players)}件')
    print()

    total_updated = 0
    total_skipped = 0

    for event in target_events:
        eid = event['id']
        rnd = event['round']
        pool = event['pool_type']

        # ---- 個人成績 ----
        person_rows = load_all(
            client, 'dt_result_person',
            'player_id, rank, is_meet_record, is_japan_record, is_world_record, category_id',
            event_id=eid,
        )

        # ---- リレー成績 ----
        relay_rows = load_all(
            client, 'dt_result_relay',
            'team_id, rank, is_meet_record, category_id',
            event_id=eid,
        )

        # ---- 計算 ----
        computed: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))

        for r in person_rows:
            player = players.get(r['player_id'])
            if not player:
                continue
            cat = cats.get(r['category_id'])
            if not cat:
                continue
            gender = cat['gender']
            pts = rank_pts(r['rank'])
            if r.get('is_meet_record'):
                pts += 10
            if r.get('is_japan_record'):
                pts += 10
            if r.get('is_world_record'):
                pts += 10
            computed[player['team_id']][gender] += pts

        for r in relay_rows:
            cat = cats.get(r['category_id'])
            gender = cat['gender'] if cat else '混合'
            pts = rank_pts(r['rank'])
            if r.get('is_meet_record'):
                pts += 10
            computed[r['team_id']][gender] += pts

        # ---- 公式順位から補完 ----
        rankings = client.table('dt_ranking_team').select(
            'id, team_id, rank, total_points, male_points, female_points, mixed_points'
        ).eq('event_id', eid).execute().data

        upserts: list[dict] = []
        skipped = 0

        for row in rankings:
            team_id = row['team_id']
            off_total = float(row['total_points'] or 0)
            calc = computed.get(team_id, {})
            calc_male   = calc.get('男子', 0.0)
            calc_female = calc.get('女子', 0.0)
            calc_mixed  = calc.get('混合', 0.0)
            calc_total  = calc_male + calc_female + calc_mixed

            if calc_total <= 0 or off_total <= 0:
                skipped += 1
                continue

            male_pt   = round(off_total * calc_male   / calc_total, 1)
            female_pt = round(off_total * calc_female / calc_total, 1)
            # 丸め誤差を mixed に吸収させる
            mixed_pt  = round(off_total - male_pt - female_pt, 1)

            upserts.append({
                'id':             row['id'],
                'event_id':       eid,
                'team_id':        team_id,
                'rank':           row['rank'],
                'total_points':   off_total,
                'male_points':    male_pt,
                'female_points':  female_pt,
                'mixed_points':   mixed_pt,
            })

        print(f'第{rnd}回 ({pool}): {len(upserts)}件更新予定 / {skipped}件スキップ（計算値0）')

        # サンプル表示
        for u in upserts[:5]:
            print(f'  rank={u["rank"]:>3} total={u["total_points"]:>7.1f}  '
                  f'male={u["male_points"]:>6.1f}  female={u["female_points"]:>6.1f}  mixed={u["mixed_points"]:>6.1f}')
        if len(upserts) > 5:
            print(f'  ... 他 {len(upserts)-5}件')

        if args.apply and upserts:
            client.table('dt_ranking_team').upsert(
                upserts,
                on_conflict='id',
            ).execute()

        total_updated += len(upserts)
        total_skipped += skipped

    mode = '更新完了' if args.apply else 'ドライラン完了'
    print(f'\n{mode}: 更新 {total_updated}件 / スキップ {total_skipped}件')


if __name__ == '__main__':
    main()
