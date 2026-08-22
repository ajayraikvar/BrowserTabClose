$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$stageRoot = Join-Path $env:TEMP "EdgeClose-pack-$([guid]::NewGuid().ToString('N'))"
$outputRoot = Join-Path $projectRoot 'dist'
$stageExtension = Join-Path $stageRoot 'extension'
$edgePaths = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
)
$edgePath = $edgePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

try {
    if (-not $edgePath) { throw 'Microsoft Edge was not found.' }
    $manifest = Get-Content (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.name -ne 'EdgeClose') { throw 'manifest.json is not an EdgeClose manifest.' }

    New-Item -ItemType Directory -Path $stageExtension -Force | Out-Null
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    $files = @('manifest.json', 'background.js', 'content.js', 'content.css', 'options.html', 'options.css', 'options.js')
    foreach ($file in $files) {
        Copy-Item (Join-Path $projectRoot $file) (Join-Path $stageExtension $file) -Force
    }

    $keyPath = Join-Path $outputRoot 'edgeclose.pem'
    $arguments = "--pack-extension=$stageExtension"
    if (Test-Path $keyPath) { $arguments += " --pack-extension-key=$keyPath" }
    Write-Host "Packing EdgeClose $($manifest.version)..."
    $process = Start-Process -FilePath $edgePath -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'Edge failed to pack the extension.' }

    $packedPath = "$stageExtension.crx"
    if (-not (Test-Path $packedPath)) { throw 'Edge did not create a CRX package.' }
    Move-Item $packedPath (Join-Path $outputRoot "EdgeClose-$($manifest.version).crx") -Force
    $generatedKey = "$stageExtension.pem"
    if (Test-Path $generatedKey) { Move-Item $generatedKey $keyPath -Force }

    Write-Host "Created: $outputRoot\EdgeClose-$($manifest.version).crx"
    Write-Host "Signing key: $keyPath"
    Write-Host 'Keep the PEM signing key private. Do not upload it to GitHub.'
}
finally {
    if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
