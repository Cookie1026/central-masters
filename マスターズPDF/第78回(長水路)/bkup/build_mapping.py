import pdfplumber
import winocr
from PIL import Image
import asyncio
import sys
from collections import defaultdict

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"

def main():
    pua_votes = defaultdict(lambda: defaultdict(int))
    
    with pdfplumber.open(pdf_path) as pdf:
        # Process more pages to ensure all fonts and characters are covered
        total_pages = len(pdf.pages)
        # Results usually start from page 5 (idx 4)
        for page_idx in range(4, total_pages):
            print(f"Processing page {page_idx + 1}/{total_pages}...")
            page = pdf.pages[page_idx]
            
            # 1. Render page to image
            pil_image = page.to_image(resolution=300).original
            
            # 2. Get OCR results
            ocr_res = winocr.recognize_pil_sync(pil_image, lang='ja')
            
            # 3. Get pdfplumber characters
            pdf_chars = page.chars
            
            # 4. Map OCR words/chars to PDF chars based on bounding boxes
            scale = 300 / 72.0
            
            # Create a spatial index of PDF characters for faster lookup
            from bisect import bisect_left
            pdf_chars.sort(key=lambda c: c['top'])
            
            for line in ocr_res['lines']:
                for word in line['words']:
                    word_text = word['text']
                    wx = word['bounding_rect']['x'] / scale
                    wy = word['bounding_rect']['y'] / scale
                    ww = word['bounding_rect']['width'] / scale
                    wh = word['bounding_rect']['height'] / scale
                    
                    # Find chars in the vertical range
                    # This is a bit simplified; in production we'd use a better spatial index
                    intersecting_chars = []
                    for c in pdf_chars:
                        if c['top'] > wy + wh: break # Optimization
                        if c['bottom'] < wy: continue
                        
                        cx0, cx1 = c['x0'], c['x1']
                        # Check horizontal intersection
                        if not (cx1 < wx or cx0 > wx + ww):
                            intersecting_chars.append(c)
                    
                    # Sort intersecting chars by x0
                    intersecting_chars.sort(key=lambda c: c['x0'])
                    
                    if len(intersecting_chars) == len(word_text):
                        for char_obj, ocr_c in zip(intersecting_chars, word_text):
                            pua_char = char_obj['text']
                            fontname = char_obj['fontname']
                            if '\uf000' <= pua_char <= '\uf8ff':
                                key = f"{fontname}_{pua_char}"
                                pua_votes[key][ocr_c] += 1
            
            # Also identify potential spaces: PUA characters that are NEVER mapped to a character by OCR
            # but are present in the PDF.
            # We'll do this at the end by checking which keys in pua_votes are still empty but seen in pdf.
            for char_obj in pdf_chars:
                pua_char = char_obj['text']
                fontname = char_obj['fontname']
                if '\uf000' <= pua_char <= '\uf8ff':
                    key = f"{fontname}_{pua_char}"
                    if key not in pua_votes:
                        # Initialize with a low-priority space vote
                        pua_votes[key][' '] += 0 # Just to track seen keys

    # Print out the results and save to JSON
    mapping = {}
    import json
    for key, votes in pua_votes.items():
        if not votes:
            best_char = ' ' # Fallback to space
        else:
            best_char = max(votes.items(), key=lambda item: item[1])[0]
        mapping[key] = best_char
    
    with open(r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json", "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print("Saved mapping to pua_mapping.json")

if __name__ == "__main__":
    main()
