#!/usr/bin/env python3
"""Test PDF text extraction methods"""
import re
import sys

pdf_path = "/Users/ahmednabhan/Downloads/CCNA_S_1.pdf"

# Read PDF file
with open(pdf_path, 'rb') as f:
    content = f.read()[:20*1024*1024]  # Read first 20MB

binary_str = content.decode('latin-1')
print(f'Read {len(content)} bytes ({len(content)/(1024*1024):.1f} MB)')

# Method 1: Standard parentheses text
paren_texts = []
in_text = False
current = ''
for char in binary_str[:5000000]:  # First 5MB
    if char == '(':
        in_text = True
        current = ''
    elif char == ')' and in_text:
        in_text = False
        readable = ''.join(c for c in current if 32 <= ord(c) <= 126)
        if len(readable) > 1 and re.search(r'[a-zA-Z]', readable):
            paren_texts.append(readable)
    elif in_text:
        current += char

print(f'\nMethod 1 (parentheses): Found {len(paren_texts)} text fragments')
print('Sample:', paren_texts[:10] if paren_texts else 'None')

# Method 2: Hex-encoded text
hex_matches = re.findall(r'<[0-9A-Fa-f]{8,}>', binary_str)
print(f'\nMethod 2 (hex): Found {len(hex_matches)} hex blocks')

decoded_hex = []
for h in hex_matches[:200]:
    hex_data = h[1:-1]
    decoded = ''
    for i in range(0, len(hex_data)-3, 4):
        try:
            code = int(hex_data[i:i+4], 16)
            if 32 <= code <= 126:
                decoded += chr(code)
            elif 0x20 <= code <= 0xFFFF:
                ch = chr(code)
                if ch.isalnum() or ch in ' .,':
                    decoded += ch
        except:
            pass
    if len(decoded) > 2 and re.search(r'[a-zA-Z]{2,}', decoded):
        decoded_hex.append(decoded)

print(f'Decoded {len(decoded_hex)} text fragments')
print('Sample:', decoded_hex[:10] if decoded_hex else 'None')

# Method 3: BT/ET blocks with Tj
bt_matches = re.findall(r'BT[\s\S]{1,2000}?ET', binary_str[:5000000])
print(f'\nMethod 3 (BT/ET blocks): Found {len(bt_matches)} blocks')

tj_texts = []
for block in bt_matches[:100]:
    tjs = re.findall(r'\(([^)]{1,200})\)\s*Tj', block)
    for tj in tjs:
        clean = ''.join(c for c in tj if 32 <= ord(c) <= 126)
        if clean and re.search(r'[a-zA-Z]', clean):
            tj_texts.append(clean)

print(f'Extracted {len(tj_texts)} Tj texts')
print('Sample:', tj_texts[:10] if tj_texts else 'None')

# Method 4: Word sequences
words = re.findall(r'[A-Za-z][a-z]{2,15}(?:\s+[A-Za-z][a-z]{2,15}){2,}', binary_str[:5000000])
print(f'\nMethod 4 (word sequences): Found {len(words)} sequences')
print('Sample:', words[:5] if words else 'None')

# Total extraction
all_text = ' '.join(paren_texts + decoded_hex + tj_texts + words)
print(f'\nTotal extracted: {len(all_text)} characters')
print(f'Unique words: {len(set(all_text.split()))}')

# Show some actual content
if all_text:
    print('\n--- Sample Content (first 1000 chars) ---')
    print(all_text[:1000])
