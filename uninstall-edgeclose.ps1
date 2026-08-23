$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:ProgramData 'EdgeClose'
$policyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'

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
            if ($value -match '^[a-p]{32};' -and $value -match 'edge\.microsoft\.com/extensionwebstorebase') {
                Remove-ItemProperty -Path $policyPath -Name $property.Name -Force
                $removedPolicies++
            }
        }
        if ($removedPolicies -gt 0 -and -not (Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue).PSObject.Properties.Where({ $_.Name -notlike 'PS*' })) {
            Remove-Item -Path $policyPath -Force
        }
    }

    if (Test-Path $installRoot) {
        Remove-Item -Path $installRoot -Recurse -Force
    }

    $downloadedInstaller = Join-Path $env:TEMP 'EdgeClose-*'
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
