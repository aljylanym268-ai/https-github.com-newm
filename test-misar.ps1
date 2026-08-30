$body = '{"messages":[{"role":"user","content":"say hi in arabic"}]}'
try {
  $resp = Invoke-WebRequest -Uri 'https://wwojtkxwmgkrudtevbcb.supabase.co/functions/v1/misar-ai' -Method Post -ContentType 'application/json' -Headers @{ Authorization = 'Bearer sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr'; apikey = 'sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr' } -Body $body -UseBasicParsing
  Write-Output $resp.StatusCode
  Write-Output $resp.Content
} catch {
  Write-Output ("ERROR: " + $_.Exception.Message)
  if ($_.ErrorDetails.Message) { Write-Output $_.ErrorDetails.Message }
}
