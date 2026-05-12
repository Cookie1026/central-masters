import pdfplumber
import json

pdf_path = '第78回マスターズ結果(2025-05-31).pdf'
mapping_path = 'pua_mapping.json'

with open(mapping_path, encoding='utf-8') as f:
    mapping = json.load(f)

with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[4] # First results page
    
    # 1. Raw text (contains PUA)
    raw_text = page.extract_text()
    
    # 2. Extract with mapping but keep track of PUA codes
    # We will build a text where each character is followed by its PUA code in brackets if it is a PUA.
    modified_chars = []
    for c in page.chars:
        c_copy = c.copy()
        key = f"{c['fontname']}_{c['text']}"
        if key in mapping:
            # Append the PUA code to the mapped text
            c_copy['text'] = f"{mapping[key]}[{repr(c['text'])}]"
        elif '\uf000' <= c['text'] <= '\uf8ff':
            c_copy['text'] = f"?[{repr(c['text'])}]"
        modified_chars.append(c_copy)
    
    annotated_text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=5, y_tolerance=3)
    
    with open('annotated_sample.txt', 'w', encoding='utf-8') as f:
        f.write(annotated_text[:2000])
