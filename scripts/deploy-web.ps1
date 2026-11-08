# Safe deployment: update /lite/ only; preserve existing gh-pages root.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$tmp = Join-Path $env:TEMP ('gosamtv-lite-pages-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$version = (Select-String -Path (Join-Path $root 'tools\build_wgt.py') -Pattern 'VERSION = "([^"]+)"').Matches[0].Groups[1].Value
try {
    git clone --depth 1 --branch gh-pages https://github.com/saunguyen/GoSamTV.git $tmp
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone gh-pages' }
    $dest = Join-Path $tmp 'lite'
    foreach ($dir in 'css', 'js', 'data', 'vendor', 'img') {
        New-Item -ItemType Directory -Path (Join-Path $dest $dir) -Force | Out-Null
    }
    Copy-Item (Join-Path $app 'lite.html') (Join-Path $dest 'index.html') -Force
    Copy-Item (Join-Path $app 'css/lite.css') (Join-Path $dest 'css/lite.css') -Force
    Copy-Item (Join-Path $app 'js/lite.js') (Join-Path $dest 'js/lite.js') -Force
    Copy-Item (Join-Path $app 'vendor/hls.min.js') (Join-Path $dest 'vendor/hls.min.js') -Force
    Copy-Item (Join-Path $app 'data/lite-meta.js') (Join-Path $dest 'data/lite-meta.js') -Force
    Copy-Item (Join-Path $app 'data/lite-default-channels.js') (Join-Path $dest 'data/lite-default-channels.js') -Force
    Copy-Item (Join-Path $app 'data/launchpad-extra-channels.js') (Join-Path $dest 'data/launchpad-extra-channels.js') -Force
    Copy-Item (Join-Path $app 'img/icon.png') (Join-Path $dest 'img/icon.png') -Force
    Copy-Item (Join-Path $app 'img/lite-logos') (Join-Path $dest 'img/lite-logos') -Recurse -Force
    $index = Join-Path $dest 'index.html'
    $html = [System.IO.File]::ReadAllText($index)
    foreach ($file in 'css/lite.css', 'data/lite-meta.js', 'data/lite-default-channels.js', 'js/lite.js', 'vendor/hls.min.js') {
        $html = $html.Replace('"' + $file + '"', '"' + $file + '?v=' + $version + '"')
    }
    [System.IO.File]::WriteAllText($index, $html, (New-Object System.Text.UTF8Encoding($false)))
    Push-Location $tmp
    try {
        git add -- lite/
        if ($LASTEXITCODE -ne 0) { throw 'git add failed' }
        git diff --cached --quiet
        if ($LASTEXITCODE -ne 0) {
            git -c user.name='Sau Nguyen' -c user.email='97537182+saunguyen@users.noreply.github.com' commit -m "web: update GoSamTV Lite $version"
            if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
            git push origin gh-pages
            if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
        }
    }
    finally { Pop-Location }
}
finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host 'Done: https://saunguyen.github.io/GoSamTV/lite/'
