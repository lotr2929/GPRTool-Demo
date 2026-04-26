# poll_vercel.ps1 - called by deploy.bat after git push
# Usage: powershell -File _dev\poll_vercel.ps1 -BaselineUid <uid>
param(
    [string]$BaselineUid = ""
)

$token     = (Get-Content deploy.env | Where-Object { $_ -match '^VERCEL_TOKEN=' })      -replace '^VERCEL_TOKEN=',''
$projectId = (Get-Content deploy.env | Where-Object { $_ -match '^VERCEL_PROJECT_ID=' }) -replace '^VERCEL_PROJECT_ID=',''
$teamId    = (Get-Content deploy.env | Where-Object { $_ -match '^VERCEL_TEAM_ID=' })    -replace '^VERCEL_TEAM_ID=',''

if (-not $token) {
    Write-Host "ERROR: VERCEL_TOKEN not loaded from deploy.env" -ForegroundColor Red
    exit 1
}

$headers  = @{ Authorization = 'Bearer ' + $token }
$url      = "https://api.vercel.com/v6/deployments?projectId=$projectId&teamId=$teamId&limit=5"
$maxWait  = 300
$interval = 5
$waited   = 0
$found    = $false
$start    = [int](Get-Date -UFormat %s)

Write-Host "  Baseline: $BaselineUid"

while ($waited -le $maxWait) {
    Start-Sleep -Seconds $interval
    $waited += $interval

    try {
        $resp    = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -ErrorAction Stop
        $latest  = $resp.deployments | Where-Object { $_.uid -ne $BaselineUid } | Select-Object -First 1
        $elapsed = [int](Get-Date -UFormat %s) - $start
        $timer   = '{0}:{1:D2}' -f [math]::Floor($elapsed / 60), ($elapsed % 60)

        if (-not $latest) {
            Write-Host "  [$timer]  Waiting for new deployment..."
            continue
        }

        $state = $latest.state
        Write-Host "  [$timer]  $($latest.uid) - $state"

        if ($state -eq 'READY') {
            Write-Host "  Deployment READY in $timer." -ForegroundColor Green
            $found = $true
            break
        } elseif ($state -eq 'ERROR' -or $state -eq 'CANCELED') {
            Write-Host "  Deployment $state after $timer." -ForegroundColor Red
            Write-Host "  --- Build Log ---" -ForegroundColor Yellow
            try {
                $uid = $latest.uid
                $logUrl = "https://api.vercel.com/v3/deployments/$uid/events"
                $events = Invoke-RestMethod -Uri $logUrl -Headers $headers -Method Get -ErrorAction Stop
                $logLines = $events | Where-Object { $_.type -eq 'stdout' -or $_.type -eq 'stderr' -or $_.type -eq 'command' } | Select-Object -Last 30
                foreach ($line in $logLines) {
                    $text = if ($line.payload.text) { $line.payload.text } else { $line.payload }
                    $color = if ($line.type -eq 'stderr') { 'Red' } else { 'Gray' }
                    Write-Host "  $text" -ForegroundColor $color
                }
            } catch {
                Write-Host "  (Could not fetch build log: $($_.Exception.Message))" -ForegroundColor Yellow
            }
            Write-Host "  -----------------" -ForegroundColor Yellow
            exit 1
        }

    } catch {
        Write-Host "  Polling error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $found) {
    Write-Host "  Timed out after 5 minutes." -ForegroundColor Red
    exit 1
}
