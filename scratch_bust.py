import os
import glob

files = glob.glob('**/*.html', recursive=True)
for f in files:
    if 'node_modules' in f: continue
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    if 'src="/js/api.js"' in content or 'src="/api.js"' in content:
        content = content.replace('src="/js/api.js"', 'src="/js/api.js?v=2"')
        content = content.replace('src="/api.js"', 'src="/api.js?v=2"')
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        print('Updated', f)
