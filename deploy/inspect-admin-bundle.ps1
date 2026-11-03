$ErrorActionPreference = "Stop"
$out = Join-Path $env:TEMP "admin-index.js"
curl.exe -s "https://frontier.geekpark.net/frontier/admin/assets/index-DV0_ulxH.js" -o $out
Write-Host "size=" (Get-Item $out).Length
$c = [IO.File]::ReadAllText($out)
Write-Host "==== first 300 ===="
Write-Host $c.Substring(0, [Math]::Min(300, $c.Length))
Write-Host "==== tail 700 ===="
Write-Host $c.Substring([Math]::Max(0, $c.Length - 700))
Write-Host "==== local index ===="
Get-Content "C:\Users\86152\Desktop\小程序----前沿社\admin\dist\index.html"
Write-Host "==== local env keys only ===="
Get-ChildItem "C:\Users\86152\Desktop\小程序----前沿社\admin" -Filter ".env*" | ForEach-Object {
  Write-Host ("file=" + $_.Name)
  Get-Content $_.FullName | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $k = ($_ -split '=', 2)[0]
    Write-Host ("key=" + $k)
  }
}
