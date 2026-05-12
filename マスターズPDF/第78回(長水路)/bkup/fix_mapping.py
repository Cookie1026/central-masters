import json

with open('pua_mapping.json', encoding='utf-8') as f:
    m = json.load(f)

for k, v in m.items():
    if v == 'セ':
        m[k] = ' '
    elif v == '間':
        m[k] = ' '
    elif v == '6':
        # Name space, e.g. 熊谷6一枝
        m[k] = ' '
    elif v == '己':
        m[k] = '記'
    elif v == 'へ':
        m[k] = '録'
    elif v == 'ェ':
        m[k] = 'エ' # 森川タェ子 -> 森川タエ子
    elif v == 'ノ':
        m[k] = 'バ' # ザノス -> ザバス, 4ノ50m -> 4バ50m? (4x50m) wait.
        # It's better to keep ノ and fix 4ノ50m to 4x50m later.
        m[k] = 'バ'
    elif v == '7':
        # 77時77間 ->  時 間
        m[k] = ' '
    elif v == '門':
        # 時門 -> 時間
        m[k] = '間'

with open('pua_mapping.json', 'w', encoding='utf-8') as f:
    json.dump(m, f, ensure_ascii=False, indent=2)

print("Fixed pua_mapping.json")
