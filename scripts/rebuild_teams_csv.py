"""
teams.csv を individual_results.csv + relay_results.csv のユニークチーム名から再生成する。

一部大会の teams.csv はチームランキングページのOCRゴミ（「セ・阿佐谷   ﾄｰｱｾﾝﾄﾗﾙ...」など）が
混入しているため、実際の結果データから正規チーム名リストを再構築する。

使い方:
  python scripts/rebuild_teams_csv.py          # 全大会
  python scripts/rebuild_teams_csv.py 74 75    # 指定回のみ
"""

import sys
import csv
import io
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE = Path('マスターズPDF')
TOURNAMENTS = [
    (74, '短水路'), (75, '長水路'), (76, '短水路'),
    (77, '長水路'), (78, '長水路'), (79, '短水路'), (80, '長水路'),
]


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def rebuild(round_no: int, pool: str):
    folder = BASE / f'第{round_no}回({pool})'
    gen    = folder / 'backup' / 'generated'

    ind = read_csv(gen / 'individual_results.csv')
    rel = read_csv(gen / 'relay_results.csv')

    names: list[str] = []
    seen: set[str] = set()
    for row in ind + rel:
        name = row.get('team_name', '').strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)

    out_path = gen / 'teams.csv'
    with open(out_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['team_name'])
        for n in names:
            w.writerow([n])

    print(f'第{round_no}回: {len(names)}チーム → {out_path}')


def main():
    target_rounds = set(int(x) for x in sys.argv[1:]) if len(sys.argv) > 1 else None
    for r, pool in TOURNAMENTS:
        if target_rounds and r not in target_rounds:
            continue
        rebuild(r, pool)


if __name__ == '__main__':
    main()
