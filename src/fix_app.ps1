$file = "C:\Users\Bhav\OneDrive - Building Theory\Documents\website\hollowcore-calculator\src\App.jsx"
$content = Get-Content $file -Raw

# Fix all chained const useState declarations
$content = $content -replace 'const \[b,setB\]=useState\(12\),\[h,setH\]=useState\(20\);', "const [b,setB]=useState(12);`r`n  const [h,setH]=useState(20);"
$content = $content -replace 'const \[fc,setFc\]=useState\(4\),\[cov,setCov\]=useState\(1\.5\);', "const [fc,setFc]=useState(4);`r`n  const [cov,setCov]=useState(1.5);"
$content = $content -replace 'const \[bBar,setBBar\]=useState\("#9"\),\[bQ,setBQ\]=useState\(2\);', "const [bBar,setBBar]=useState(`"#9`");`r`n  const [bQ,setBQ]=useState(2);"
$content = $content -replace 'const \[tBar,setTBar\]=useState\("#9"\),\[tQ,setTQ\]=useState\(2\);', "const [tBar,setTBar]=useState(`"#9`");`r`n  const [tQ,setTQ]=useState(2);"
$content = $content -replace 'const \[cover,setCover\]=useState\(38\),\[stH,setStH\]=useState\(45\);', "const [cover,setCover]=useState(38);`r`n  const [stH,setStH]=useState(45);"
$content = $content -replace 'const \[fc,setFc\]=useState\(60\),\[fci,setFci\]=useState\(28\),\[ag,setAg\]=useState\(20\);', "const [fc,setFc]=useState(60);`r`n  const [fci,setFci]=useState(28);`r`n  const [ag,setAg]=useState(20);"
$content = $content -replace 'const \[nH,setNH\]=useState\(5\),\[nS,setNS\]=useState\(0\);', "const [nH,setNH]=useState(5);`r`n  const [nS,setNS]=useState(0);"
$content = $content -replace 'const \[spanM,setSpanM\]=useState\(6\),\[sdl,setSdl\]=useState\(0\),\[ll,setLl\]=useState\(0\),\[sl,setSl\]=useState\(0\);', "const [spanM,setSpanM]=useState(6);`r`n  const [sdl,setSdl]=useState(0);`r`n  const [ll,setLl]=useState(0);`r`n  const [sl,setSl]=useState(0);"
$content = $content -replace 'const \[w,setW\]=useState\(50\),\[fc,setFc\]=useState\(48\),\[ecc,setEcc\]=useState\(0\),\[hB,setHB\]=useState\(200\);', "const [w,setW]=useState(50);`r`n  const [fc,setFc]=useState(48);`r`n  const [ecc,setEcc]=useState(0);`r`n  const [hB,setHB]=useState(200);"

# Also fix the literal backtick-n from previous attempt
$content = $content -replace 'useState\(12\);`n  const \[h,setH\]', "useState(12);`r`n  const [h,setH]"

Set-Content $file $content -NoNewline
Write-Host "Done. Pushing to GitHub..."

cd "C:\Users\Bhav\OneDrive - Building Theory\Documents\website\hollowcore-calculator"
git add src/App.jsx
git commit -m "Fix all chained const useState declarations"
git push
Write-Host "Pushed! Vercel will deploy in ~90 seconds."
