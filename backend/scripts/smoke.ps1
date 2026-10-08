# End-to-end smoke test against a running local server.
#   powershell -File scripts/smoke.ps1
#
# Checks every screen's endpoint for every role, and asserts the blind-count rule holds: the roles that
# record physical quantities must not be able to reach sales or variance.

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8000/api'
$pass = 0; $fail = 0

function Check($label, $expected, $scriptblock) {
  try {
    $actual = & $scriptblock
    if ($actual -eq $expected) { "  OK   $label"; $script:pass++ }
    else { "  FAIL $label (expected $expected, got $actual)"; $script:fail++ }
  } catch { "  FAIL $label ($($_.Exception.Message))"; $script:fail++ }
}

function Status($uri, $headers, $method = 'GET') {
  try { (Invoke-WebRequest -Uri $uri -Headers $headers -Method $method -UseBasicParsing).StatusCode }
  catch { $_.Exception.Response.StatusCode.value__ }
}

function Login($phone, $pin) {
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType application/json `
    -Body "{""phone"":""$phone"",""pin"":""$pin""}"
}

"=== health ==="
Check 'health endpoint' 'ok' { (Invoke-RestMethod "$base/health").status }

"`n=== logins ==="
$owner = Login '9000000001' '1234'
$mgr   = Login '9000000002' '1234'
$chef  = Login '9000000003' '1234'
$staff = Login '9000000004' '1234'
$tid = $owner.tenants[0].id

$oh = @{Authorization = "Bearer $($owner.access)"}
$mh = @{Authorization = "Bearer $($mgr.access)"}
$ch = @{Authorization = "Bearer $($chef.access)"}
$sh = @{Authorization = "Bearer $($staff.access)"}

Check 'owner role'   'owner'     { $owner.tenants[0].role }
Check 'manager role' 'manager'   { $mgr.tenants[0].role }
Check 'chef role'    'head_chef' { $chef.tenants[0].role }
Check 'staff role'   'staff'     { $staff.tenants[0].role }
Check 'wrong PIN rejected' 401 {
  try { Login '9000000001' '0000' | Out-Null; 200 } catch { $_.Exception.Response.StatusCode.value__ }
}

"`n=== owner can reach everything ==="
foreach ($path in 'bootstrap','home','stock','recent','report','variance','trends','alerts','audit','access','settings') {
  Check "owner GET /$path" 200 { Status "$base/tenants/$tid/$path" $oh }
}

"`n=== blind counts: chef must not reach sales or variance ==="
Check 'chef GET /variance' 403 { Status "$base/tenants/$tid/variance" $ch }
Check 'chef GET /report'   403 { Status "$base/tenants/$tid/report" $ch }
Check 'chef GET /sales'    403 { Status "$base/tenants/$tid/sales/" $ch }
Check 'chef GET /audit'    403 { Status "$base/tenants/$tid/audit" $ch }
Check 'chef GET /access'   403 { Status "$base/tenants/$tid/access" $ch }
Check 'chef GET /stock'    200 { Status "$base/tenants/$tid/stock" $ch }
Check 'chef day view omits sales' $true {
  $day = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
  $null -eq (Invoke-RestMethod "$base/tenants/$tid/day/$day" -Headers $ch).PSObject.Properties['sales']
}
Check 'manager day view includes sales' $true {
  $day = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
  $null -ne (Invoke-RestMethod "$base/tenants/$tid/day/$day" -Headers $mh).PSObject.Properties['sales']
}

"`n=== staff is wastage-only ==="
Check 'staff GET /stock'  403 { Status "$base/tenants/$tid/stock" $sh }
Check 'staff GET /report' 403 { Status "$base/tenants/$tid/report" $sh }
Check 'staff GET /wastage' 200 { Status "$base/tenants/$tid/wastage/" $sh }

"`n=== the worked example (docs/product.md 5b) ==="
$yesterday = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$v = Invoke-RestMethod "$base/tenants/$tid/variance?start=$yesterday&end=$yesterday" -Headers $oh
$row = $v.rows | Where-Object { $_.code -eq 'CHK-BNL' }
Check 'expected 3.480'       3.48   { $row.expected }
Check 'actual_used 4.700'    4.7    { $row.actual_used }
Check 'wastage 0.300'        0.3    { $row.wastage }
Check 'unexplained 0.920'    0.92   { $row.unexplained }
Check 'unexplained % 26.44'  26.44  { $row.unexplained_pct }
Check 'unexplained Rs331.20' 331.2  { $row.unexplained_value }
Check 'coverage 100%'        100.0  { $row.coverage_pct }
Check 'status alert'         'alert' { $row.status }

"`n=== create-vs-edit split ==="
$body = @{ date = $yesterday; ingredient = (Invoke-RestMethod "$base/tenants/$tid/ingredients/" -Headers $oh).results[0].id
           qty = '0.1'; reason = 'spoilage' } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri "$base/tenants/$tid/wastage/" -Headers $sh -ContentType application/json -Body $body
Check 'staff created wastage' $true { $created.id -gt 0 }
Check 'staff cannot edit it'  403   { Status "$base/tenants/$tid/wastage/$($created.id)/" $sh 'DELETE' }
Check 'owner can delete it'   204   { Status "$base/tenants/$tid/wastage/$($created.id)/" $oh 'DELETE' }
Check 'the delete was audited' $true {
  (Invoke-RestMethod "$base/tenants/$tid/audit?action=wastage.delete" -Headers $oh).count -gt 0
}

"`n=== tenant isolation ==="
$other = (Invoke-RestMethod "$base/tenants/mine" -Headers $oh) | Where-Object { $_.id -ne $tid }
if ($other) {
  Check 'owner blocked from other tenant' 404 { Status "$base/tenants/$($other[0].id)/bootstrap" $oh }
} else { '  SKIP no second tenant visible to this owner' }
Check 'nonexistent tenant also 404' 404 { Status "$base/tenants/999999/bootstrap" $oh }

"`n=============================="
"PASS $pass   FAIL $fail"
if ($fail -gt 0) { exit 1 }
