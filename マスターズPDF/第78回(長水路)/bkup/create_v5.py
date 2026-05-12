"""
第78回PDF元データ(claude)V5.csv 作成スクリプト
V4 CSV → 構造化CSV変換
  ・氏名の姓名を結合（スペース除去）
  ・各項目をカンマ区切りに
  ・LAP時間行を ""で囲む
  ・反応時間の()と先頭+を除去
  ・不明文字をメモ(claude).txtに記録
"""

import csv
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE     = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)'
IN_PATH  = BASE + r'\第78回PDF元データ(claude)V4.csv'
OUT_PATH = BASE + r'\第78回PDF元データ(claude)V5.csv'
MEMO_PATH = BASE + r'\メモ(claude).txt'

# ---- 正規表現 ----
RE_LAP_LINE = re.compile(r'^[\d:]+\.\d+(\s+[\d:]+\.\d+)+\s*$')
RE_RECORD   = re.compile(r'^(世界記録|日本記録|大会記録)\s+([\d:]+\.\d+)\s*$')
RE_EVENT    = re.compile(r'^(No\.\d+)\s+(.+)$')
RE_TOTAL    = re.compile(r'^(\d+位)\s+(.+?)\s+([\d\.]+点)\s*$')
RE_COL_IND  = re.compile(r'^順位\s+氏名\s+所属\s+水路\s+時間\s*$')
RE_COL_REL  = re.compile(r'^順位\s+チ.ム名\s+合計年齢\s+水路\s+時間\s*$')

# リレー結果: rank team age lane time [rest]
RE_RELAY = re.compile(
    r'^(\d+)\s+(\S+)\s+(\d+歳)\s+(\d+/\d+)\s+([\d:]+\.\d+)(.*)?$'
)
# リレー棄権/失格（順位なし）
RE_RELAY_WD = re.compile(
    r'^(\S+)\s+(\d+歳)\s+(\d+/\d+)\s+(棄権|競\d+)(.*)?$'
)
# 個人結果: rank name_club lane time_or_special [rest]
RE_INDIV = re.compile(
    r'^(\d+)\s+(.+?)\s+(\d+/\d+)\s+([\d:]+\.\d+|棄権|競\d+)(.*)?$'
)
# 棄権/失格（順位なし、名前から始まる）
RE_WITHDR = re.compile(
    r'^(.+?)\s+(\d+/\d+)\s+(棄権|競\d+)(.*)?$'
)
# リレーメンバー: num name (reaction) time [extra]
RE_MEMBER = re.compile(
    r'^(\d+)\s+(.+?)\s+\(\s*([+\-]?[\d\.]+|-*)\s*\)\s+([\d:]+\.\d+)(.*)?$'
)


def clean_reaction(s):
    """'(+0.32)' や '(0.68)' → '0.32' / '0.68'、'( )' → ''"""
    inner = s.strip('() ').strip()
    if not inner or set(inner) <= {'-'}:
        return ''
    return inner.lstrip('+')


def parse_name_club(text, row_num, memo):
    """'姓 名 セ・XX' → ('姓名', 'セ・XX')"""
    parts = text.split()
    if not parts:
        return '', ''
    if len(parts) == 1:
        return parts[0], ''
    club = parts[-1]
    name = ''.join(parts[:-1])
    # クラブ名に空白があれば（文字欠けの可能性）メモへ
    if re.search(r'セ・\s', text) or re.search(r'セ・$', club):
        memo.append(f'行{row_num}: クラブ名に文字欠けの可能性 {text!r}  →club={club!r}')
    return name, club


def parse_result_rest(s):
    """
    'time [・大会新] [(reaction)]' を解析して (time, reaction, notes) を返す。
    """
    s = s.strip()
    reaction = ''
    m = re.search(r'\(\s*([+\-]?[\d\.]+|-*)\s*\)', s)
    if m:
        reaction = clean_reaction(m.group(0))
        s = (s[:m.start()] + ' ' + s[m.end():]).strip()

    times, notes = [], []
    for tok in s.split():
        if re.match(r'^[\d:]+\.\d+$', tok):
            times.append(tok)
        else:
            notes.append(tok.lstrip('・'))
    return (times[0] if times else ''), reaction, ''.join(notes)


def check_suspicious(s, row_num, memo):
    """不審な文字をメモに記録。"""
    for ch in s:
        if '' <= ch <= '':
            memo.append(f'行{row_num}: PUA文字 U+{ord(ch):04X}  行: {s[:60]!r}')
    # 数字と平仮名が直接隣接（タイム・年齢の中に「っ」等が混入）
    seen = set()
    for m in re.finditer(r'(?:\d[ぁ-ん]|[ぁ-ん]\d)', s):
        key = m.group()
        if key not in seen:
            seen.add(key)
            memo.append(f'行{row_num}: 数字に平仮名混入（タイム/年齢欠け）「{m.group()}」  行: {s[:60]!r}')
    # クラブ名「セ・」の直後に空白（漢字欠け）
    if re.search(r'セ・\s', s):
        m2 = re.search(r'セ・\s+(\S*)', s)
        frag = m2.group(0).strip() if m2 else '?'
        memo.append(f'行{row_num}: クラブ名に文字欠け 「{frag}」  行: {s[:60]!r}')
    # 未マップ文字「?」
    if '?' in s:
        memo.append(f'行{row_num}: 未マップ文字「?」  行: {s[:60]!r}')


def process(line, prev_result, row_num, memo):
    """
    Returns (fields: list[str], is_result: bool, is_lap: bool)
    """
    s = line.strip()
    if not s:
        return [''], False, False

    check_suspicious(s, row_num, memo)

    # ---- リレー棄権/失格（順位なし） ----
    m = RE_RELAY_WD.match(s)
    if m:
        return [m.group(1), m.group(2), m.group(3), m.group(4)], True, False

    # ---- リレー結果 ----
    m = RE_RELAY.match(s)
    if m:
        rank, team, age, lane, time = m.group(1,2,3,4,5)
        rest = (m.group(6) or '').strip()
        row  = [rank, team, age, lane, time]
        if rest:
            row.append(rest)
        return row, True, False

    # ---- 個人結果 ----
    m = RE_INDIV.match(s)
    if m:
        rank       = m.group(1)
        name_club  = m.group(2).strip()
        lane       = m.group(3)
        result_tok = m.group(4)
        rest       = (m.group(5) or '').strip()
        name, club = parse_name_club(name_club, row_num, memo)

        if result_tok in ('棄権',) or re.match(r'競\d+', result_tok):
            return [rank, name, club, lane, result_tok], True, False

        time, reaction, notes = parse_result_rest(f'{result_tok} {rest}')
        if not time:
            time = result_tok
        if not re.match(r'^[\d:]+\.\d+$', time):
            memo.append(f'行{row_num}: タイム形式が不正 「{time}」  行: {s[:60]!r}')
        row = [rank, name, club, lane, time, reaction]
        if notes:
            row.append(notes)
        return row, True, False

    # ---- 棄権/失格（順位なし、名前始まり） ----
    m = RE_WITHDR.match(s)
    if m:
        name, club = parse_name_club(m.group(1).strip(), row_num, memo)
        return [name, club, m.group(2), m.group(3)], True, False

    # ---- リレーメンバー ----
    m = RE_MEMBER.match(s)
    if m:
        num    = m.group(1)
        name   = ''.join(m.group(2).strip().split())
        react  = clean_reaction(m.group(3))
        time   = m.group(4)
        extra  = (m.group(5) or '').strip()
        row    = [num, name, react, time]
        if extra:
            row.append(extra)
        return row, False, False

    # ---- LAP時間行（前行が結果行の場合） ----
    if prev_result and RE_LAP_LINE.match(s):
        return [s], False, True  # is_lap=True

    # ---- 記録行 ----
    m = RE_RECORD.match(s)
    if m:
        return [m.group(1), m.group(2)], False, False

    # ---- 種目ヘッダー ----
    m = RE_EVENT.match(s)
    if m:
        return [m.group(1)] + m.group(2).split(), False, False

    # ---- 総合成績エントリ ----
    m = RE_TOTAL.match(s)
    if m:
        return [m.group(1), m.group(2), m.group(3)], False, False

    # ---- 列ヘッダー ----
    if RE_COL_IND.match(s):
        return ['順位', '氏名', '所属', '水路', '時間'], False, False
    if RE_COL_REL.match(s):
        return ['順位', 'チーム名', '合計年齢', '水路', '時間'], False, False

    # ---- それ以外（ヘッダー等）はそのまま ----
    return [s], False, False


# ---- メイン ----
memo = []

with open(IN_PATH, encoding='utf-8-sig', newline='') as fin:
    rows_in = [r[0] if r else '' for r in csv.reader(fin)]

prev_result = False
result_rows  = []  # (fields, is_lap)

for i, line in enumerate(rows_in, 1):
    fields, is_result, is_lap = process(line, prev_result, i, memo)
    result_rows.append((fields, is_lap))
    prev_result = is_result

# ---- 書き出し ----
with open(OUT_PATH, 'w', encoding='utf-8-sig', newline='') as fout:
    writer = csv.writer(fout, quoting=csv.QUOTE_MINIMAL)
    lap_count = 0
    for fields, is_lap in result_rows:
        if is_lap:
            fout.write(f'"{fields[0]}"\r\n')
            lap_count += 1
        else:
            writer.writerow(fields)

print(f'出力行数: {len(result_rows)}  うちLAP行: {lap_count}')
print(f'出力完了: {OUT_PATH}')

# ---- メモ出力 ----
with open(MEMO_PATH, 'w', encoding='utf-8-sig') as fm:
    fm.write(f'メモ(claude).txt — 要確認リスト ({len(memo)}件)\n')
    fm.write('=' * 60 + '\n')
    for entry in memo:
        fm.write(entry + '\n')

print(f'メモ: {len(memo)}件 → {MEMO_PATH}')
