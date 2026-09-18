# Controle de Propostas · Fast Track SEIDOR

Painel web das propostas de pré-venda, com edição, kanban, pendências, histórico e um chat por comandos.
Os dados ficam no Supabase. Um script no Windows mantém a planilha `Controle de Propostas_V1.0.xlsm` sincronizada com o site, nos dois sentidos.

```
docs/                     site estático (GitHub Pages publica esta pasta)
  index.html, app.js, tabela.js, alertas.js, chat.js, styles.css, config.js
sync/                     sincronização Excel <-> Supabase (Windows)
  Sincronizar Excel.bat   roda uma sincronização completa
  Simular Sincronizacao.bat  mostra o que mudaria, sem gravar
  Agendar Sincronizacao.bat  agenda 12h e 17h30 (enquanto você estiver logado)
  sync-excel.ps1, agendar.ps1, sync-config.json
supabase/migrations/      SQL aplicado no projeto
```

## Supabase

- Projeto: `controle-propostas-fasttrack` (org AG Digital, região São Paulo)
- URL: `https://rinuyghiteqrhvkxatbn.supabase.co`
- Tabelas: `propostas` (as 25 colunas da planilha + controle + lembrete), `propostas_log` (histórico de cada alteração), `usuarios_permitidos` (quem pode ver e editar), `sync_pedidos` e `sync_status` (sincronização sob demanda), `alertas_config` e `alertas_baixa` (alertas por usuário)
- Segurança: só usuário logado **e** presente em `usuarios_permitidos` lê ou altera. A chave que está no `config.js` é a publicável; pode ficar no GitHub.
- Carga inicial: 332 linhas da aba "Controle de Propostas" em 16/09/2026 (total R$ 31.039.180,22). Cada registro guarda `excel_row`, a linha de origem.

Para liberar outra pessoa (SQL Editor do Supabase):

```sql
insert into public.usuarios_permitidos (email, nome) values ('pessoa@seidor.com', 'Nome');
```

## Primeiro acesso ao site

1. Abra `docs/index.html` no navegador (funciona direto do disco) ou o endereço do GitHub Pages.
2. Digite `aleffgh@gmail.com`, escolha uma senha e clique em **Criar acesso**.
3. Confirme pelo link que chega no e-mail. Se o link abrir uma página com erro, tudo bem: a conta já foi confirmada.
4. Volte ao site e clique em **Entrar**.

Depois de publicar no GitHub Pages, ajuste no Supabase em *Authentication → URL Configuration*:
**Site URL** = endereço do Pages; em **Redirect URLs** inclua o mesmo endereço. Assim os links de confirmação e de troca de senha voltam para o site.

## Sincronização com a planilha

Primeira vez:

1. Rode `sync/Simular Sincronizacao.bat` (ele pede a senha do site e mostra o que faria, sem mexer em nada). A senha fica criptografada com a sua conta do Windows em `sync-credencial.dat`.
2. Se estiver de acordo, rode `sync/Sincronizar Excel.bat`. Na primeira rodada ele grava o ID de cada linha na coluna **Z ("ID Web")**, que fica oculta, e atualiza a linha de cada proposta no banco (leva cerca de um minuto).
3. Rode `sync/Agendar Sincronizacao.bat`. Ele cria uma tarefa no Agendador do Windows que sincroniza todo dia às 12:00 e às 17:30. Para outro horário: `Agendar Sincronizacao.bat -Horarios "09:00,18:00"`. Para voltar à checagem por minuto: `-Minutos 15`.

Como funciona:

- Usa o próprio Excel. Macros, gráficos, validações e formatação ficam como estão; a macro `Worksheet_Change` é desligada só enquanto o script grava.
- Planilha aberta ou fechada, tanto faz. Aberta: grava nela e salva. Fechada: abre sem macros, grava, salva e fecha.
- Compara campo a campo com a última sincronização: o que mudou só no Excel sobe, o que mudou só no site desce. Se o mesmo campo mudou nos dois lados, fica o valor do site e o caso vai para o log.
- Linha nova no Excel vira proposta no site. Proposta nova no site vira linha no fim da planilha, com a formatação da linha de cima.
- Linha apagada no Excel marca a proposta como excluída no site (não apaga do banco). Se mais de 10 sumirem de uma vez, o script não exclui nada e avisa no log.
- Não apague nem edite a coluna Z. Ordenar, filtrar e inserir linhas no meio pode, porque o vínculo é pelo ID e não pelo número da linha.
- Tudo fica registrado em `sync/sync-log.txt`.
- Se o Excel estiver com uma célula em edição, a rodada falha sem estragar nada e a próxima tenta de novo.
- O botão **⇅ Sincronizar planilha**, no site, grava um pedido na tabela `sync_pedidos`. Ele é atendido na próxima rodada agendada, ou na hora se você abrir o atalho `Sincronizar Excel.bat`. O selo ao lado do botão mostra a última sincronização e avisa quando o notebook está offline.

## Tabela

Aba **Tabela**: todas as propostas em linhas, como na planilha, mas com filtro por coluna (funil no cabeçalho, com lista de valores, "contém" e faixa para números e datas), ordenação em qualquer coluna, busca geral, escolha das colunas visíveis, densidade, texto completo, totais no rodapé e exportação em CSV. Clicar numa linha abre o formulário de edição. As preferências de coluna e densidade ficam no navegador.

## Alertas

Aba **Alertas** (e o sino no cabeçalho) para as demandas em Novo, Em Andamento ou com Status BID em Revisão. Quatro regras, todas ligáveis e ajustáveis na própria aba:

- **Lembrete por demanda** — campo "Lembrete em" na proposta ou pelo chat
- **Parada há X dias** — dias sem movimentação, definidos por prioridade
- **Prazo** — Data Prevista chegando ou vencida
- **Pendência parada** — texto em Atividades Pendentes sem mexer há X dias

Cada alerta pode ser adiado (1, 3 ou 7 dias) ou resolvido; resolvido volta a aparecer se a proposta mudar. O botão de notificações do navegador avisa na área de trabalho enquanto o site estiver aberto. A configuração fica por usuário (`alertas_config`), assim como os adiamentos (`alertas_baixa`).

## Chat

Não usa IA: interpreta comandos em português e sempre pede confirmação antes de gravar. Digite `ajuda` no chat para ver tudo. Exemplos:

```
resumo
pendências
follow-ups 10
marcar CCPR rollouts como ganho
perdido Tirol wa inventory por preço
valor de Vivara dfe: 108 mil
data prevista de CCPR rfp: 25/09
pendência de Antares datasphere: cobrar retorno do João
entreguei v1 de pedra ewm
obs de acme: cliente pediu reunião
mover linha 322 para em andamento
lembrar de CCPR rollouts em 25/09: cobrar o André
alertas
sincronizar
nova proposta: Acme / Integração Ariba; comercial: Farid Saad; valor: 80 mil; prioridade: alta
```

Toda alteração feita pelo chat pode ser desfeita no próprio chat e aparece na aba **Histórico** com origem `chat`.

## Publicar no GitHub

Com o GitHub Desktop: *File → Add local repository* → escolha esta pasta → **Publish repository**.
Pelo terminal:

```bash
git remote add origin https://github.com/<usuario>/controle-propostas-fasttrack.git
git push -u origin main
```

Depois, no GitHub: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs`*.

No plano gratuito do GitHub, o Pages só funciona com repositório público. Tudo bem: o repositório não tem dados de clientes. Eles ficam só no Supabase, protegidos por login.
