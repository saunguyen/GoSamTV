# Publish the web build to the gh-pages branch.
# Adds a ?v=<version> query to CSS/JS so browsers pick up new data immediately
# instead of serving a cached channels.js for up to 10 minutes.
#
#   pwsh -File scripts\deploy-web.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$tmp = Join-Path $env:TEMP ('gosamtv-web-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

# version comes from tools/build_wgt.py so the web and the package always match
$version = (Select-String -Path (Join-Path $root 'tools\build_wgt.py') -Pattern 'VERSION = "([^"]+)"').Matches[0].Groups[1].Value
Write-Host "publishing version $version"

New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item (Join-Path $app '*') $tmp -Recurse -Force
New-Item -ItemType File -Path (Join-Path $tmp '.nojekyll') -Force | Out-Null

# cache busting for the static assets
$index = Join-Path $tmp 'index.html'
$html = [System.IO.File]::ReadAllText($index)
foreach ($file in 'css/app.css', 'data/channels.js', 'data/epg-map.js', 'data/news.js', 'js/app.js') {
    $html = $html.Replace('"' + $file + '"', '"' + $file + '?v=' + $version + '"')
}
[System.IO.File]::WriteAllText($index, $html, (New-Object System.Text.UTF8Encoding($false)))

Push-Location $tmp
try {
    git init -q
    git add -A
    git -c user.name='Sau Nguyen' -c user.email='97537182+saunguyen@users.noreply.github.com' `
        commit -q -m "web: GoSamTV $version"
    git push --force https://github.com/saunguyen/GoSamTV.git HEAD:gh-pages
}
finally {
    Pop-Location
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "done - https://saunguyen.github.io/GoSamTV/"
