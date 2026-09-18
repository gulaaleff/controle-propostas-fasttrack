<#
  Sincroniza a aba "Controle de Propostas" da planilha com a tabela public.propostas do Supabase.

  - Usa o próprio Excel (COM): macros, gráficos, validações e formatação da planilha ficam intactos.
  - Funciona com a planilha aberta ou fechada. Se estiver aberta, grava nela e salva.
  - Mescla por campo: o que mudou só no Excel sobe; o que mudou só no site desce.
    Se o mesmo campo mudou nos dois lados desde a última sincronização, vale o site (registrado no log).
  - A coluna Z ("ID Web") guarda o identificador de cada linha. Não apague nem edite essa coluna.
  - Linha apagada no Excel => proposta marcada como excluída no site.

  Uso:
    .\sync-excel.ps1                 # sincroniza (pede a senha na 1ª vez)
    .\sync-excel.ps1 -Simular        # mostra o que faria, sem gravar nada
    .\sync-excel.ps1 -TrocarSenha    # grava outra senha
    .\sync-excel.ps1 -Silencioso     # para o agendador (sem perguntas, só log)
    .\sync-excel.ps1 -Rapido         # sai em 1 segundo se não houver pedido do site nem mudança
#>
param([switch]$Silencioso, [switch]$TrocarSenha, [switch]$Simular, [switch]$Rapido)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Inv = [Globalization.CultureInfo]::InvariantCulture

$Base      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cfg       = Get-Content (Join-Path $Base 'sync-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Planilha  = [IO.Path]::GetFullPath((Join-Path $Base $Cfg.planilha))
$EstadoArq = Join-Path $Base 'sync-estado.json'
$LogArq    = Join-Path $Base 'sync-log.txt'
$CredArq   = Join-Path $Base 'sync-credencial.dat'
$ColId     = [int]$Cfg.colunaId

# Colunas A..Y, na ordem da planilha
$Campos = @(
  @('hubspot','int'), @('data_prevista','date'), @('prioridade','text'), @('status','text'), @('chamado','int'),
  @('demanda','text'), @('cliente','text'), @('projeto','text'), @('atividades','text'), @('valor','num'),
  @('arquiteto','text'), @('comercial','text'), @('dt_receb','date'), @('dt_inicio','date'), @('dt_prevista','date'),
  @('dt_v1','date'), @('dt_final','date'), @('qtd_versao','int'), @('consultores','text'), @('modulos','text'),
  @('horas','num'), @('data_ganho_perdido','date'), @('status_bid','text'), @('lost_review','text'), @('obs','text')
)
$NCampos = $Campos.Count
$ColDe = @{}; for ($i = 0; $i -lt $NCampos; $i++) { $ColDe[$Campos[$i][0]] = $i + 1 }

$script:Trabalhou = -not $Rapido
$script:Buffer = New-Object System.Collections.ArrayList
function Log([string]$msg) {
  $linha = '{0:yyyy-MM-dd HH:mm:ss}  {1}{2}' -f (Get-Date), $(if ($Simular) { '[SIMULAÇÃO] ' } else { '' }), $msg
  if ($script:Trabalhou) {
    if ($script:Buffer.Count) { Add-Content -Path $LogArq -Value $script:Buffer -Encoding UTF8; $script:Buffer.Clear() }
    Add-Content -Path $LogArq -Value $linha -Encoding UTF8
  } else { [void]$script:Buffer.Add($linha) }
  if (-not $Silencioso) { Write-Host $linha }
}

# ---------------- Credencial (DPAPI: só este usuário do Windows consegue ler) ----------------
function Get-Senha {
  if ($TrocarSenha -or -not (Test-Path $CredArq)) {
    if ($Silencioso) { throw 'Senha ainda não gravada. Rode "Sincronizar Excel.bat" uma vez manualmente.' }
    $sec = Read-Host ("Senha do site para " + $Cfg.email) -AsSecureString
    $sec | ConvertFrom-SecureString | Set-Content -Path $CredArq
  }
  $sec = Get-Content $CredArq | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---------------- API ----------------
$script:Token = $null
$script:NovoEstadoFinal = $null; $script:Resumo = $null; $script:ResumoTexto = $null; $script:Pedidos = @(); $script:UltimoErro = $null
function Api([string]$Metodo, [string]$Caminho, $Corpo = $null, [hashtable]$Extra = @{}) {
  $h = @{ apikey = $Cfg.supabaseKey }
  if ($script:Token) { $h['Authorization'] = 'Bearer ' + $script:Token }
  foreach ($k in $Extra.Keys) { $h[$k] = $Extra[$k] }
  $p = @{ Uri = $Cfg.supabaseUrl + $Caminho; Method = $Metodo; Headers = $h; UseBasicParsing = $true; ContentType = 'application/json; charset=utf-8' }
  if ($null -ne $Corpo) { $p['Body'] = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Corpo -Depth 6 -Compress)) }
  try { $r = Invoke-WebRequest @p }
  catch {
    $det = ''
    if ($_.Exception.Response) { try { $det = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {} }
    throw ("{0} {1} falhou: {2} {3}" -f $Metodo, $Caminho, $_.Exception.Message, $det)
  }
  $txt = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
  if ($txt.Trim()) { return (ConvertFrom-Json -InputObject $txt) }
  return $null
}
function Buscar-Tudo([string]$Tabela, [string]$Query) {
  $todos = New-Object System.Collections.ArrayList
  $off = 0
  do {
    $lote = @(Api 'GET' ("/rest/v1/{0}?{1}&limit=1000&offset={2}" -f $Tabela, $Query, $off))
    if ($lote.Count -eq 1 -and $null -eq $lote[0]) { $lote = @() }
    foreach ($x in $lote) { [void]$todos.Add($x) }
    $off += 1000
  } while ($lote.Count -eq 1000)
  return ,$todos
}

# ---------------- Normalização (tudo vira texto comparável) ----------------
function Num-Texto($v, [int]$casas) {
  $d = [math]::Round([double]$v, $casas)
  if ($casas -eq 0) { return ([int64]$d).ToString($Inv) }
  return $d.ToString('0.##', $Inv)
}
function Eh-Numero($v) { return ($v -is [double] -or $v -is [int] -or $v -is [int64] -or $v -is [decimal] -or $v -is [single] -or $v -is [int16]) }
function Texto-Numero([string]$s) {
  $t = $s.Trim() -replace '^R\$\s*', ''
  $n = 0.0
  if ([double]::TryParse($t, [Globalization.NumberStyles]::Float, $Inv, [ref]$n)) { return $n }
  if ([double]::TryParse($t, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]'pt-BR', [ref]$n)) { return $n }
  return $null
}

# valor lido do Excel (Value2) -> texto normalizado ou $null
function Norm-Excel($v, [string]$tipo, $celula) {
  if ($null -eq $v -or $v -is [DBNull]) { return $null }
  if ($v -is [string]) { $v = $v.Trim(); if ($v -eq '') { return $null } }
  switch ($tipo) {
    'int'  { if (Eh-Numero $v) { return Num-Texto $v 0 }; $n = Texto-Numero $v; if ($null -ne $n) { return Num-Texto $n 0 }; return $null }
    'num'  { if (Eh-Numero $v) { return Num-Texto $v 2 }; $n = Texto-Numero $v; if ($null -ne $n) { return Num-Texto $n 2 }; return $null }
    'date' {
      if (Eh-Numero $v) { $d = [double]$v; if ($d -gt 20000 -and $d -lt 80000) { return [DateTime]::FromOADate($d).ToString('yyyy-MM-dd') }; return $null }
      $dt = [datetime]::MinValue
      if ([datetime]::TryParseExact([string]$v, @('dd/MM/yyyy','d/M/yyyy','yyyy-MM-dd','dd/MM/yy'), $Inv, 'None', [ref]$dt)) { return $dt.ToString('yyyy-MM-dd') }
      return $null
    }
    default {
      if (Eh-Numero $v) {
        $txt = $null; if ($celula) { $txt = [string]$celula.Text }
        if ($txt -and $txt -notmatch '^#+$') { return $txt.Trim() }
        return ([double]$v).ToString('0.##########', $Inv)
      }
      if ($v -is [bool]) { return [string]$v }
      if ($v -is [datetime]) { return $v.ToString('yyyy-MM-dd') }
      return ([string]$v) -replace "`r`n", "`n"
    }
  }
}
# valor vindo do banco (JSON) -> texto normalizado ou $null
function Norm-Db($v, [string]$tipo) {
  if ($null -eq $v) { return $null }
  switch ($tipo) {
    'int'  { return Num-Texto $v 0 }
    'num'  { return Num-Texto $v 2 }
    'date' { if ($v -is [datetime]) { return $v.ToString('yyyy-MM-dd') }; return ([string]$v).Substring(0, 10) }
    default { if ($v -is [datetime]) { return $v.ToString('yyyy-MM-dd') }; $s = ([string]$v) -replace "`r`n", "`n"; $s = $s.Trim(); if ($s -eq '') { return $null }; return $s }
  }
}
# texto normalizado -> valor JSON para gravar no banco
function Para-Json($s, [string]$tipo) {
  if ($null -eq $s) { return $null }
  switch ($tipo) { 'int' { return [int64]$s } 'num' { return [double]::Parse($s, $Inv) } default { return [string]$s } }
}
function Iso($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [datetime]) { return $v.ToUniversalTime().ToString('o') }
  return [string]$v
}
function Igual($a, $b) { if ($null -eq $a) { return $null -eq $b }; if ($null -eq $b) { return $false }; return [string]$a -ceq [string]$b }
function Campos-Db($linha) {
  $o = @{}
  foreach ($c in $Campos) { $o[$c[0]] = Norm-Db $linha.($c[0]) $c[1] }
  return $o
}

# ---------------- Excel ----------------
$excel = $null; $wb = $null; $ws = $null; $abriu = $false; $excelNovo = $false; $eventosAntes = $true

function Abrir-Planilha {
  $nome = [IO.Path]::GetFileName($Planilha)
  try { $script:excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { $script:excel = $null }
  if ($script:excel) {
    foreach ($w in $script:excel.Workbooks) { if ($w.Name -eq $nome) { $script:wb = $w; break } }
  }
  if (-not $script:wb) {
    if (-not (Test-Path $Planilha)) { throw "Planilha não encontrada: $Planilha" }
    if (-not $script:excel) { $script:excel = New-Object -ComObject Excel.Application; $script:excelNovo = $true; $script:excel.Visible = $false }
    $script:excel.DisplayAlerts = $false
    $sec = $script:excel.AutomationSecurity
    $script:excel.AutomationSecurity = 3   # abre sem rodar macros
    try { $script:wb = $script:excel.Workbooks.Open($Planilha, 0, $false) } finally { $script:excel.AutomationSecurity = $sec }
    $script:abriu = $true
  }
  if ($script:wb.ReadOnly) { throw 'A planilha abriu como somente leitura (alguém está com ela aberta em outro Excel?). Nada foi alterado.' }
  $script:ws = $script:wb.Worksheets.Item([string]$Cfg.aba)
  $script:eventosAntes = $script:excel.EnableEvents
}
function Fechar-Planilha([bool]$salvar) {
  try {
    if ($script:excel) { $script:excel.EnableEvents = $script:eventosAntes }
    if ($script:wb -and $salvar -and -not $Simular) { $script:wb.Save() }
    if ($script:abriu -and $script:wb) { $script:wb.Close($false) }
    if ($script:excelNovo -and $script:excel) { $script:excel.Quit() }
  } finally {
    foreach ($o in @($script:ws, $script:wb, $script:excel)) { if ($o) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  }
}
function Gravar-Celula([int]$lin, [int]$col, $valor, [string]$tipo) {
  $cel = $script:ws.Cells.Item($lin, $col)
  if ($null -eq $valor) { [void]$cel.ClearContents(); return }
  switch ($tipo) {
    'int'  { $cel.Value2 = [double]$valor }
    'num'  { $cel.Value2 = [double]::Parse($valor, $Inv) }
    'date' { $cel.Value2 = ([datetime]::ParseExact($valor, 'yyyy-MM-dd', $Inv)).ToOADate() }
    default { if ($valor -match '^[=+\-@]') { $cel.Value2 = "'" + $valor } else { $cel.Value2 = [string]$valor } }
  }
}

# ================= Execução =================
$salvar = $false
try {
  Log '--- início'
  $senha = Get-Senha
  $auth = Api 'POST' '/auth/v1/token?grant_type=password' @{ email = $Cfg.email; password = $senha }
  $script:Token = $auth.access_token

  # Estado da última sincronização (arquivo local)
  $est = $null
  if (Test-Path $EstadoArq) { $est = Get-Content $EstadoArq -Raw -Encoding UTF8 | ConvertFrom-Json }
  $marcaBanco = if ($est -and $est.marcaBanco) { Iso $est.marcaBanco } else { $null }
  $mtimeAnterior = if ($est -and $est.excelMtime) { Iso $est.excelMtime } else { $null }
  $mtimeAtual = if (Test-Path $Planilha) { (Get-Item $Planilha).LastWriteTimeUtc.ToString('o') } else { $null }

  # Pedidos de sincronização feitos no site + sinal de vida
  $pedidos = @()
  if (-not $Simular) { [void](Api 'PATCH' '/rest/v1/sync_status?id=eq.1' @{ heartbeat = (Get-Date).ToUniversalTime().ToString('o') } @{ Prefer = 'return=minimal' }) }
  $pedidos = @(Api 'GET' '/rest/v1/sync_pedidos?select=id,criado_por&status=in.(pendente,executando)&order=criado_em.asc&limit=20')

  if ($Rapido -and $pedidos.Count -eq 0) {
    $mudouExcel = ($mtimeAtual -ne $mtimeAnterior)
    $mudouBanco = $true
    if ($marcaBanco) {
      $novos = @(Api 'GET' ("/rest/v1/propostas?select=id&updated_at=gt.{0}&limit=1" -f [uri]::EscapeDataString($marcaBanco)))
      $mudouBanco = ($novos.Count -gt 0)
    }
    if (-not $mudouExcel -and -not $mudouBanco) { $codigo = 0; $nadaAFazer = $true }
  }
  if (-not $nadaAFazer) {
  $script:Trabalhou = $true
  if ($pedidos.Count -and -not $Simular) {
    foreach ($pd in $pedidos) { [void](Api 'PATCH' ("/rest/v1/sync_pedidos?id=eq.{0}" -f $pd.id) @{ status = 'executando'; iniciado_em = (Get-Date).ToUniversalTime().ToString('o') } @{ Prefer = 'return=minimal' }) }
    Log ("{0} pedido(s) de sincronização vindos do site" -f $pedidos.Count)
  }

  # Banco
  $todos = Buscar-Tudo 'propostas' 'select=*&order=excel_row.asc.nullslast'
  $db = @{}; $excluidos = @{}
  foreach ($r in $todos) { if ($r.excluido) { $excluidos[[string]$r.id] = $true } else { $db[[string]$r.id] = $r } }
  Log ("banco: {0} propostas ativas, {1} excluídas" -f $db.Count, $excluidos.Count)

  # Estado da última sincronização
  $prev = @{}
  if ($est -and $est.linhas) {
    foreach ($p in $est.linhas.PSObject.Properties) {
      $h = @{}; foreach ($q in $p.Value.PSObject.Properties) { $h[$q.Name] = $q.Value }
      $prev[$p.Name] = $h
    }
  } else {
    # 1ª execução: reconstrói os valores da importação desfazendo o que o site já alterou
    Log 'primeira sincronização: reconstruindo a base a partir do histórico'
    $hist = Buscar-Tudo 'propostas_log' 'select=proposta_id,acao,alteracoes,created_at&acao=eq.update&order=created_at.asc'
    $orig = @{}
    foreach ($h in $hist) {
      $id = [string]$h.proposta_id
      if (-not $orig.ContainsKey($id)) { $orig[$id] = @{} }
      foreach ($a in $h.alteracoes.PSObject.Properties) { if (-not $orig[$id].ContainsKey($a.Name)) { $orig[$id][$a.Name] = $a.Value.de } }
    }
    foreach ($id in $db.Keys) {
      $d = $db[$id]
      if ($null -eq $d.excel_row) { continue }   # criada no site: não existia na planilha
      $v = Campos-Db $d
      if ($orig.ContainsKey($id)) { foreach ($c in $Campos) { if ($orig[$id].ContainsKey($c[0])) { $v[$c[0]] = Norm-Db $orig[$id][$c[0]] $c[1] } } }
      $prev[$id] = $v
    }
  }

  Abrir-Planilha
  $script:excel.EnableEvents = $false   # evita a macro Worksheet_Change mexer no que gravamos

  if ([string]$script:ws.Cells.Item(1, $ColId).Value2 -ne 'ID Web') {
    if (-not $Simular) { $script:ws.Cells.Item(1, $ColId).Value2 = 'ID Web'; if ($Cfg.ocultarColunaId) { $script:ws.Columns.Item($ColId).Hidden = $true } }
    $salvar = $true
  }

  $ur = $script:ws.UsedRange
  $ultima = [math]::Max(2, $ur.Row + $ur.Rows.Count - 1)
  $vals = $script:ws.Range($script:ws.Cells.Item(1, 1), $script:ws.Cells.Item($ultima, $ColId)).Value2

  # Linhas do Excel
  $linhas = New-Object System.Collections.ArrayList
  $ultimaComDado = 1
  for ($r = 2; $r -le $ultima; $r++) {
    $vazia = $true
    for ($c = 1; $c -le $NCampos; $c++) { $x = $vals[$r, $c]; if ($null -ne $x -and -not ($x -is [string] -and $x.Trim() -eq '')) { $vazia = $false; break } }
    if ($vazia) { continue }
    $ultimaComDado = $r
    $v = @{}
    for ($c = 1; $c -le $NCampos; $c++) {
      $x = $vals[$r, $c]; $tipo = $Campos[$c - 1][1]; $cel = $null
      if ($tipo -eq 'text' -and (Eh-Numero $x)) { $cel = $script:ws.Cells.Item($r, $c) }
      $v[$Campos[$c - 1][0]] = Norm-Excel $x $tipo $cel
    }
    [void]$linhas.Add(@{ row = $r; id = ([string]$vals[$r, $ColId]).Trim(); v = $v })
  }
  Log ("planilha: {0} linhas com dados" -f $linhas.Count)

  # Associa IDs às linhas sem ID: pela linha registrada no banco, conferindo cliente+projeto;
  # se a linha mudou de lugar, procura pela chave cliente|projeto|recebimento (só se for única).
  function Chave($v) { return ('{0}|{1}|{2}' -f $v['cliente'], $v['projeto'], $v['dt_receb']).ToLowerInvariant() }
  $idsNoExcel = @{}; foreach ($l in $linhas) { if ($l.id) { $idsNoExcel[$l.id] = $true } }
  $porLinha = @{}; $porChave = @{}
  foreach ($id in $prev.Keys) {
    if ($idsNoExcel.ContainsKey($id) -or -not $db.ContainsKey($id)) { continue }
    $d = $db[$id]
    if ($null -ne $d.excel_row) { $porLinha[[int]$d.excel_row] = $id }
    $ch = Chave $prev[$id]
    if ($porChave.ContainsKey($ch)) { $porChave[$ch] = '' } else { $porChave[$ch] = $id }
  }
  $vistos = @{}
  foreach ($l in $linhas) {
    if ($l.id -and $vistos.ContainsKey($l.id)) { Log ("linha {0}: ID repetido (linha copiada?) - tratada como nova" -f $l.row); $l.id = ''; $l.dup = $true }
    if (-not $l.id -and -not $l.dup) {
      $cand = $null
      if ($porLinha.ContainsKey($l.row)) {
        $pid0 = $porLinha[$l.row]; $pv0 = $prev[$pid0]
        if ((Igual $pv0['cliente'] $l.v['cliente']) -and (Igual $pv0['projeto'] $l.v['projeto'])) { $cand = $pid0 }
      }
      if (-not $cand) { $ch = Chave $l.v; if ($porChave.ContainsKey($ch) -and $porChave[$ch]) { $cand = $porChave[$ch] } }
      if ($cand -and -not $idsNoExcel.ContainsKey($cand)) {
        $l.id = $cand; $idsNoExcel[$cand] = $true
        if (-not $Simular) { $script:ws.Cells.Item($l.row, $ColId).Value2 = $cand }
        $salvar = $true
      }
    }
    if ($l.id) { $vistos[$l.id] = $true }
  }
  $semId = @($linhas | Where-Object { -not $_.id }).Count
  $sumidas = @($prev.Keys | Where-Object { $db.ContainsKey($_) -and -not $vistos.ContainsKey($_) }).Count
  $travarExclusao = $false
  if ($sumidas -gt 10 -or ($semId -gt 0 -and $sumidas -gt 0 -and -not (Test-Path $EstadoArq))) {
    $travarExclusao = $true
    Log ("ATENÇÃO: {0} propostas não foram encontradas na planilha e {1} linhas estão sem ID. Por segurança, nenhuma exclusão será feita nesta rodada. Confira a planilha." -f $sumidas, $semId)
  }

  $novoEstado = @{}
  $nSobe = 0; $nDesce = 0; $nNovasDb = 0; $nNovasXl = 0; $nConf = 0; $nExcl = 0

  foreach ($l in $linhas) {
    # Linha nova no Excel -> cria no banco
    if (-not $l.id) {
      $corpo = @{ origem = 'excel'; excel_row = $l.row }
      foreach ($c in $Campos) { $corpo[$c[0]] = Para-Json $l.v[$c[0]] $c[1] }
      if ($Simular) { Log ("linha {0}: seria criada no site ({1} / {2})" -f $l.row, $l.v.cliente, $l.v.projeto); continue }
      $criado = @(Api 'POST' '/rest/v1/propostas' $corpo @{ Prefer = 'return=representation' })[0]
      $script:ws.Cells.Item($l.row, $ColId).Value2 = [string]$criado.id
      $novoEstado[[string]$criado.id] = $l.v
      $nNovasDb++; $salvar = $true
      Log ("linha {0}: criada no site ({1} / {2})" -f $l.row, $l.v.cliente, $l.v.projeto)
      continue
    }
    $d = $db[$l.id]
    if (-not $d) {
      if ($excluidos.ContainsKey($l.id)) { Log ("linha {0}: proposta excluída no site - linha mantida na planilha, sem sincronizar" -f $l.row) }
      else { Log ("linha {0}: ID {1} não existe no banco - ignorada" -f $l.row, $l.id) }
      continue
    }
    $dv = Campos-Db $d
    $pv = $prev[$l.id]
    $patch = @{}; $final = @{}
    foreach ($c in $Campos) {
      $k = $c[0]; $a = $l.v[$k]; $b = $dv[$k]
      $final[$k] = $a
      if (Igual $a $b) { continue }
      if ($null -eq $pv) { $p = $b } else { $p = $pv[$k] }
      if (Igual $b $p) {
        $patch[$k] = Para-Json $a $c[1]                      # mudou só no Excel
      } else {
        if (-not (Igual $a $p)) { $nConf++; Log ("linha {0} [{1}]: conflito - Excel '{2}' x site '{3}'; mantido o do site" -f $l.row, $k, $a, $b) }
        $final[$k] = $b                                       # mudou no site
        if (-not $Simular) { Gravar-Celula $l.row $ColDe[$k] $b $c[1] }
        $nDesce++; $salvar = $true
      }
    }
    if ($null -eq $d.excel_row -or [int]$d.excel_row -ne $l.row) { $patch['excel_row'] = $l.row }
    if ($patch.Count) {
      $alterados = ($patch.Keys | Where-Object { $_ -ne 'excel_row' }) -join ', '
      if ($alterados) { $nSobe++; Log ("linha {0}: Excel -> site: {1}" -f $l.row, $alterados) }
      if (-not $Simular) {
        if ($alterados) { $patch['origem'] = 'excel' }
        [void](Api 'PATCH' ("/rest/v1/propostas?id=eq.{0}" -f $l.id) $patch @{ Prefer = 'return=minimal' })
      }
    }
    $novoEstado[$l.id] = $final
  }

  # Propostas do banco que não estão na planilha
  $prox = $ultimaComDado + 1
  foreach ($id in $db.Keys) {
    if ($vistos.ContainsKey($id)) { continue }
    $d = $db[$id]
    if ($prev.ContainsKey($id)) {
      if ($travarExclusao) { $novoEstado[$id] = $prev[$id]; continue }
      # já esteve na planilha e sumiu -> apagada no Excel
      Log ("{0} / {1}: apagada da planilha -> marcada como excluída no site" -f $d.cliente, $d.projeto)
      if (-not $Simular) { [void](Api 'PATCH' ("/rest/v1/propostas?id=eq.{0}" -f $id) @{ excluido = $true; origem = 'excel' } @{ Prefer = 'return=minimal' }) }
      $nExcl++
      continue
    }
    # criada no site -> nova linha no fim da planilha
    $dv = Campos-Db $d
    Log ("linha {0}: nova no site -> incluída na planilha ({1} / {2})" -f $prox, $d.cliente, $d.projeto)
    if (-not $Simular) {
      if ($prox -gt 2) { [void]$script:ws.Rows.Item($prox - 1).Copy($script:ws.Rows.Item($prox)) }   # herda formatação
      for ($c = 1; $c -le $NCampos; $c++) { Gravar-Celula $prox $c $dv[$Campos[$c - 1][0]] $Campos[$c - 1][1] }
      $script:ws.Cells.Item($prox, $ColId).Value2 = $id
      [void](Api 'PATCH' ("/rest/v1/propostas?id=eq.{0}" -f $id) @{ excel_row = $prox } @{ Prefer = 'return=minimal' })
    }
    $novoEstado[$id] = $dv
    $prox++; $nNovasXl++; $salvar = $true
  }

  # Ajusta o filtro automático para cobrir as linhas novas
  if ($nNovasXl -and -not $Simular -and $script:ws.AutoFilterMode -and -not $script:ws.FilterMode) {
    try {
      $af = $script:ws.AutoFilter.Range
      if ($af.Row + $af.Rows.Count - 1 -lt $prox - 1) {
        $fim = $script:ws.Cells.Item($prox - 1, $af.Column + $af.Columns.Count - 1)
        $novo = $script:ws.Range($af.Cells.Item(1, 1), $fim)
        $script:ws.AutoFilterMode = $false
        [void]$novo.AutoFilter()
      }
    } catch { Log ('aviso: não ajustei o filtro automático: ' + $_.Exception.Message) }
  }

  $resumoTxt = ("{0} do Excel para o site, {1} campos do site para o Excel, {2} criadas no site, {3} incluídas na planilha, {4} excluídas, {5} conflitos" -f $nSobe, $nDesce, $nNovasDb, $nNovasXl, $nExcl, $nConf)
  if (-not $Simular) {
    $ultimo = @(Api 'GET' '/rest/v1/propostas?select=updated_at&order=updated_at.desc&limit=1')
    $marca = if ($ultimo.Count) { Iso $ultimo[0].updated_at } else { $marcaBanco }
    $script:NovoEstadoFinal = @{ ultimaSync = (Get-Date).ToString('o'); marcaBanco = $marca; excelMtime = $mtimeAtual; linhas = $novoEstado }
    $script:Resumo = @{ sobe = $nSobe; desce = $nDesce; novasNoSite = $nNovasDb; novasNaPlanilha = $nNovasXl; excluidas = $nExcl; conflitos = $nConf }
    $script:ResumoTexto = $resumoTxt
    $script:Pedidos = $pedidos
  }
  Log ('fim: ' + $resumoTxt)
  }
  $codigo = 0
}
catch {
  $m = $_.Exception.Message
  if ($m -match '0x800AC472|0x80010001|RPC_E_CALL_REJECTED|rejeitada|rejected') { $m = 'Excel ocupado (célula em edição ou caixa de diálogo aberta). Tente de novo em instantes. ' + $m }
  $script:UltimoErro = $m
  $script:Pedidos = $pedidos
  $script:Trabalhou = $true
  Log ('ERRO: ' + $m + ' (linha ' + $_.InvocationInfo.ScriptLineNumber + ' do script)')
  $codigo = 1
}
finally {
  if ($script:wb -or $script:excel) { try { Fechar-Planilha $salvar } catch { Log ('aviso ao fechar o Excel: ' + $_.Exception.Message) } }
  if ($script:NovoEstadoFinal) {
    try {
      if (Test-Path $Planilha) { $script:NovoEstadoFinal.excelMtime = (Get-Item $Planilha).LastWriteTimeUtc.ToString('o') }
      $script:NovoEstadoFinal | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $EstadoArq -Encoding UTF8
    } catch { Log ('aviso ao gravar o estado: ' + $_.Exception.Message) }
  }
  if ($script:Token -and -not $Simular) {
    try {
      $agora = (Get-Date).ToUniversalTime().ToString('o')
      if ($codigo -eq 0 -and $script:ResumoTexto) {
        [void](Api 'PATCH' '/rest/v1/sync_status?id=eq.1' @{ ultima_sync = $agora; heartbeat = $agora; mensagem = $script:ResumoTexto; resumo = $script:Resumo; atualizado_em = $agora } @{ Prefer = 'return=minimal' })
      }
      foreach ($pd in @($script:Pedidos)) {
        if (-not $pd) { continue }
        $st = if ($codigo -eq 0) { 'concluido' } else { 'erro' }
        $msg = if ($codigo -eq 0) { $script:ResumoTexto } else { $script:UltimoErro }
        [void](Api 'PATCH' ("/rest/v1/sync_pedidos?id=eq.{0}" -f $pd.id) @{ status = $st; mensagem = $msg; concluido_em = $agora } @{ Prefer = 'return=minimal' })
      }
    } catch { Log ('aviso ao avisar o site: ' + $_.Exception.Message) }
  }
  if ($script:Buffer.Count -and $script:Trabalhou) { Add-Content -Path $LogArq -Value $script:Buffer -Encoding UTF8 }
}
exit $codigo
