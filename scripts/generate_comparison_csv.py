"""
全大会の generated CSV を 第80回形式のCSVに変換して各大会フォルダに配置

出力ファイル（例: 第74回(短水路)/）:
  第74回M総合成績.csv       ... チーム総合成績
  第74回競技結果（個人）.csv ... 個人競技結果
  第74回競技結果（チーム）.csv ... リレー競技結果（メンバー行）

使い方:
  python scripts/generate_comparison_csv.py
"""

import sys
import csv
import re
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ============================================================
# 大会情報
# ============================================================

TOURNAMENTS = [
    {'round': 74, 'pool': '短水路', 'year': 2023, 'month': 5,  'day': 14},
    {'round': 75, 'pool': '長水路', 'year': 2023, 'month': 11, 'day': 4},
    {'round': 76, 'pool': '短水路', 'year': 2024, 'month': 5,  'day': 11},
    {'round': 77, 'pool': '長水路', 'year': 2024, 'month': 10, 'day': 26},
    {'round': 78, 'pool': '長水路', 'year': 2025, 'month': 5,  'day': 31},
    {'round': 79, 'pool': '短水路', 'year': 2025, 'month': 10, 'day': 25},
    {'round': 80, 'pool': '長水路', 'year': 2026, 'month': 5,  'day': 2},
]

BASE = Path('マスターズPDF')

# 第80回と同じ列順（個人・チーム共通）
RESULT_HEADERS = [
    'ID', '回', '年', '月', '日', '水路', 'タイプ',
    'レース番号', '競技名', '競技性別',
    'リレー年齢区分', 'リレー実年齢合計', 'リレータイム', 'リレー大会新差', 'リレー泳順',
    '個人年齢区分', '順位', '選手名', '性別', 'チーム名',
    '個人タイム', '個人大会新差', '飛込タイム', 'LAPタイム',
    '個人得点', 'チーム得点', '申請タイム', 'ぴったり賞',
    '大会新', '大会記録', '日本記録', '世界記録', 'レーン',
]

STANDINGS_HEADERS = ['ID', '回', '順位', 'チーム名', 'フリガナ', '得点', '男子', '女子', '混合']


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, headers: list, rows: list):
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)
    print(f'  → {path.name} ({len(rows)}件)')


# ============================================================
# 総合成績 CSV
# ============================================================

def make_standings(t: dict, gen_dir: Path, out_dir: Path):
    rows = read_csv(gen_dir / 'team_standings.csv')
    out_rows = []
    for idx, r in enumerate(rows, 1):
        out_rows.append([
            idx,
            r['round'],
            f"{r['rank']}位",
            r['team_name'],
            r.get('furigana', ''),
            r['total_points'],
            r['male_points'],
            r['female_points'],
            r['mixed_points'],
        ])
    out_path = out_dir / f"第{t['round']}回M総合成績.csv"
    write_csv(out_path, STANDINGS_HEADERS, out_rows)


# ============================================================
# 個人競技結果 CSV
# ============================================================

def make_individual(t: dict, gen_dir: Path, out_dir: Path):
    rows = read_csv(gen_dir / 'individual_results.csv')
    out_rows = []
    for idx, r in enumerate(rows, 1):
        is_new = 'TRUE' if r.get('is_meet_record', '') == 'True' else ''
        out_rows.append([
            idx,
            t['round'], t['year'], t['month'], t['day'],
            t['pool'],
            '個人',
            r.get('race_no', ''),
            r.get('event_name', ''),
            r.get('gender', ''),
            '',  # リレー年齢区分
            '',  # リレー実年齢合計
            '',  # リレータイム
            '',  # リレー大会新差
            '',  # リレー泳順
            r.get('age_group', ''),
            r.get('rank', ''),
            r.get('athlete_name', ''),
            r.get('gender', ''),
            r.get('team_name', ''),
            r.get('time_display', ''),
            '',  # 個人大会新差
            '',  # 飛込タイム
            r.get('lap_times', ''),
            '',  # 個人得点
            '',  # チーム得点
            '',  # 申請タイム
            '',  # ぴったり賞
            is_new,
            r.get('meet_record', ''),
            r.get('japan_record', ''),
            r.get('world_record', ''),
            r.get('lane', ''),
        ])
    out_path = out_dir / f"第{t['round']}回競技結果（個人）.csv"
    write_csv(out_path, RESULT_HEADERS, out_rows)


# ============================================================
# チーム（リレー）競技結果 CSV
# ============================================================

def make_relay(t: dict, gen_dir: Path, out_dir: Path):
    relay_rows = read_csv(gen_dir / 'relay_results.csv')
    member_rows = read_csv(gen_dir / 'relay_members.csv')

    # relay_key → member のマッピング
    members_by_key: dict[str, list] = {}
    for m in member_rows:
        key = m['relay_key']
        members_by_key.setdefault(key, []).append(m)

    out_rows = []
    id_counter = 1

    for rr in relay_rows:
        relay_key = (
            f"{rr['round']}_{rr['race_no']}_{rr['age_group_label']}"
            f"_{rr['team_name']}_{rr['rank']}"
        )
        members = sorted(
            members_by_key.get(relay_key, []),
            key=lambda m: int(m.get('swim_order', 0))
        )

        if not members:
            # メンバーなし → チーム行だけ1行出力
            out_rows.append([
                id_counter, t['round'], t['year'], t['month'], t['day'],
                t['pool'], 'チーム',
                rr.get('race_no', ''),
                rr.get('event_name', ''),
                rr.get('gender', ''),
                rr.get('age_group_label', ''),
                rr.get('combined_age', ''),
                rr.get('time_display', ''),
                '',  # リレー大会新差
                '',  # リレー泳順
                '',  # 個人年齢区分
                rr.get('rank', ''),
                '',  # 選手名
                '',  # 性別
                rr.get('team_name', ''),
                '',  # 個人タイム
                '', '', '', '', '', '', '',
                'TRUE' if rr.get('is_meet_record') == 'True' else '',
                rr.get('meet_record', ''),
                rr.get('japan_record', ''),
                rr.get('world_record', ''),
                rr.get('lane', ''),
            ])
            id_counter += 1
        else:
            for m in members:
                out_rows.append([
                    id_counter, t['round'], t['year'], t['month'], t['day'],
                    t['pool'], 'チーム',
                    rr.get('race_no', ''),
                    rr.get('event_name', ''),
                    rr.get('gender', ''),
                    rr.get('age_group_label', ''),
                    rr.get('combined_age', ''),
                    rr.get('time_display', ''),
                    '',  # リレー大会新差
                    m.get('swim_order', ''),
                    '',  # 個人年齢区分
                    rr.get('rank', ''),
                    m.get('athlete_name', ''),
                    '',  # 性別（リレーは不明）
                    rr.get('team_name', ''),
                    m.get('split_display', ''),
                    '', '',  # 個人大会新差, 飛込タイム
                    '',  # LAPタイム
                    '', '', '', '',  # 得点, 申請タイム, ぴったり賞
                    'TRUE' if rr.get('is_meet_record') == 'True' else '',
                    rr.get('meet_record', ''),
                    rr.get('japan_record', ''),
                    rr.get('world_record', ''),
                    rr.get('lane', ''),
                ])
                id_counter += 1

    out_path = out_dir / f"第{t['round']}回競技結果（チーム）.csv"
    write_csv(out_path, RESULT_HEADERS, out_rows)


# ============================================================
# メイン
# ============================================================

if __name__ == '__main__':
    for t in TOURNAMENTS:
        pool_name = {74:'短水路', 75:'長水路', 76:'短水路', 77:'長水路',
                     78:'長水路', 79:'短水路', 80:'長水路'}[t['round']]
        out_dir = BASE / f"第{t['round']}回({pool_name})"
        gen_dir = out_dir / 'backup' / 'generated'

        if not gen_dir.exists():
            print(f"第{t['round']}回: generated フォルダなし → スキップ")
            continue

        print(f"=== 第{t['round']}回 {pool_name} ===")
        make_standings(t, gen_dir, out_dir)
        make_individual(t, gen_dir, out_dir)
        make_relay(t, gen_dir, out_dir)
