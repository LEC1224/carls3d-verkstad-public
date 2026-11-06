param(
    [string]$ReleaseDirectory,
    [string]$ExpectedCommit,
    [string]$BackupDirectory,
    [switch]$Rollback
)

# Run on HP-ProDesk after building and smoke-testing an isolated GitHub checkout.
# Runtime data stays at its existing path. Rollback never restores an old database.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$appRoot = 'C:\3dproxy\carls3d'
$releaseRoot = 'C:\3dproxy\carls3d-releases'
$backupRoot = 'C:\3dproxy\carls3d-deploy-backups'
$webTask = 'Carls3D Web'
$emailTask = 'Carls3D Email Retry'

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the permitted directory: $resolved"
    }
    return $resolved
}

function Source-Path([string]$Root, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[/\\])\.\.([/\\]|$)') {
        throw 'Invalid source manifest path'
    }
    if ($Relative -match '^(uploads|data|node_modules|\.next|\.git)(/|\\|$)' -or
        $Relative -match '^\.env($|\.)' -and $Relative -ne '.env.example' -or
        $Relative -match '^prisma[/\\].*\.db') {
        throw "Runtime or private data in source manifest: $Relative"
    }
    return Assert-ChildPath (Join-Path $Root $Relative) $Root
}

function Copy-File([string]$From, [string]$To) {
    New-Item -ItemType Directory -Path (Split-Path $To) -Force | Out-Null
    Copy-Item -LiteralPath $From -Destination $To -Force
}

function Stop-Web {
    Stop-ScheduledTask -TaskName $webTask
    Start-Sleep -Seconds 2
    $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($process.Name -ne 'node.exe' -or !$process.CommandLine.Contains($appRoot + '\node_modules\next\dist\bin\next')) {
            throw 'Port 3000 belongs to an unexpected process; refusing to stop it'
        }
        Stop-Process -Id $listener.OwningProcess -Force
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (!(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw 'Port 3000 did not stop'
}

function Test-Web([switch]$PreviousVersion) {
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    try {
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            try {
                $response = $client.GetAsync('http://127.0.0.1:3000/').GetAwaiter().GetResult()
                if ([int]$response.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
            Start-Sleep -Seconds 1
        }
        if (!$ready) { throw 'Homepage did not become healthy' }
        $checks = @{
            '/bestall' = 200; '/lithophane' = 200; '/minecraft-torch' = 200;
            '/api/availability?material=PLA' = 200; '/api/orders' = 401;
            '/api/order-workflow' = 401; '/review' = 307
        }
        if (!$PreviousVersion) { $checks['/admin'] = 307 }
        foreach ($route in $checks.Keys) {
            $response = $client.GetAsync('http://127.0.0.1:3000' + $route).GetAwaiter().GetResult()
            if ([int]$response.StatusCode -ne $checks[$route]) {
                throw "Health check failed: $route returned $([int]$response.StatusCode)"
            }
        }
    } finally { $client.Dispose(); $handler.Dispose() }
}

function Restore-Release([string]$Directory) {
    $Directory = Assert-ChildPath $Directory $backupRoot
    $state = Get-Content -LiteralPath (Join-Path $Directory 'state.json') -Raw | ConvertFrom-Json
    $failed = Join-Path $Directory ('failed-release-' + (Get-Date -Format yyyyMMdd-HHmmss))
    New-Item -ItemType Directory -Path $failed -Force | Out-Null
    Stop-Web
    foreach ($folder in @('.next', 'node_modules')) {
        $saved = Assert-ChildPath (Join-Path $Directory $folder) $backupRoot
        $current = Assert-ChildPath (Join-Path $appRoot $folder) $appRoot
        if (Test-Path -LiteralPath $saved) {
            if (Test-Path -LiteralPath $current) { Move-Item -LiteralPath $current -Destination (Join-Path $failed $folder) }
            Move-Item -LiteralPath $saved -Destination $current
        }
    }
    foreach ($entry in $state.Files) {
        $target = Source-Path $appRoot $entry.Path
        if ($entry.Existed) {
            Copy-File (Source-Path (Join-Path $Directory 'source') $entry.Path) $target
        } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
            Remove-Item -LiteralPath $target -Force
        }
    }
    & git -C $appRoot reset --mixed $state.PreviousCommit
    if ($LASTEXITCODE -ne 0) { throw 'Could not restore Git index' }
    Start-ScheduledTask -TaskName $webTask
    Test-Web -PreviousVersion
    if ($state.EmailEnabled) { Enable-ScheduledTask -TaskName $emailTask | Out-Null }
    Write-Output "Rollback completed; customer data preserved. Backup: $Directory"
}

if ($env:COMPUTERNAME -ine 'HP-PRODESK') { throw 'This script is intended for HP-ProDesk only' }
if ($Rollback) {
    Disable-ScheduledTask -TaskName $emailTask | Out-Null
    Restore-Release $BackupDirectory
    exit
}
if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$') { throw 'A full Git commit is required' }
$ReleaseDirectory = Assert-ChildPath $ReleaseDirectory $releaseRoot
$actualCommit = (& git -C $ReleaseDirectory rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $ExpectedCommit) { throw 'Candidate commit mismatch' }
if ((& git -C $ReleaseDirectory status --porcelain)) { throw 'Candidate source is not clean' }
if (!(Test-Path -LiteralPath (Join-Path $ReleaseDirectory '.next\BUILD_ID'))) { throw 'Candidate is not built' }
$report = Get-Content -LiteralPath (Join-Path $ReleaseDirectory '.cache\built-site-smoke\report.json') -Raw | ConvertFrom-Json
if ($report.checks.Count -ne 8 -or @($report.checks | Where-Object { !$_.passed }).Count) { throw 'Candidate smoke checks are incomplete' }
$currentSchema = (Get-Content -LiteralPath (Join-Path $appRoot 'prisma\schema.prisma') -Raw) -replace '\s', ''
$nextSchema = (Get-Content -LiteralPath (Join-Path $ReleaseDirectory 'prisma\schema.prisma') -Raw) -replace '\s', ''
if ($currentSchema -ne $nextSchema) { throw 'Schema migration requires a separate reviewed deployment' }
& git -C $appRoot fetch origin $ExpectedCommit
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch release commit in live checkout' }
$newFiles = @(& git -C $ReleaseDirectory ls-files)
$oldFiles = @(& git -C $appRoot ls-files)
$allFiles = @($newFiles + $oldFiles | Sort-Object -Unique)
$BackupDirectory = Join-Path $backupRoot ('site-improvements-' + (Get-Date -Format yyyyMMdd-HHmmss))
$BackupDirectory = Assert-ChildPath $BackupDirectory $backupRoot
New-Item -ItemType Directory -Path $BackupDirectory | Out-Null
$entries = @()
foreach ($relative in $allFiles) {
    $source = Source-Path $appRoot $relative
    $exists = Test-Path -LiteralPath $source -PathType Leaf
    $entries += [pscustomobject]@{ Path = $relative; Existed = $exists }
    if ($exists) { Copy-File $source (Source-Path (Join-Path $BackupDirectory 'source') $relative) }
}
$state = [pscustomobject]@{
    PreviousCommit = (& git -C $appRoot rev-parse HEAD).Trim()
    ReleaseCommit = $ExpectedCommit
    EmailEnabled = (Get-ScheduledTask -TaskName $emailTask).Settings.Enabled
    Files = $entries
}
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $BackupDirectory 'state.json') -Encoding UTF8
Copy-File $PSCommandPath (Join-Path $BackupDirectory 'deploy-hp-prodesk.ps1')
'& "$PSScriptRoot\deploy-hp-prodesk.ps1" -Rollback -BackupDirectory $PSScriptRoot' | Set-Content -LiteralPath (Join-Path $BackupDirectory 'rollback.ps1') -Encoding UTF8

$cutoverStarted = $false
try {
    Disable-ScheduledTask -TaskName $emailTask | Out-Null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ((Get-ScheduledTask -TaskName $emailTask).State -ne 'Running') { break }
        Start-Sleep -Seconds 1
    }
    if ((Get-ScheduledTask -TaskName $emailTask).State -eq 'Running') { throw 'Email retry is still running; cutover deferred' }
    Stop-Web
    $cutoverStarted = $true
    Copy-File (Join-Path $appRoot '.env.local') (Join-Path $BackupDirectory 'private\.env.local')
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $appRoot 'prisma') -Filter 'dev.db*' -File) {
        Copy-File $file.FullName (Join-Path $BackupDirectory ('private\' + $file.Name))
    }
    foreach ($folder in @('.next', 'node_modules')) {
        $current = Assert-ChildPath (Join-Path $appRoot $folder) $appRoot
        $candidate = Assert-ChildPath (Join-Path $ReleaseDirectory $folder) $releaseRoot
        Move-Item -LiteralPath $current -Destination (Join-Path $BackupDirectory $folder)
        Move-Item -LiteralPath $candidate -Destination $current
    }
    foreach ($relative in $newFiles) { Copy-File (Source-Path $ReleaseDirectory $relative) (Source-Path $appRoot $relative) }
    foreach ($relative in $oldFiles) {
        if ($relative -notin $newFiles) {
            $obsolete = Source-Path $appRoot $relative
            if (Test-Path -LiteralPath $obsolete -PathType Leaf) { Remove-Item -LiteralPath $obsolete -Force }
        }
    }
    & git -C $appRoot reset --mixed $ExpectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Could not update deployed Git index' }
    Start-ScheduledTask -TaskName $webTask
    Test-Web
    if ($state.EmailEnabled) { Enable-ScheduledTask -TaskName $emailTask | Out-Null }
    [pscustomobject]@{ Commit=$ExpectedCommit; DeployedAt=(Get-Date).ToString('o'); Backup=$BackupDirectory } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'data\deployed-release.json') -Encoding UTF8
    Write-Output "Deployment healthy. Commit: $ExpectedCommit; rollback: $BackupDirectory\rollback.ps1"
} catch {
    $failure = $_
    if ($cutoverStarted) { Restore-Release $BackupDirectory }
    elseif ($state.EmailEnabled) { Enable-ScheduledTask -TaskName $emailTask | Out-Null }
    throw $failure
}
