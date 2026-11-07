$env:GIT_TERMINAL_PROMPT = '0'
$env:GIT_ASKPASS = ''
Set-Location 'C:\Users\FUJITSU\OneDrive\Documents\GitHub\https-github.com-newm'
# اسحب التوكن من مخزن Windows Credential (wincred)
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize;
        public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName; }
}
"@
Add-Type -TypeDefinition $sig
$ptr = [IntPtr]::Zero
$targets = @('git:https://github.com', 'GitHub - https://api.github.com/aljylanym268-ai')
$token = $null
foreach ($t in $targets) {
    if ([CredMan]::CredRead($t, 1, 0, [ref]$ptr)) {
        $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
        if ($cred.CredentialBlobSize -gt 0) {
            $bytes = New-Object byte[] $cred.CredentialBlobSize
            [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
            $secret = [Text.Encoding]::UTF8.GetString($bytes)
            if ($secret.Length -gt 20) { $token = $secret; Write-Output "FOUND: $t (len $($secret.Length))"; break }
        }
    }
}
if (-not $token) { Write-Output 'NO_CREDENTIAL_FOUND'; exit 1 }
$user = 'aljylanym268-ai'
# لو السر PAT نضيفه مباشرة، لو OAuth أوثق تنسيق username:token
$url = "https://${user}:${token}@github.com/aljylanym268-ai/https-github.com-newm.git"
& git push $url main 2>&1 | ForEach-Object { $_ -replace [Regex]::Escape($token), '***' }
