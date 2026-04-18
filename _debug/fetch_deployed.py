import urllib.request
url = 'https://gprtool.vercel.app/'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
content = urllib.request.urlopen(req).read().decode('utf-8')
lines = content.split('\n')
print(f'Total lines in deployed file: {len(lines)}')
# Show lines 2349-2357
for i in range(2348, 2358):
    print(f'{i+1}: {repr(lines[i][:100])}')
