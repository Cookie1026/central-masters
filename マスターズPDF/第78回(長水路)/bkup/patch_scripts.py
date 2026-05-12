"""
extract_v3.py と create_v4.py にパッチを当てるスクリプト
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

BASE = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)'

# ---- 1. extract_v3.py へのパッチ ----
print("=== extract_v3.py にパッチ適用中 ===")

# PUAキーを作成: フォント名 + PUA文字
def pua_key(font, code):
    return f"CIDFont+F{font}_" + chr(code)

NEW_OVERRIDES = [
    # 「っ」→「3」: リレー・個人種目各ページのPUA文字
    (pua_key(14, 0xF036), '3'),
    (pua_key(18, 0xF037), '3'),
    (pua_key(21, 0xF035), '3'),
    (pua_key(62, 0xF03F), '3'),
    (pua_key(65, 0xF03A), '3'),
    (pua_key(67, 0xF03C), '3'),
    # 「れ」→「2」: 50m背泳ぎページ F46のみ（F12/F30/F68/F80は正当なれ）
    (pua_key(46, 0xF03E), '2'),
    # 「O」→「 」: F67ページの空白PUA文字
    (pua_key(67, 0xF025), ' '),
]

v3_path = BASE + r'\extract_v3.py'
with open(v3_path, encoding='utf-8') as f:
    content = f.read()

# 既存のF2行を見つけてその後に追記
# F2行: mapping['CIDFont+F2_'] = '路' (PUA charが埋め込まれている)
# 「mapping['CIDFont+F2」で検索
insert_after = None
lines = content.split('\n')
for i, line in enumerate(lines):
    if "mapping['CIDFont+F2_" in line and "= '路'" in line:
        insert_after = i
        break

if insert_after is None:
    print("ERROR: F2行が見つかりません")
    sys.exit(1)

print(f"F2行を行{insert_after+1}に発見: {lines[insert_after][:60]!r}")

# 新しいオーバーライド行を生成
new_lines = [
    "# 「3」に修正: リレーページのPUA文字（っ→3）",
]
for key, val in NEW_OVERRIDES:
    font_num = key.split('CIDFont+F')[1].split('_')[0]
    pua_char = key.split('_')[1]
    pua_hex = hex(ord(pua_char))
    new_lines.append(f"mapping[{key!r}] = {val!r}  # F{font_num} {pua_hex}")

# 挿入
result_lines = lines[:insert_after+1] + new_lines + lines[insert_after+1:]
new_content = '\n'.join(result_lines)

with open(v3_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"extract_v3.py を更新しました（+{len(new_lines)}行）")

# 検証
with open(v3_path, encoding='utf-8') as f:
    verify = f.read()
for key, val in NEW_OVERRIDES:
    if key in verify:
        print(f"  ✓ {key!r} → {val!r}")
    else:
        print(f"  ✗ {key!r} → NOT FOUND")

# ---- 2. create_v4.py へのパッチ ----
print()
print("=== create_v4.py にパッチ適用中 ===")

v4_path = BASE + r'\create_v4.py'
with open(v4_path, encoding='utf-8') as f:
    v4_content = f.read()

# 既存のSIMPLEリストの末尾（']'の直前）に新エントリを追加
NEW_SIMPLE = [
    # クラブ名の文字欠け修正（PUAマッピング未対応文字）
    ('セ・ 谷',     'セ・越谷'),
    ('セ・ 浜',     'セ・横浜'),
    ('セ・ 毛海岸',  'セ・稲毛海岸'),
    ('セ・ 生',     'セ・福生'),
    ('セ・ 中',     'セ・府中'),
    ('セ・ 東戸塚',  'セ・F東戸塚'),
    ('セ・ 湘南',   'セ・s湘南台'),
    ('セ・ 塚',     'セ・平塚'),
    ('セ・ 島',     'セ・福島'),
    ('セ・ 沢',     'セ・藤沢'),
    ('セ・ 槻',     'セ・岩槻'),
    # 氏名の文字欠け
    ('遠 桃',      '遠藤 桃'),
    ('佐 桂子',    '佐藤 桂子'),
    # クラブ名の空白修正
    ('クリ ーンスパ', 'クリーンスパ'),
]

# '下 成人', '下家 成人' の行を探す（SIMPLEリストの最後のエントリ）
find_marker = "    ('下 成人',"
marker_idx = v4_content.find(find_marker)
if marker_idx == -1:
    print("ERROR: SIMPLEリスト末尾が見つかりません")
    sys.exit(1)

# この行の後（次の行 = ']'の直前）に挿入
insert_pos = v4_content.find('\n', marker_idx) + 1
# 次の行（'    ]'）を確認
next_line_end = v4_content.find('\n', insert_pos)
next_line = v4_content[insert_pos:next_line_end]
print(f"挿入位置の次行: {next_line!r}")

new_entries = "    # クラブ名・氏名の文字欠け修正（追加）\n"
for old, new in NEW_SIMPLE:
    new_entries += f"    ({old!r},  {new!r}),\n"

new_v4_content = v4_content[:insert_pos] + new_entries + v4_content[insert_pos:]

with open(v4_path, 'w', encoding='utf-8') as f:
    f.write(new_v4_content)

print(f"create_v4.py を更新しました（+{len(NEW_SIMPLE)}エントリ）")

# 検証
with open(v4_path, encoding='utf-8') as f:
    verify4 = f.read()
for old, new in NEW_SIMPLE[:3]:
    if old in verify4:
        print(f"  ✓ {old!r}")
    else:
        print(f"  ✗ {old!r} NOT FOUND")

print()
print("パッチ適用完了！")
