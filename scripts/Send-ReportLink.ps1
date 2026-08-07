[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [ValidatePattern('^https://')] [string] $ReportUrl,
    [Parameter(Mandatory)] [string] $Subject,
    [Parameter(Mandatory)] [ValidatePattern('^[^@\s]+@[^@\s]+\.[^@\s]+$')] [string[]] $RecipientEmail,
    [Parameter(Mandatory)] [string] $AllowedHost,
    [string] $FromEmail,
    [string] $FromName = 'Informes DGMESNIE',
    [string] $SendGridApiKeyFile,
    [string] $ReceiptPath,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$uri = [Uri] $ReportUrl
if ($uri.Scheme -ne 'https' -or $uri.Host -ne $AllowedHost) {
    throw 'La URL debe usar HTTPS y coincidir exactamente con AllowedHost.'
}
if ($uri.AbsolutePath -notmatch '^/informes/[a-z0-9-]+/versiones/\d{4}-\d{2}-\d{2}-v[0-9A-Za-z.-]+/$') {
    throw 'El correo sólo acepta una URL versionada e inmutable.'
}

$idempotencyMaterial = "$Subject|$ReportUrl|$($RecipientEmail -join ',')"
$sha = [System.Security.Cryptography.SHA256]::Create()
$idempotencyKey = [Convert]::ToHexString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($idempotencyMaterial))).ToLowerInvariant()
$payload = @{
    personalizations = @(@{ to = @($RecipientEmail | ForEach-Object { @{ email = $_ } }); custom_args = @{ publication_id = $idempotencyKey } })
    from = @{ email = $FromEmail; name = $FromName }
    subject = $Subject
    content = @(@{ type = 'text/html'; value = "<p>La edición está disponible en el portal de Informes.</p><p><a href=`"$ReportUrl`">Consultar informe</a></p><p>Enlace permanente de esta edición: $ReportUrl</p>" })
}

if ($DryRun) {
    [pscustomobject]@{ status = 'dry-run'; host = $uri.Host; path = $uri.AbsolutePath; recipients = $RecipientEmail.Count; idempotency_key = $idempotencyKey; has_attachments = $payload.ContainsKey('attachments') }
    return
}
if (-not $FromEmail -or -not $SendGridApiKeyFile -or -not $ReceiptPath) {
    throw 'El envío real requiere FromEmail, SendGridApiKeyFile y ReceiptPath.'
}
if (Test-Path -LiteralPath $ReceiptPath) {
    $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
    if ($receipt.idempotency_key -eq $idempotencyKey) { throw 'Envío bloqueado: ya existe un recibo con la misma clave de idempotencia.' }
}
$secureKey = Get-Content -LiteralPath $SendGridApiKeyFile -Raw | ConvertTo-SecureString
$credential = [pscredential]::new('apikey', $secureKey)
$apiKey = $credential.GetNetworkCredential().Password
if (-not $PSCmdlet.ShouldProcess(($RecipientEmail -join ', '), "Enviar enlace $ReportUrl")) { return }
$response = Invoke-WebRequest -Method Post -Uri 'https://api.sendgrid.com/v3/mail/send' -Headers @{ Authorization = "Bearer $apiKey" } -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8)
if ($response.StatusCode -ne 202) { throw "SendGrid devolvió HTTP $($response.StatusCode)." }
$receiptDirectory = Split-Path -Parent $ReceiptPath
if ($receiptDirectory -and -not (Test-Path -LiteralPath $receiptDirectory)) { New-Item -ItemType Directory -Path $receiptDirectory | Out-Null }
[pscustomobject]@{ idempotency_key = $idempotencyKey; report_url = $ReportUrl; sent_at = (Get-Date).ToString('o'); status_code = $response.StatusCode } | ConvertTo-Json | Set-Content -LiteralPath $ReceiptPath
