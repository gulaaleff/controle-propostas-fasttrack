# Cria (ou atualiza) a tarefa agendada da sincronização com a planilha.
# Por padrão roda duas vezes por dia (12:00 e 17:30), somente enquanto você está logado no Windows.
# O botão do site e o atalho "Sincronizar Excel.bat" continuam valendo para rodar na hora.
#
#   .\agendar.ps1                       # 12:00 e 17:30
#   .\agendar.ps1 -Horarios "09:00,18:00"
#   .\agendar.ps1 -Minutos 15           # em vez de horários fixos, verifica a cada 15 min
#   .\agendar.ps1 -Remover
param([string]$Horarios = '12:00,17:30', [int]$Minutos = 0, [switch]$Remover)
$ErrorActionPreference = 'Stop'
$Nome = 'Controle de Propostas - Sincronizar Excel'
if ($Remover) {
  Unregister-ScheduledTask -TaskName $Nome -Confirm:$false
  Write-Host "Tarefa '$Nome' removida."
  return
}
$Script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'sync-excel.ps1'
if (-not (Test-Path (Join-Path (Split-Path $Script) 'sync-credencial.dat'))) {
  Write-Host 'Antes de agendar, rode "Sincronizar Excel.bat" uma vez para gravar a senha.' -ForegroundColor Yellow
  return
}
if ($Minutos -gt 0) {
  $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Rapido -Silencioso' -f $Script)
  $gatilhos = @(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutos))
  $quando = "a cada $Minutos minutos"
} else {
  $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Silencioso' -f $Script)
  $lista = $Horarios -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $gatilhos = @($lista | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
  $quando = "todo dia às " + ($lista -join ' e às ')
}
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
$quem = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
Register-ScheduledTask -TaskName $Nome -Action $acao -Trigger $gatilhos -Settings $config -Principal $quem -Force | Out-Null
Write-Host "Pronto: a planilha sincroniza $quando, enquanto você estiver logado."
Write-Host 'Fora desses horários, use o botão no site (ele fica na fila) ou o atalho "Sincronizar Excel.bat".'
Write-Host 'Acompanhe em sync-log.txt. Para remover: Agendar Sincronizacao.bat -Remover'
