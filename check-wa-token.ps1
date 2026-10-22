# فحص صلاحية توكن واتساب — MISAR SYSTEMS
# الاستخدام: .\check-wa-token.ps1
# يقرأ الأسرار من Supabase (لا يحتوي أي سر داخل الملف).

$ErrorActionPreference = 'Stop'
$ProjectRef = 'wwojtkxwmgkrudtevbcb'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "`n== 1) قراءة الأسرار من Supabase ==" -ForegroundColor Cyan
$cli = (Get-Command supabase -ErrorAction SilentlyContinue)
if (-not $cli) { Write-Host "supabase CLI غير موجود" -ForegroundColor Red; exit 1 }

# ملاحظة: supabase secrets list يعرض البصمة (digest) فقط، لا القيم.
# لا يمكن قراءة القيم من الـ CLI — القيم موجودة عند Meta وفي اللوحة فقط.
supabase secrets list --project-ref $ProjectRef 2>&1 |
    Select-String -Pattern 'WHATSAPP_' |
    ForEach-Object { Write-Host "   $($_.Line.Trim())" }

Write-Host "`n== 2) فحص التوكن مباشرة عند Meta ==" -ForegroundColor Cyan
Write-Host "   أدخل التوكن (لن يظهر على الشاشة، ولن يُكتب في أي ملف):" -ForegroundColor Yellow
$secure = Read-Host -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if (-not $token) { Write-Host "لم تُدخل توكن" -ForegroundColor Red; exit 1 }

# debug_token: يخبرنا هل التوكن صالح، نوعه، وتاريخ انتهائه
$appId = 'xcmfzqifomtddbvzcptk'
$url = "https://graph.facebook.com/v21.0/debug_token?input_token=$token&access_token=$appId|$token"

try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 25
    $j = $r.Content | ConvertFrom-Json
    $d = $j.data
    Write-Host "`n   is_valid        : $($d.is_valid)" -ForegroundColor $(if ($d.is_valid) { 'Green' } else { 'Red' })
    Write-Host "   type            : $($d.type)"
    Write-Host "   application     : $($d.application)"
    Write-Host "   expires_at      : $($d.expires_at)"
    Write-Host "   data_access_expires_at: $($d.data_access_expires_at)"
    Write-Host "   scopes          : $($d.scopes -join ', ')"
    if ($d.error) { Write-Host "   error           : $($d.error.message)" -ForegroundColor Red }
} catch {
    Write-Host "   فشل الفحص: $($_.Exception.Message)" -ForegroundColor Red
}
