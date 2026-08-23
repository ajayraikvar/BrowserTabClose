param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
$ExtensionId = $ExtensionId.Trim()
$installRoot = Join-Path $env:ProgramData 'EdgeClose'
$policyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'
$backupPath = Join-Path $installRoot 'policy-value-backup.txt'

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run uninstall-edgeclose.bat as administrator.'
    }

    $removedPolicies = 0
    if (Test-Path $policyPath) {
        $policy = Get-ItemProperty -Path $policyPath
        foreach ($property in $policy.PSObject.Properties) {
            if ($property.Name -like 'PS*') { continue }
            $value = [string]$property.Value
            if ($value -like "$ExtensionId;*") {
                Remove-ItemProperty -Path $policyPath -Name $property.Name -Force
                $removedPolicies++
            }
        }
        if (Test-Path $backupPath) {
            $backupLine = Get-Content $backupPath | Where-Object { $_ -match '\s+1\s+REG_SZ\s+(.+)$' } | Select-Object -First 1
            if ($backupLine -and $backupLine -match '\s+1\s+REG_SZ\s+(.+)$') {
                reg add 'HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist' /v 1 /t REG_SZ /d $Matches[1].Trim() /f | Out-Null
            }
        }
    }

    if (Test-Path $installRoot) {
        Remove-Item -Path $installRoot -Recurse -Force
    }

    Get-ChildItem -Path $env:TEMP -Filter 'EdgeClose-*' -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "Removed EdgeClose files from $installRoot"
    Write-Host "Removed $removedPolicies administrator policy entr$(if ($removedPolicies -eq 1) { 'y' } else { 'ies' })"
    Write-Host 'If EdgeClose was loaded unpacked, open edge://extensions and select Remove once.'
    Start-Process 'msedge.exe' -ArgumentList 'edge://extensions'
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
