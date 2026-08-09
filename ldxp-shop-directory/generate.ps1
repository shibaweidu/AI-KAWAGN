$ErrorActionPreference = "Stop"

$outputDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$snapshotPath = Join-Path $outputDir "data.public.json"
$syncScript = Join-Path $outputDir "sync.mjs"

& node $syncScript "--file=$snapshotPath"
if ($LASTEXITCODE -ne 0) { throw "LDXP snapshot refresh failed with exit code $LASTEXITCODE" }
$dataset = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
$groups = $dataset.items | Where-Object {
    $_.source_site -eq "ldxp" -and $_.shop_link -and $_.shop
} | Group-Object shop_link

$shops = foreach ($group in $groups) {
    $items = @($group.Group)
    $prices = @($items | ForEach-Object { [double]$_.price } | Where-Object { $_ -ge 0 })
    $categories = @($items | Where-Object { $_.category } | Group-Object category | Sort-Object @{ Expression = "Count"; Descending = $true }, Name | ForEach-Object { $_.Name })
    $samples = @($items.name | Where-Object { $_ } | Select-Object -Unique -First 3)
    $lastSeen = @($items.last_seen_at | Where-Object { $_ } | Sort-Object { [datetime]$_ } -Descending | Select-Object -First 1)
    $lastSeenIso = if ($lastSeen.Count) {
        ([datetime]$lastSeen[0]).ToString("o")
    } else {
        $null
    }

    [pscustomobject][ordered]@{
        name = [string]$items[0].shop
        url = [string]$group.Name
        productCount = $items.Count
        stock = [int](($items | Measure-Object -Property stock -Sum).Sum)
        minPrice = if ($prices.Count) { [double](($prices | Measure-Object -Minimum).Minimum) } else { $null }
        maxPrice = if ($prices.Count) { [double](($prices | Measure-Object -Maximum).Maximum) } else { $null }
        lastSeen = $lastSeenIso
        categories = $categories
        sampleProducts = $samples
        searchText = ((@($items[0].shop) + $categories + $samples) -join " ").ToLowerInvariant()
    }
}

$shops = @($shops | Sort-Object @{ Expression = "productCount"; Descending = $true }, name)
$meta = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    sourcePublishedAt = [string]$dataset.published_at
    productCount = @($dataset.items | Where-Object { $_.source_site -eq "ldxp" }).Count
    shopCount = $shops.Count
    source = "https://pay.ldxp.cn"
    coverage = "公开在售商品对应店铺"
}

$shopsJson = $shops | ConvertTo-Json -Depth 8 -Compress
$metaJson = $meta | ConvertTo-Json -Depth 4 -Compress
$javascript = "window.SHOPS=$shopsJson;`nwindow.SHOP_DIRECTORY_META=$metaJson;`n"

Set-Content -LiteralPath (Join-Path $outputDir "shops.js") -Value $javascript -Encoding utf8
$shops | Select-Object name, url, productCount, stock, minPrice, maxPrice, lastSeen, @{Name="categories";Expression={$_.categories -join " | "}} |
    Export-Csv -LiteralPath (Join-Path $outputDir "shops.csv") -NoTypeInformation -Encoding utf8

Write-Output "Generated $($shops.Count) shops from $($meta.productCount) public product records."
