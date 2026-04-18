with open(r'C:\Users\263350F\_myProjects\GPRTool\app\index.html', encoding='utf-8') as f:
    content = f.read()

marker = '<script type="module">'
start  = content.find(marker)
stop   = content.rfind('</script>')
script = content[start:stop]

depth = 0
inside_str = None
i = 0
problems = []
while i < len(script):
    ch = script[i]
    if inside_str:
        if ch == '\\':
            i += 2
            continue
        if ch == inside_str:
            inside_str = None
    elif ch in ('"', "'", '`'):
        inside_str = ch
    elif ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth < 0:
            ln = script[:i].count('\n') + 1
            ctx = script[max(0, i-80):i+30].replace('\n', ' ')
            problems.append(f'script-line {ln}: ...{ctx}...')
            depth = 0
    i += 1

if problems:
    for p in problems:
        print(p)
else:
    print(f'No negative-depth braces found.')
print(f'Final brace depth: {depth}  (0=balanced)')
