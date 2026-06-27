"""
OCRパイプラインの精度チェック + mst_player_alias候補の抽出

出力:
  reports/accuracy_report.txt        ... 大会別精度サマリー
  reports/alias_candidates.csv       ... mst_player_alias候補
  reports/name_diff_80.csv           ... 第80回 申請タイム↔OCR名前差分
"""

import sys
import csv
import re
import os
from pathlib import Path
from difflib import SequenceMatcher
from collections import defaultdict

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE    = Path('マスターズPDF')
REPORTS = Path('reports')
REPORTS.mkdir(exist_ok=True)

TOURNAMENTS = [
    {'round': 74, 'pool': '短水路'},
    {'round': 75, 'pool': '長水路'},
    {'round': 76, 'pool': '短水路'},
    {'round': 77, 'pool': '長水路'},
    {'round': 78, 'pool': '長水路'},
    {'round': 79, 'pool': '短水路'},
    {'round': 80, 'pool': '長水路'},
]


def norm(name: str) -> str:
    """スペース除去 + NFKC正規化"""
    import unicodedata
    return unicodedata.normalize('NFKC', re.sub(r'\s+', '', name.strip()))


def norm_team(name: str) -> str:
    """チーム名正規化：セ・プレフィックス除去 + norm"""
    return norm(re.sub(r'^セ・', '', name.strip()))


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


# ==============================================================
# 1. 第80回 精度チェック（申請タイムCSV vs OCR結果）
# ==============================================================

def check_round80() -> dict:
    folder = BASE / '第80回(長水路)'
    申請rows = read_csv(folder / '第80回M申請タイム一覧.csv')
    ocr_rows  = read_csv(folder / '第80回競技結果（個人）.csv')

    # OCR: (norm名, norm_team) → row のマップ（セ・プレフィックス除去済みチーム名で統一）
    ocr_by_name_team: dict[tuple, list] = defaultdict(list)
    for r in ocr_rows:
        key = (norm(r['選手名']), norm_team(r['チーム名']))
        ocr_by_name_team[key].append(r)

    # 申請タイム各行を突合（申請側もnorm_teamで統一）
    matched    = 0
    name_mismatch = []   # チームは合うが名前が違う候補
    unmatched  = []      # まったくマッチしない

    for r in 申請rows:
        n = norm(r['選手名'])
        t = norm_team(r['チーム名'])
        if (n, t) in ocr_by_name_team:
            matched += 1
            continue

        # チームが同じで名前が近いものを探す（OCR誤読候補）
        best_score = 0.0
        best_ocr   = None
        for (on, ot), ocr_list in ocr_by_name_team.items():
            if ot != t:
                continue
            s = similarity(n, on)
            if s > best_score:
                best_score = s
                best_ocr   = on

        if best_ocr and best_score >= 0.6:
            name_mismatch.append({
                '大会': 80,
                '申請名': r['選手名'],
                'OCR名': best_ocr,
                'チーム': r['チーム名'],
                '競技名': r['競技名'],
                '類似度': round(best_score, 3),
                'ステータス': 'candidate',
            })
        else:
            unmatched.append(r)

    return {
        'total_申請': len(申請rows),
        'total_ocr':  len(ocr_rows),
        'matched':    matched,
        'name_mismatch': name_mismatch,
        'unmatched':  unmatched,
    }


# ==============================================================
# 2. 全大会クロス精度チェック（各大会の生成CSV件数チェック）
# ==============================================================

def check_all_tournaments() -> list[dict]:
    results = []
    for t in TOURNAMENTS:
        folder = BASE / f"第{t['round']}回({t['pool']})"
        gen    = folder / 'backup' / 'generated'
        row = {'round': t['round'], 'pool': t['pool']}
        for fname, key in [
            ('individual_results.csv', 'ind'),
            ('relay_results.csv',      'relay'),
            ('relay_members.csv',      'members'),
            ('team_standings.csv',     'standings'),
            ('athletes.csv',           'athletes'),
        ]:
            rows = read_csv(gen / fname)
            row[key] = len(rows)
            # メンバー/リレー比率
        if row.get('relay', 0) > 0:
            row['mbr_per_relay'] = round(row['members'] / row['relay'], 2)
        else:
            row['mbr_per_relay'] = 0
        results.append(row)
    return results


# ==============================================================
# 3. 全大会横断：同チーム内の名前ゆれ検出 → alias候補
# ==============================================================

def detect_cross_round_aliases() -> list[dict]:
    """
    全大会のathletes.csvを統合し、同チーム内で名前が似ている選手を検出。
    """
    all_athletes: list[dict] = []
    for t in TOURNAMENTS:
        folder = BASE / f"第{t['round']}回({t['pool']})"
        gen    = folder / 'backup' / 'generated'
        rows   = read_csv(gen / 'athletes.csv')
        for r in rows:
            r['_round'] = t['round']
        all_athletes.extend(rows)

    # (norm名, チーム) でユニーク化（複数大会に同じ人が出てる）
    seen: dict[tuple, dict] = {}
    for r in all_athletes:
        k = (norm(r.get('name', '')), norm(r.get('team_name', '')))
        if k not in seen:
            seen[k] = {'name': r.get('name',''), 'team': r.get('team_name',''), 'rounds': set()}
        seen[k]['rounds'].add(r['_round'])

    # チームごとにグループ化して類似名ペアを検出
    by_team: dict[str, list] = defaultdict(list)
    for (n, t), info in seen.items():
        by_team[t].append({'norm': n, 'raw': info['name'], 'rounds': info['rounds']})

    candidates = []
    for team, players in by_team.items():
        for i in range(len(players)):
            for j in range(i+1, len(players)):
                a, b = players[i], players[j]
                if a['norm'] == b['norm']:
                    continue  # 完全一致はスキップ
                s = similarity(a['norm'], b['norm'])
                if s >= 0.75:
                    rounds_a = sorted(a['rounds'])
                    rounds_b = sorted(b['rounds'])
                    # 同一大会に両方出ている場合は別人の可能性が高いのでスキップ
                    if set(rounds_a) & set(rounds_b):
                        continue
                    candidates.append({
                        '大会': '全体',
                        '申請名': a['raw'],
                        'OCR名': b['raw'],
                        'チーム': team,
                        '競技名': '',
                        '類似度': round(s, 3),
                        'ステータス': 'candidate',
                        '備考': f"第{'・'.join(map(str,rounds_a))}回 vs 第{'・'.join(map(str,rounds_b))}回",
                    })

    return sorted(candidates, key=lambda x: -x['類似度'])


# ==============================================================
# メイン
# ==============================================================

def main():
    lines = []

    # --- 全大会サマリー ---
    lines.append('=' * 60)
    lines.append('【全大会 OCR生成件数サマリー】')
    lines.append('=' * 60)
    tour_stats = check_all_tournaments()
    lines.append(f"{'大会':<10} {'個人':>6} {'リレー':>6} {'メンバー':>8} {'mbr/rel':>8} {'チーム':>6} {'選手':>6}")
    lines.append('-' * 60)
    for r in tour_stats:
        lines.append(
            f"第{r['round']}回({r['pool']}) "
            f"{r['ind']:>6} {r['relay']:>6} {r['members']:>8} "
            f"{r['mbr_per_relay']:>8.2f} {r['standings']:>6} {r['athletes']:>6}"
        )

    # --- 第80回 申請タイム突合 ---
    lines.append('')
    lines.append('=' * 60)
    lines.append('【第80回 申請タイムCSV vs OCR精度チェック】')
    lines.append('=' * 60)
    r80 = check_round80()
    matched_rate = r80['matched'] / r80['total_申請'] * 100 if r80['total_申請'] else 0
    lines.append(f"申請タイム総数 : {r80['total_申請']}")
    lines.append(f"OCR取得数     : {r80['total_ocr']}")
    lines.append(f"名前+チーム一致: {r80['matched']} ({matched_rate:.1f}%)")
    lines.append(f"名前差異（候補）: {len(r80['name_mismatch'])} 件")
    lines.append(f"未マッチ       : {len(r80['unmatched'])} 件（DNS/DSQ含む）")

    if r80['name_mismatch']:
        lines.append('')
        lines.append('--- 名前差異候補（上位20件）---')
        for m in sorted(r80['name_mismatch'], key=lambda x: -x['類似度'])[:20]:
            lines.append(f"  {m['申請名']} → {m['OCR名']}  [{m['チーム']}] ({m['競技名']}) sim={m['類似度']}")

    # --- クロス大会エイリアス候補 ---
    lines.append('')
    lines.append('=' * 60)
    lines.append('【全大会横断 名前ゆれ候補（同チーム・異大会）】')
    lines.append('=' * 60)
    alias_candidates = detect_cross_round_aliases()
    lines.append(f"候補数: {len(alias_candidates)} 件")
    lines.append('')
    for c in alias_candidates[:30]:
        lines.append(f"  {c['申請名']} ↔ {c['OCR名']}  [{c['チーム']}] sim={c['類似度']}  ({c['備考']})")

    # --- レポート書き出し ---
    report_path = REPORTS / 'accuracy_report.txt'
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('\n'.join(lines))
    print(f'\n→ レポート出力: {report_path}')

    # --- alias_candidates.csv ---
    all_aliases = r80['name_mismatch'] + alias_candidates
    alias_path = REPORTS / 'alias_candidates.csv'
    with open(alias_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['大会','申請名','OCR名','チーム','競技名','類似度','ステータス','備考'])
        w.writeheader()
        for row in all_aliases:
            row.setdefault('備考', '')
            w.writerow(row)
    print(f'→ エイリアス候補: {alias_path}  ({len(all_aliases)}件)')

    # --- name_diff_80.csv ---
    diff_path = REPORTS / 'name_diff_80.csv'
    with open(diff_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['大会','申請名','OCR名','チーム','競技名','類似度','ステータス','備考'])
        w.writeheader()
        for row in r80['name_mismatch']:
            row.setdefault('備考', '')
            w.writerow(row)
    print(f'→ 第80回差分: {diff_path}  ({len(r80["name_mismatch"])}件)')


if __name__ == '__main__':
    main()
