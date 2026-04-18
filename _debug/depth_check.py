f = open(r'C:\Users\263350F\_myProjects\GPRTool\app\index.html', encoding='utf-8')
lines = f.readlines()
f.close()

# Find the script start and track depth from there
script_start = None
for i, l in enumerate(lines):
    if 'type="module"' in l:
        script_start = i
        break

# Track depth from script start, print all function/block openers at depth 0 or 1
depth = 0
inside_str = None
i = script_start
while i < len(lines):
    line = lines[i]
    # Crude depth tracking — skip strings
    for ch in line:
        if inside_str:
            if ch == inside_str: inside_str = None
        elif ch in ('"', "'"):
            inside_str = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
    
    # Print key structural lines
    stripped = line.strip()
    if (depth <= 2 and (
        stripped.startswith('function ') or 
        stripped.startswith('async function') or
        stripped == '}'  or stripped == '};' or stripped == '});'
    )) and i >= 2290 and i <= 2360:
        print(f'file:{i+1} depth_after:{depth} | {stripped[:80]}')
    i += 1
