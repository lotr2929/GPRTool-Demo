f = open(r'C:\Users\263350F\_myProjects\GPRTool\app\index.html', encoding='utf-8')
lines = f.readlines()
f.close()

for i, l in enumerate(lines, 1):
    if 'type="module"' in l:
        print(f'Module script starts at file line {i}')
        break

# Show lines 2350-2360
for n in range(2350, 2361):
    print(f'{n}: {repr(lines[n-1][:80])}')
