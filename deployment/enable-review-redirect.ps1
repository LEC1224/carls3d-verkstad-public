param(
    [string]$ConfigPath = 'C:\3dproxy\web.config',
    [string]$BackupDirectory = 'C:\3dproxy\carls3d-deploy-backups'
)

$ErrorActionPreference = 'Stop'
$taskTarget = (Resolve-Path -LiteralPath $ConfigPath).Path
$taskBackupRoot = (Resolve-Path -LiteralPath $BackupDirectory).Path
$taskRedirectUrl = 'https://share.google/BoBAlmEXkc16y76rY'
$taskRuleName = 'GoogleReviewRedirect'

$taskDocument = New-Object System.Xml.XmlDocument
$taskDocument.Load($taskTarget)
$taskRules = $taskDocument.SelectSingleNode('/configuration/system.webServer/rewrite/rules')
if ($null -eq $taskRules) { throw 'The existing IIS rewrite rules could not be found.' }

$taskExisting = $taskRules.SelectSingleNode("rule[@name='$taskRuleName']")
if ($null -ne $taskExisting) {
    if ($taskExisting.match.url -eq '^review/?$' -and
        $taskExisting.action.url -eq $taskRedirectUrl -and
        $taskExisting.action.type -eq 'Redirect' -and
        $taskExisting.action.redirectType -eq 'Found' -and
        $taskExisting.action.appendQueryString -eq 'false') {
        Write-Output 'The requested review redirect is already configured.'
        exit 0
    }
    throw 'An existing review redirect has different settings; leaving it unchanged.'
}

$taskRule = $taskDocument.CreateElement('rule')
$taskRule.SetAttribute('name', $taskRuleName)
$taskRule.SetAttribute('stopProcessing', 'true')
$taskMatch = $taskDocument.CreateElement('match')
$taskMatch.SetAttribute('url', '^review/?$')
$taskMatch.SetAttribute('ignoreCase', 'true')
[void]$taskRule.AppendChild($taskMatch)
$taskAction = $taskDocument.CreateElement('action')
$taskAction.SetAttribute('type', 'Redirect')
$taskAction.SetAttribute('url', $taskRedirectUrl)
$taskAction.SetAttribute('redirectType', 'Found')
$taskAction.SetAttribute('appendQueryString', 'false')
[void]$taskRule.AppendChild($taskAction)
[void]$taskRules.PrependChild($taskRule)

$taskSuffix = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$taskBackup = Join-Path $taskBackupRoot ('web.config.before-review-' + $taskSuffix + '.bak')
$taskCandidate = Join-Path (Split-Path -Parent $taskTarget) ('web.config.review-' + $taskSuffix + '.tmp')

$taskSettings = New-Object System.Xml.XmlWriterSettings
$taskSettings.Encoding = New-Object System.Text.UTF8Encoding($false)
$taskSettings.Indent = $true
$taskSettings.IndentChars = '    '
$taskSettings.NewLineChars = "`r`n"
$taskWriter = [System.Xml.XmlWriter]::Create($taskCandidate, $taskSettings)
try { $taskDocument.Save($taskWriter) } finally { $taskWriter.Dispose() }

# Parse the complete candidate before atomically replacing the active config.
$taskValidation = New-Object System.Xml.XmlDocument
$taskValidation.Load($taskCandidate)
if ($null -eq $taskValidation.SelectSingleNode("/configuration/system.webServer/rewrite/rules/rule[@name='$taskRuleName']")) {
    throw 'The candidate redirect configuration failed validation.'
}
[System.IO.File]::Replace($taskCandidate, $taskTarget, $taskBackup)
Write-Output ('Enabled /review redirect. Original config backup: ' + $taskBackup)
