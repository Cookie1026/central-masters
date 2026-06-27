"""
第74〜80回 全大会を Supabase にインポートする。

使い方:
  python scripts/import_all.py          # 全大会
  python scripts/import_all.py 74 75    # 指定回のみ

dt_* テーブルは各大会のインポート時に meet_id で削除→再挿入されるため冪等。
mst_team / dt_player_person は upsert（重複不可）。
"""

import sys
import subprocess
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

TOURNAMENTS = [
    (74, '短水路', '2023-05-14'),
    (75, '長水路', '2023-11-04'),
    (76, '短水路', '2024-05-11'),
    (77, '長水路', '2024-10-26'),
    (78, '長水路', '2025-05-31'),
    (79, '短水路', '2025-10-25'),
    (80, '長水路', '2026-05-02'),
]

BASE = Path('マスターズPDF')


def main():
    target = set(int(x) for x in sys.argv[1:]) if len(sys.argv) > 1 else None
    for r, pool, date in TOURNAMENTS:
        if target and r not in target:
            continue
        gen_dir = BASE / f'第{r}回({pool})' / 'backup' / 'generated'
        print(f'\n{"="*60}')
        print(f'第{r}回({pool}) {date}  →  {gen_dir}')
        print('='*60)
        result = subprocess.run(
            [sys.executable, 'scripts/import_to_supabase.py', str(gen_dir), date],
            encoding='utf-8',
            errors='replace',
        )
        if result.returncode != 0:
            print(f'ERROR: 第{r}回 インポート失敗 (exit={result.returncode})')
            sys.exit(result.returncode)

    print('\n\n全大会インポート完了！')


if __name__ == '__main__':
    main()
