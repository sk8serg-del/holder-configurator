# deploy.ps1 - prepare for GitHub Pages publish without manual cache clearing.
#
# 1) stamps a cache version ?v=<timestamp> onto the css/js includes in index.html
#    (on a normal reload the browser sees a new URL and fetches fresh files);
# 2) rebuilds the single-file dist/holder-configurator.html (inline css+js),
#    ignoring ?v=..., in the same order as tools/build-single-file.js.
#
# Run:   powershell -File tools/deploy.ps1
# Then:  git add -A; git commit -m "..."; git push   (Pages updates in ~1 min)
#
# NOTE: the claude.ai artifact file (head+body without the outer wrapper) is
# built separately - this script does not touch it.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so Cyrillic
# comments would break parsing.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot            # project root (.../holder-configurator)
$ver  = Get-Date -Format "yyyyMMddHHmm"
$utf8 = New-Object System.Text.UTF8Encoding($false)

$scripts = @("catalog","i18n","geometry","packer","render","export-csv","step-export","step-import","blank-storage","report",
             "sheets","viewer3d","holder-import","blank-builder","app")

# --- 1) cache versions on index.html assets ---
$idxPath = Join-Path $root "index.html"
$idx = Get-Content -Raw -Encoding UTF8 $idxPath
$idx = [regex]::Replace($idx, 'href="css/style\.css(\?v=\d+)?"', 'href="css/style.css?v=' + $ver + '"')
$idx = [regex]::Replace($idx, 'src="js/([^"?]+)\.js(\?v=\d+)?"', { param($m) 'src="js/' + $m.Groups[1].Value + '.js?v=' + $ver + '"' })
[System.IO.File]::WriteAllText($idxPath, $idx, $utf8)

# --- 2) build single file (inline; ignore ?v=...) ---
$html = $idx
$css = Get-Content -Raw -Encoding UTF8 (Join-Path $root "css/style.css")
$html = [regex]::Replace($html, '<link rel="stylesheet" href="css/style\.css(\?v=\d+)?">', { param($m) "<style>`n$css`n</style>" })

# Three.js grузится динамически (createElement, см. index.html) - ссылка на
# js/vendor/three.min.js внутри inline-скрипта не найдёт файл в собранном
# HTML (нет соседней папки js/), поэтому инлайним его как data:-URI прямо в
# s.src, как и в tools/build-single-file.js.
$threeJs = Get-Content -Raw -Encoding UTF8 (Join-Path $root "js/vendor/three.min.js")
$threeB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($threeJs))
$html = [regex]::Replace($html, 's\.src = "js/vendor/three\.min\.js(\?v=\d+)?";', 's.src = "data:text/javascript;base64,' + $threeB64 + '";')

foreach ($name in $scripts) {
  $js = Get-Content -Raw -Encoding UTF8 (Join-Path $root ("js/" + $name + ".js"))
  $pat = '<script src="js/' + [regex]::Escape($name) + '\.js(\?v=\d+)?"></script>'
  $html = [regex]::Replace($html, $pat, { param($m) "<script>`n$js`n</script>" })
}
if ($html -match '<script src="js/') { throw "Not all <script> tags inlined - check the scripts list." }
[System.IO.File]::WriteAllText((Join-Path $root "dist/holder-configurator.html"), $html, $utf8)

"deploy.ps1: version $ver; dist $($html.Length) bytes"
