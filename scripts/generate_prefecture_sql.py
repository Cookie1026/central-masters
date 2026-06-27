#!/usr/bin/env python3
"""
共通Mチーム一覧.csv の県名を mst_team.prefecture に反映するSQL生成スクリプト。
出力: supabase/migrations/set_prefecture.sql
"""
import csv, sys, unicodedata, os, re
sys.stdout.reconfigure(encoding='utf-8')

# 地名から都道府県を推測できる手動マッピング（確実なもののみ）
MANUAL_PREF: dict[str, str] = {
    # 千葉
    'セ・蘇我':     '千葉', 'セ・千葉みなと': '千葉', 'セ・新浦安': '千葉',
    'セ・館山':     '千葉', 'セ・志津':      '千葉', 'セ・本八幡':  '千葉',
    'セ・袖ヶ浦':   '千葉', '南行徳':       '千葉', '浦安':       '千葉',
    'セ・馆山':     '千葉',  # OCR誤読（馆=館の簡体字）
    # 東京
    'セ・西東京':   '東京', 'セ・蒲田':     '東京', 'セ・東十条':  '東京',
    'セ・亀有':     '東京', 'セ・西台':     '東京', 'セ・大泉学園': '東京',
    # 神奈川
    'セ・本郷台':   '神奈川', 'ザバス川崎':  '神奈川', 'ザバス金沢八': '神奈川',
    'ザバス藤が丘': '神奈川', 'ザバス和光':  '埼玉',   'セ・S湘南台': '神奈川',
    '金沢八景':     '神奈川', '八景':        '神奈川', '川崎':       '神奈川',
    'セ・川崎':     '神奈川', 'G−SPA':      '神奈川',
    '颯介セ・慶應日吉': '神奈川',  # 旧OCR誤読名（fix_team_names.sqlで修正済み）
    '慶應日吉': '神奈川',
    # 群馬
    'セ・前橋':     '群馬',  'セ・高崎':    '群馬',
    # 栃木
    'セ・宇都宮':   '栃木',
    # 福島
    'セ・郡山':     '福島',
    # 兵庫
    '芦屋海浜公園': '兵庫',
    # ザパス系（ザバスの旧表記）→ 対応チームと同じ都道府県
    'ザパス川崎':   '神奈川', 'ザパス鶴見':  '神奈川', 'ザパス金沢八': '神奈川',
}


def normalize(s: str) -> str:
    return unicodedata.normalize('NFKC', s.strip())

def strip_se(name: str) -> str:
    """セ・prefix / ・セ suffix を除去"""
    if name.startswith('セ・'):
        return name[2:]
    if name.endswith('・セ'):
        return name[:-2]
    return name


def load_csv_teams() -> dict[str, str]:
    """チーム名 → 県名 (共通 + 第80回)"""
    result: dict[str, str] = {}
    for path in ['data/共通Mチーム一覧.csv', 'data/第80回Mチーム一覧.csv']:
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                name = normalize(row.get('チーム名', '').strip())
                pref = row.get('県名', '').strip()
                if name and pref:
                    result[name] = pref
    return result


def load_db_teams() -> list[dict]:
    from dotenv import load_dotenv
    load_dotenv('.env.local')
    from supabase import create_client
    url = os.environ['NEXT_PUBLIC_SUPABASE_URL']
    key = os.environ['NEXT_PUBLIC_SUPABASE_ANON_KEY']
    sb = create_client(url, key)
    return sb.table('mst_team').select('id, name, prefecture').execute().data


def find_pref(db_name: str, csv_teams: dict[str, str]) -> tuple[str | None, str]:
    """
    db_name に対応する prefecture と一致理由を返す。
    見つからなければ (None, '') を返す。
    """
    db_n = normalize(db_name)

    # 1. 完全一致
    if db_n in csv_teams:
        return csv_teams[db_n], '完全一致'

    # 2. DB が "セ・" prefix / "・セ" suffix → 除去して再検索
    stripped = strip_se(db_n)
    if stripped != db_n and stripped in csv_teams:
        return csv_teams[stripped], 'セ除去'

    # 3. CSV 側が "セ・" prefix → 除去して再検索
    csv_stripped_match = {strip_se(k): v for k, v in csv_teams.items()}
    if stripped in csv_stripped_match:
        return csv_stripped_match[stripped], 'CSV側セ除去'

    # 4. 手動マッピング（元の名前 or セ除去後で検索）
    if db_n in MANUAL_PREF:
        return MANUAL_PREF[db_n], '手動マッピング'
    if stripped in MANUAL_PREF:
        return MANUAL_PREF[stripped], '手動マッピング(セ除去)'

    return None, ''


def main():
    csv_teams = load_csv_teams()
    db_teams  = load_db_teams()

    matched   = []
    unmatched = []

    for team in db_teams:
        if not team['name']:  # 空名チームはスキップ
            continue
        pref, reason = find_pref(team['name'], csv_teams)
        if pref:
            matched.append((team['id'], team['name'], pref, reason))
        else:
            unmatched.append(team)

    # SQL 生成
    lines = [
        '-- 都道府県セット (generate_prefecture_sql.py で自動生成)',
        '-- 全チームを対象に上書き更新する',
        '',
    ]
    for tid, db_name, pref, reason in sorted(matched, key=lambda x: x[0]):
        esc = pref.replace("'", "''")
        lines.append(f"UPDATE mst_team SET prefecture = '{esc}' WHERE id = {tid};  -- {db_name}")

    sql_path = 'supabase/migrations/set_prefecture.sql'
    with open(sql_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print(f"✅ マッチ: {len(matched)} チーム → {sql_path}")
    print()

    if unmatched:
        print(f"⚠️  prefecture が不明なチーム ({len(unmatched)}件) ← NULL のまま残る:")
        for t in unmatched:
            print(f"   id={t['id']:3d}  {t['name']}")


if __name__ == '__main__':
    main()
