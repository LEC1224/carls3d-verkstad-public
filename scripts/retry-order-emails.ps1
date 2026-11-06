$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configValues = @{}
Get-Content -LiteralPath (Join-Path $projectRoot '.env.local') | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { $configValues[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}
if (-not $configValues['ORDER_WORKFLOW_TOKEN']) { throw 'Workflow token not configured' }
$headers = @{ Authorization = 'Bearer ' + $configValues['ORDER_WORKFLOW_TOKEN'] }
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/order-workflow' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"action":"emails"}' -TimeoutSec 180 | Out-Null
