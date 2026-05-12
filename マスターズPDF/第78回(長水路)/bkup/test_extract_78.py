import pdfplumber
import sys

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"

try:
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) > 3:
            page = pdf.pages[3]
            text = page.extract_text()
            print("--- Page 4 Text Sample ---")
            print(text[:500] if text else "No text extracted")
            
            # Print unique characters to see if it's PUA (like \uf020)
            chars = set(text) if text else set()
            print("\n--- Unique characters (repr) ---")
            print(repr("".join(chars))[:200])
        else:
            print("PDF has fewer than 4 pages.")
except Exception as e:
    print(f"Error: {e}")
