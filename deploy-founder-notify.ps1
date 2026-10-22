# نشر دالة إشعارات المؤسس — MISAR SYSTEMS
#
# الاستخدام:
#   1) شغّل مرة واحدة:   .\deploy-founder-notify.ps1 -Login
#   2) ثم للنشر:          .\deploy-founder-notify.ps1
#
# لن يطبع التوكن أو أي سر. لن يرسل أي رسالة واتساب.

param(
    [switch]$Login,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRef = 'wwojtkxwmgkrudtevbcb'
$FunctionName = 'misar-founder-notify'
$Root = $PSScriptRoot

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Bad($msg)  { Write-Host "   !!  $msg" -ForegroundColor Red }

# --- 1) إيجاد Supabase CLI ---
function Resolve-SupabaseCli {
    $candidates = @(
        (Join-Path $env:TEMP 'supabase-cli\supabase.exe'),
        (Get-Command supabase -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        (Join-Path $env:APPDATA 'npm\supabase.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Programs\supabase\supabase.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

Write-Step "البحث عن Supabase CLI"
$cli = Resolve-SupabaseCli
if (-not $cli) {
    Write-Bad "لم يُعثر على Supabase CLI."
    Write-Host @"

ثبّته بأحد الطريقتين:

  أ) عبر npm (يتطلب Node.js رسمياً):
     npm install -g supabase

  ب) ثنائي مستقل:
     https://github.com/supabase/cli/releases

"@ -ForegroundColor Yellow
    exit 1
}
Write-Ok "الـ CLI: $cli"

# --- 2) التحقق من وجود الدالة محلياً ---
Write-Step "التحقق من ملفات الدالة"
$entry = Join-Path $Root "supabase\functions\$FunctionName\index.ts"
if (-not (Test-Path $entry)) {
    Write-Bad "ملف الدالة غير موجود: $entry"
    exit 1
}
Write-Ok "index.ts موجود"

$dangerousJwt = Select-String -Path $entry -Pattern 'functions deploy[^\r\n]*--no-verify-jwt' -Quiet
if ($dangerousJwt) {
    Write-Bad "الملف يحتوي على أمر نشر يعطّل JWT — أصلحه قبل النشر."
    exit 1
}
Write-Ok "لا يوجد تعطيل لتحقق JWT"

# --- 3) وضع التحقق فقط ---
if ($VerifyOnly) {
    Write-Step "فحص الاستجابة الحالية للدالة"
    $body = '{"event_type":"critical_error","event_key":"verify_probe"}'
    try {
        $r = Invoke-WebRequest -Uri "https://$ProjectRef.supabase.co/functions/v1/$FunctionName" `
            -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 20
        Write-Ok "HTTP $($r.StatusCode) — الدالة منشورة وردّت:"
        Write-Host "   $($r.Content)" -ForegroundColor Gray
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        switch ($code) {
            404 { Write-Bad "HTTP 404 — الدالة غير منشورة بعد." }
            401 { Write-Ok "HTTP 401 — الدالة منشورة وتعمل، ورفضت طلباً بلا هوية (سلوك صحيح)." }
            default { Write-Bad "HTTP $code — $($_.Exception.Message)" }
        }
    }
    exit 0
}

# --- 4) تسجيل الدخول ---
# ملاحظة: نجاح `supabase login` وحده لا يعني نجاح النشر. إن لم يوجد توكن
# فسيخرج الأمر برسالة "Access token not provided" دون إنشاء الدالة إطلاقاً،
# وتظل المناداة تُرجع 404 — وهذا هو أكثر سبب شائع للخطأ "نشرتها وما زالت 404".
if ($Login) {
    Write-Step "تسجيل الدخول إلى Supabase"
    Write-Host "   سيفتح المتصفح. اختر حسابك. لن يظهر التوكن هنا." -ForegroundColor Gray
    & $cli login
    Write-Ok "انتهى تسجيل الدخول"
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    $authFile = Join-Path $env:USERPROFILE '.supabase\access-token'
    if (-not (Test-Path $authFile)) {
        Write-Bad "لا يوجد تسجيل دخول فعّال لـ Supabase CLI — النشر سيفشل ولن تُنشأ الدالة."
        Write-Host @"

الحل:
  .\deploy-founder-notify.ps1 -Login

أو ضع توكن وصول شخصياً (مرة واحدة في الجلسة):
  $env:SUPABASE_ACCESS_TOKEN = '<token>'
  أنشئه من: https://supabase.com/dashboard/account/tokens

"@ -ForegroundColor Yellow
        exit 1
    }
}

# --- 5) النشر ---
Write-Step "نشر $FunctionName على المشروع $ProjectRef"
Write-Host "   (باستخدام --use-api لأن Docker غير مطلوب) `n" -ForegroundColor Gray

Push-Location $Root
try {
    $deployOut = (& $cli functions deploy $FunctionName --project-ref $ProjectRef --use-api 2>&1 | Out-String)
    $exit = $LASTEXITCODE
} finally {
    Pop-Location
}
$deployOut -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }

if ($exit -ne 0) {
    if ($deployOut -match 'Access token not provided') {
        Write-Bad "النشر لم يبدأ أصلاً: لا يوجد تسجيل دخول. شغّل .\deploy-founder-notify.ps1 -Login ثم أعد المحاولة."
        exit 1
    }
    if ($deployOut -match 'Docker') {
        Write-Bad "Docker مطلوب: تأكد من وجود --use-api في الأمر (موجود في هذا السكربت)."
    }
    Write-Bad "فشل النشر (رمز $exit)"
    Write-Host "`n--- مخرجات CLI ---`n$deployOut" -ForegroundColor DarkGray
    Write-Host @"

أسباب شائعة:
  • لم تسجّل الدخول:            & "$cli" login
  • لا تملك صلاحية على المشروع: تأكد من الحساب الصحيح
  • التوكن غير صالح:            أنشئ توكن جديداً من
    https://supabase.com/dashboard/account/tokens

"@ -ForegroundColor Yellow
    exit $exit
}
Write-Ok "تم النشر"

# --- 6) التحقق بعد النشر ---
Write-Step "التحقق من الاستجابة"
$body = '{"event_type":"critical_error","event_key":"verify_probe"}'
try {
    $r = Invoke-WebRequest -Uri "https://$ProjectRef.supabase.co/functions/v1/$FunctionName" `
        -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 25
    Write-Ok "HTTP $($r.StatusCode)"
    Write-Host "   $($r.Content)" -ForegroundColor Gray
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) {
        Write-Ok "HTTP 401 — الدالة منشورة وتعمل. رفض الطلب بلا هوية = سلوك صحيح ومطلوب."
        Write-Host "`nاختبرها الآن من لوحة المؤسس بحساب مؤسس مسجّل." -ForegroundColor Green
    } elseif ($code -eq 404) {
        Write-Bad "لا تزال 404 — تأكد من نجاح النشر (قد ينشر الدالة تحت اسم مختلف)."
    } else {
        Write-Bad "HTTP $code — $($_.Exception.Message)"
    }
}

Write-Host @"

الخطوات المتبقية (مرة واحدة):
  1) اضبط أسرار واتساب في لوحة Supabase:
     Project Settings -> Edge Functions -> Secrets
       WHATSAPP_PHONE_NUMBER_ID
       WHATSAPP_ACCESS_TOKEN
       OWNER_WHATSAPP_NUMBER
  2) نفّذ FOUNDER_CONTROL_CENTER.sql في SQL Editor
  3) اختبر زر "اختبار الربط" من لوحة المؤسس بحساب مؤسس

"@ -ForegroundColor Cyan
