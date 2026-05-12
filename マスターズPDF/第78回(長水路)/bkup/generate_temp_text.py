import pdfplumber
import json

mapping_path = r"c:\Users\user\.gemini\antigravity\brain\cd11bd9f-4b03-4adc-b109-36678e8bd40a\scratch\pua_mapping.json"
pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第77回(長水路)\第77回マスターズ結果(2024-10-26).pdf"

with open(mapping_path, encoding='utf-8') as f:
    mapping = json.load(f)

with pdfplumber.open(pdf_path) as pdf:
    # Just page 4 to check
    text = pdf.pages[3].extract_text()

replaced_text = "".join(mapping.get(c, c) for c in text)

with open(r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\temp_text.txt", "w", encoding="utf-8") as f:
    f.write(replaced_text)
