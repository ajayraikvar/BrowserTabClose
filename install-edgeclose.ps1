$ErrorActionPreference = 'Stop'
$repository = 'ajayraikvar/BrowserTabClose'
$installRoot = Join-Path $env:ProgramData 'EdgeClose'
$tempRoot = Join-Path $env:TEMP "EdgeClose-$([guid]::NewGuid().ToString('N'))"
$zipPath = Join-Path $tempRoot 'edgeclose.zip'
$extractRoot = Join-Path $tempRoot 'extracted'

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run install-edgeclose.bat as administrator.'
    }

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $downloadUrl = "https://github.com/$repository/archive/refs/heads/main.zip"
    Write-Host 'Downloading the latest EdgeClose build...'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

    Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
    $sourceRoot = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
    $manifestPath = Join-Path $sourceRoot.FullName 'manifest.json'
    if (-not (Test-Path $manifestPath)) {
        throw 'Downloaded archive does not contain a valid extension manifest.'
    }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.name -ne 'EdgeClose') {
        throw 'Downloaded package is not EdgeClose.'
    }

    if (Test-Path $installRoot) {
        Remove-Item $installRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceRoot.FullName '*') -Destination $installRoot -Recurse -Force

    Write-Host "EdgeClose $($manifest.version) files downloaded to: $installRoot"
    Write-Host ''
    Write-Host 'In Edge: enable Developer mode, choose Load unpacked, and select:'
    Write-Host $installRoot
    Write-Host ''
    Write-Host 'Important: this is not a silent browser installation.'
    Write-Host 'Edge requires the manual Load unpacked action for this development build.'
    try {
        Set-Clipboard -Value $installRoot
        Write-Host 'The install folder path has been copied to the clipboard.'
    }
    catch {
        Write-Host 'Clipboard copy was unavailable; use the path printed above.'
    }
    Start-Process explorer.exe -ArgumentList "/select,`"$installRoot`""
    Start-Process 'msedge.exe' -ArgumentList 'edge://extensions'
    Write-Host ''
    Write-Host 'FINAL STEP IN EDGE:'
    Write-Host '1. Enable Developer mode.'
    Write-Host '2. Select Load unpacked.'
    Write-Host "3. Select $installRoot"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
