"""
第78回PDF元データ(claude)V4.csv 作成スクリプト
V3 CSV への置換処理
"""
import csv
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

in_path  = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(claude)V3.csv'
out_path = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(claude)V4.csv'

# 単純置換テーブル（上から順番に適用）
SIMPLE = [
    ('宀',             '宮'),            # 全体: 宀→宮 (PUAマッピングエラー) ★最初に適用
    ('佐 由利子',      '佐藤由利子'),
    ('富 博子',        '富樫 博子'),
    ('近 みゆき',      '近藤みゆき'),
    ('成島志 子',      '成島志雅子'),
    ('本井 萃',        '本井 翆'),
    ('髙島 子',        '髙島 典子'),
    ('中山 萃',        '中山 翆'),
    ('折居 早',        '折居 彰'),
    ('山内 イ',        '山内 悠'),
    ('神戸優イ希',     '神戸優悠希'),
    ('都築クラウディオ佑亮セ・おおたか', '都築クラウディオ佑亮 セ・おおたか'),
    ('室谷 晴、',      '室谷 晴江'),
    ('太田 拓、',      '太田 拓江'),
    ('長谷川 子',      '長谷川節子'),
    ('川島か 子',      '川島かよ子'),
    ('近藤 な子',      '近藤ひな子'),
    ('森谷登 、',      '森谷登志江'),
    ('真栄田 ずえ',    '真栄田こずえ'),
    ('反谷 恵',        '板谷 仁恵'),
    ('公川 子',        '松川 律子'),
    ('可部の み',      '阿部のぞみ'),
    ('中辷 澄美',      '中辻 澄美'),
    ('下 成人',        '下家 成人'),
    # クラブ名・氏名の文字欠け修正（追加）
    ('セ・ 谷',  'セ・越谷'),
    ('セ・ 浜',  'セ・横浜'),
    ('セ・ 毛海岸',  'セ・稲毛海岸'),
    ('セ・ 生',  'セ・福生'),
    ('セ・ 中',  'セ・府中'),
    ('セ・ 東戸塚',  'セ・F東戸塚'),
    ('セ・ 湘南',  'セ・s湘南台'),
    ('セ・ 塚',  'セ・平塚'),
    ('セ・ 島',  'セ・福島'),
    ('セ・ 沢',  'セ・藤沢'),
    ('セ・ 槻',  'セ・岩槻'),
    ('遠 桃',  '遠藤 桃'),
    ('佐 桂子',  '佐藤 桂子'),
    ('クリ ーンスパ',  'クリーンスパ'),
]


def fix_line(line):
    for old, new in SIMPLE:
        line = line.replace(old, new)

    # 佐々木れ → 佐々木れい (すでに「い」がある場合はスキップ)
    line = re.sub(r'佐々木れ(?!い)', '佐々木れい', line)

    # 浜 健 → 横浜 健 (すでに「横」が前にある場合はスキップ)
    line = re.sub(r'(?<!横)浜 健', '横浜 健', line)

    # 条件付き置換: 同一行にクラブ名がある場合のみ
    if 'セ・成城' in line:
        line = re.sub(r'若宮(?!\s*強)', '若宮 強', line)
    if 'セ・大宮宮原' in line:
        line = re.sub(r'志水(?!\s*剛)', '志水 剛', line)
    if 'セ・二俣川' in line:
        line = re.sub(r'鶴谷(?!\s*学)', '鶴谷 学', line)

    return line


with open(in_path, encoding='utf-8-sig', newline='') as fin:
    reader = csv.reader(fin)
    rows_in = list(reader)

rows_out = []
fix_count = 0
for row in rows_in:
    new_row = [fix_line(cell) for cell in row]
    if new_row != row:
        fix_count += 1
    rows_out.append(new_row)

with open(out_path, 'w', encoding='utf-8-sig', newline='') as fout:
    writer = csv.writer(fout)
    writer.writerows(rows_out)

print(f'修正行数: {fix_count}')
print(f'合計行数: {len(rows_out)}')
print(f'出力完了: {out_path}')
