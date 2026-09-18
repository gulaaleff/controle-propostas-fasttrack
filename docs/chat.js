/* Chat por comandos (sem IA). Toda alteração passa por confirmação antes de gravar. */
(function () {
'use strict';
const A = window.App;
const $ = id => document.getElementById(id);
const esc = A.esc;

const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'para', 'pra', 'proposta', 'projeto', 'cliente', 'the', 'com', 'um', 'uma']);

// ---------- UI ----------
const box = $('chatMsgs');
function open() { $('chat').classList.add('open'); $('chatIn').focus(); if (!box.children.length) bot(AJUDA_CURTA); }
$('chatFab').onclick = () => $('chat').classList.contains('open') ? $('chat').classList.remove('open') : open();
$('chatClose').onclick = () => $('chat').classList.remove('open');
function me(t) { const d = document.createElement('div'); d.className = 'msg me'; d.textContent = t; box.appendChild(d); box.scrollTop = 1e9; }
function bot(html, actions) {
  const d = document.createElement('div'); d.className = 'msg bot'; d.innerHTML = html;
  if (actions && actions.length) {
    const a = document.createElement('div'); a.className = 'acts';
    actions.forEach(([txt, fn, primary]) => {
      const b = document.createElement('button'); b.className = 'btn sm' + (primary ? ' primary' : ''); b.textContent = txt; b.type = 'button';
      b.onclick = () => { a.querySelectorAll('button').forEach(x => x.disabled = true); fn(); };
      a.appendChild(b);
    });
    d.appendChild(a);
  }
  box.appendChild(d); box.scrollTop = 1e9;
}
const hist = []; let hi = -1;
$('chatForm').onsubmit = e => {
  e.preventDefault();
  const t = $('chatIn').value.trim(); if (!t) return;
  $('chatIn').value = ''; me(t); hist.push(t); hi = -1;
  try { handle(t); } catch (err) { console.error(err); bot('Não consegui processar: ' + esc(err.message)); }
};
// histórico de comandos com ↑
$('chatIn').addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' && hist.length) { hi = Math.max(0, hi < 0 ? hist.length - 1 : hi - 1); $('chatIn').value = hist[hi]; e.preventDefault(); }
});

const AJUDA_CURTA = 'Oi! Eu altero e consulto as propostas por comando. Alguns exemplos:\n' +
  '• <b>marcar CCPR rollouts como ganho</b>\n• <b>perdido Tirol wa inventory por preço</b>\n• <b>valor de Vivara dfe: 108 mil</b>\n• <b>pendência de Antares datasphere: cobrar retorno do João</b>\n• <b>pendências</b> · <b>follow-ups</b> · <b>resumo</b>\nDigite <b>ajuda</b> para ver tudo.';
const AJUDA = '<b>Consultas</b>\n' +
  '• <b>resumo</b> — números gerais\n• <b>alertas</b> — o que está atrasado ou vencendo\n• <b>pendências</b> — atividades pendentes\n• <b>follow-ups</b> [dias] — entregues e sem retorno\n• <b>em elaboração</b> / <b>urgentes</b>\n• <b>buscar</b> termo — lista propostas\n• <b>abrir</b> termo — abre o formulário\n\n' +
  '<b>Alterações</b> (sempre peço confirmação)\n' +
  '• <b>marcar</b> X <b>como</b> ganho | perdido | cancelado | revisão | em aberto\n' +
  '• <b>marcar</b> X <b>como</b> novo | em andamento | concluído | parado\n' +
  '• <b>prioridade</b> de X: urgente | alta | média | baixa\n' +
  '• <b>perdido</b> X <b>por</b> preço | escopo | prazo | internalização | outros\n' +
  '• <b>entreguei v1</b> de X · <b>entreguei final</b> de X · <b>enviei revisão</b> de X\n' +
  '• <b>pendência</b> de X: texto · <b>limpar pendência</b> de X\n' +
  '• <b>obs</b> de X: texto (acrescenta) \n' +
  '• <b>&lt;campo&gt; de</b> X<b>:</b> valor — funciona para qualquer campo (valor, horas, comercial, hubspot, data prevista, módulos, consultores…)\n' +
  '• <b>lembrar de</b> X <b>em</b> 22/09: texto · <b>limpar lembrete de</b> X\n' +
  '• <b>nova proposta:</b> Cliente / Projeto; comercial: Nome; valor: 80 mil; prioridade: alta\n' +
  '• <b>sincronizar</b> — manda as alterações para a planilha no OneDrive\n\n' +
  'X é um pedaço do cliente e/ou projeto (ex.: "ccpr rollouts") ou <b>linha 331</b> da planilha. Se houver mais de uma, eu mostro as opções.';

// ---------- Interpretação de valores ----------
function parseNum(s) {
  s = semAcento(s).replace(/r\$\s*/g, '').trim();
  const m = s.match(/(-?[\d.,]+)\s*(mil|k|mi|milhao|milhoes|m)?\b/);
  if (!m) return null;
  let n = m[1];
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(n) && !/,/.test(n)) n = n.replace(/\./g, '');
  else n = n.replace(/,/g, '');
  let v = parseFloat(n); if (isNaN(v)) return null;
  const u = m[2];
  if (u === 'mil' || u === 'k') v *= 1e3;
  else if (u && u.startsWith('mi') || u === 'm') v *= 1e6;
  return Math.round(v * 100) / 100;
}
function parseDate(s) {
  s = semAcento(s).trim();
  const hoje = new Date();
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (/^hoje$/.test(s)) return iso(hoje);
  if (/^amanha$/.test(s)) { hoje.setDate(hoje.getDate() + 1); return iso(hoje); }
  if (/^ontem$/.test(s)) { hoje.setDate(hoje.getDate() - 1); return iso(hoje); }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return s;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (m) { let y = m[3] ? +m[3] : hoje.getFullYear(); if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (!isNaN(d)) return iso(d); }
  m = s.match(/^(?:em|daqui a)\s+(\d+)\s+dias?$/); if (m) { hoje.setDate(hoje.getDate() + +m[1]); return iso(hoje); }
  return undefined;
}
function matchList(listKey, s) {
  const t = semAcento(s).trim();
  if (!t) return undefined;
  const opts = A.LISTS[listKey];
  return opts.find(o => semAcento(o) === t) || opts.find(o => semAcento(o).startsWith(t)) || opts.find(o => t.startsWith(semAcento(o)));
}
// valores de estado reconhecidos em "marcar X como Y"
const ESTADOS = [
  [/^(ganh[oa]|fechad[oa]|vendid[oa])$/, { status_bid: 'Ganho' }],
  [/^perdid[oa]$/, { status_bid: 'Perdido' }],
  [/^(revisao|em revisao)$/, { status_bid: 'Revisão' }],
  [/^(em aberto|aberto|negociacao|em negociacao)$/, { status_bid: 'Em aberto' }],
  [/^(cancelad[oa])$/, { status: 'Cancelado', status_bid: 'Cancelado' }],
  [/^(novo|nova)$/, { status: 'Novo' }],
  [/^(em andamento|andamento|em elaboracao|elaboracao)$/, { status: 'Em Andamento' }],
  [/^(concluid[oa]|entregue)$/, { status: 'Concluído' }],
  [/^(parad[oa]|congelad[oa]|em espera)$/, { status: 'Parado' }],
  [/^(urgente)$/, { prioridade: 'Urgente' }],
  [/^(prioridade )?(alta)$/, { prioridade: 'Alta' }],
  [/^(prioridade )?(media)$/, { prioridade: 'Média' }],
  [/^(prioridade )?(baixa)$/, { prioridade: 'Baixa' }],
];
// apelidos de campos para "<campo> de X: valor"
const ALIAS = {
  valor: 'valor', preco: 'valor', horas: 'horas', 'horas totais': 'horas', hh: 'horas',
  comercial: 'comercial', vendedor: 'comercial', arquiteto: 'arquiteto', cliente: 'cliente', projeto: 'projeto', titulo: 'projeto',
  hubspot: 'hubspot', 'id hubspot': 'hubspot', chamado: 'chamado', 'numero chamado': 'chamado',
  status: 'status', 'status pv': 'status', 'status bid': 'status_bid', bid: 'status_bid', prioridade: 'prioridade', priorizacao: 'prioridade',
  demanda: 'demanda', 'tipo demanda': 'demanda', 'lost review': 'lost_review', motivo: 'lost_review', 'motivo perda': 'lost_review',
  pendencia: 'atividades', pendencias: 'atividades', atividade: 'atividades', atividades: 'atividades', 'atividades pendentes': 'atividades',
  obs: 'obs', observacao: 'obs', observacoes: 'obs',
  lembrete: 'lembrete_em', 'lembrar em': 'lembrete_em', 'data do lembrete': 'lembrete_em', 'nota do lembrete': 'lembrete_nota',
  'data prevista': 'data_prevista', prazo: 'data_prevista', 'dt recebimento': 'dt_receb', recebimento: 'dt_receb', recebido: 'dt_receb',
  'dt inicio': 'dt_inicio', inicio: 'dt_inicio', 'dt prevista': 'dt_prevista', 'entrega v1': 'dt_v1', v1: 'dt_v1', 'dt v1': 'dt_v1',
  'entrega final': 'dt_final', 'dt final': 'dt_final', 'vfinal': 'dt_final', versoes: 'qtd_versao', versao: 'qtd_versao', 'qtd versao': 'qtd_versao', 'qtd versionamento': 'qtd_versao',
  'data ganho': 'data_ganho_perdido', 'data perdido': 'data_ganho_perdido', 'data ganho perdido': 'data_ganho_perdido', 'data fechamento': 'data_ganho_perdido',
  consultores: 'consultores', modulos: 'modulos', modulo: 'modulos',
};
function coerce(field, raw) {
  const f = A.FMAP[field]; const t = f[2];
  const s = raw.trim();
  if (/^(vazio|limpar|nada|-|nenhum|nenhuma)$/i.test(semAcento(s))) return { v: null };
  if (t === 'number') { const n = parseNum(s); return n == null ? { err: 'não entendi o número "' + s + '"' } : { v: n }; }
  if (t === 'int') { const n = parseNum(s); return n == null ? { err: 'não entendi o número "' + s + '"' } : { v: Math.round(n) }; }
  if (t === 'date') { const d = parseDate(s); return d === undefined ? { err: 'não entendi a data "' + s + '" (use dd/mm/aaaa, hoje, amanhã)' } : { v: d }; }
  if (t === 'list') { const v = matchList(f[3], s); return v ? { v } : { err: '"' + s + '" não é opção de ' + f[1] + ' (' + A.LISTS[f[3]].join(', ') + ')' }; }
  return { v: s };
}

// ---------- Localizar proposta ----------
function tokens(s) { return semAcento(s).replace(/[^a-z0-9/&+.\- ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)); }
function find(q) {
  const lm = semAcento(q).match(/^(?:linha|#)\s*(\d+)$/);
  if (lm) return A.data.filter(d => d.excel_row === +lm[1]);
  const tk = tokens(q);
  if (!tk.length) return [];
  const scored = A.data.map(d => {
    const cli = semAcento(d.cliente), prj = semAcento(d.projeto), hay = cli + ' ' + prj + ' ' + semAcento(d.comercial) + ' ' + (d.hubspot || '');
    let s = 0, hit = 0;
    tk.forEach(w => {
      if (hay.includes(w)) { hit++; s += (cli.includes(w) ? 3 : 2) + Math.min(w.length, 8) / 8; if ((' ' + cli + ' ').includes(' ' + w + ' ')) s += 1; }
    });
    if (hit < tk.length) return null;
    if (A.ACTIVE_STATUS.includes(d.status) || d.status_bid === 'Em aberto') s += 0.5;
    if (d.dt_receb) s += Number(d.dt_receb.replace(/-/g, '')) / 1e9; // desempate: mais recente
    return { d, s };
  }).filter(Boolean).sort((a, b) => b.s - a.s);
  if (scored.length > 1 && scored[0].s - scored[1].s >= 2) return [scored[0].d];
  return scored.map(x => x.d);
}
function desc(d) { return '<b>' + esc(d.cliente || '—') + '</b> · ' + esc(d.projeto || '') + ' <span style="color:var(--mut)">(' + esc(d.status || '—') + ' / ' + esc(d.status_bid || '—') + (d.valor ? ' · ' + A.BRL(d.valor) : '') + (d.excel_row ? ' · linha ' + d.excel_row : '') + ')</span>'; }
function withTarget(q, fn) {
  const r = find(q);
  if (!r.length) { bot('Não achei proposta para "<b>' + esc(q) + '</b>". Tente outro pedaço do cliente ou do projeto, ou <b>buscar</b> ' + esc(q) + '.'); return; }
  if (r.length === 1) { fn(r[0]); return; }
  bot('Encontrei ' + r.length + ' propostas para "' + esc(q) + '". Qual delas?', r.slice(0, 8).map(d => [(d.cliente || '—') + ' · ' + (d.projeto || '').slice(0, 42) + (d.excel_row ? ' (L' + d.excel_row + ')' : ''), () => fn(d)]).concat(r.length > 8 ? [['…refinar a busca', () => bot('Acrescente mais uma palavra do projeto para eu filtrar.')]] : []));
}
function confirmChange(d, ch, extraMsg) {
  const linhas = Object.entries(ch).map(([k, v]) => '• ' + A.FMAP[k][1] + ': ' + esc(fmt(k, d[k])) + ' → <b>' + esc(fmt(k, v)) + '</b>').join('\n');
  const iguais = Object.entries(ch).every(([k, v]) => (d[k] ?? null) === v);
  if (iguais) { bot(desc(d) + '\nJá está assim, nada a mudar.'); return; }
  bot(desc(d) + '\n' + linhas + (extraMsg ? '\n' + extraMsg : ''), [
    ['Confirmar', async () => {
      const r = await A.update(d.id, ch, 'chat');
      const soAlerta = Object.keys(ch).every(k => k.startsWith('lembrete_'));
      if (r) bot(soAlerta ? 'Lembrete gravado. Ele vive só no site, não vai para a planilha.' : 'Gravado. A planilha recebe na próxima sincronização.', [['Desfazer', async () => { const u = await A.update(d.id, r.prev, 'chat'); if (u) bot('Desfeito.'); }], ['Abrir', () => A.openEditor(d.id)]]);
    }, true],
    ['Cancelar', () => bot('Ok, não alterei nada.')],
  ]);
}
function fmt(k, v) {
  if (v == null || v === '') return '—';
  const t = A.FMAP[k][2];
  if (t === 'date') return A.fmtDate(v);
  if (k === 'valor') return A.BRL(v);
  return String(v);
}
function listResult(arr, titulo, extra) {
  if (!arr.length) { bot(titulo + ': nenhuma.'); return; }
  bot(titulo + ' (' + arr.length + '):\n' + arr.slice(0, 15).map(d => '• ' + desc(d) + (extra ? '\n   ' + esc(extra(d)) : '')).join('\n') + (arr.length > 15 ? '\n…e mais ' + (arr.length - 15) + '. Use os filtros da tela para ver todas.' : ''),
    arr.length <= 6 ? arr.map(d => ['Abrir ' + (d.cliente || '').slice(0, 20), () => A.openEditor(d.id)]) : null);
}

// ---------- Roteador ----------
function handle(texto) {
  const t = texto.trim();
  const n = semAcento(t).replace(/\s+/g, ' ');
  let m;

  if (/^(ajuda|help|\?|comandos)$/.test(n)) return bot(AJUDA);

  if (/^(resumo|status geral|como estamos|panorama)$/.test(n)) {
    const D = A.data, s = a => a.reduce((x, d) => x + (d.valor || 0), 0);
    const ab = D.filter(d => d.status_bid === 'Em aberto'), g = D.filter(d => d.status_bid === 'Ganho'), p = D.filter(d => d.status_bid === 'Perdido');
    const el = D.filter(d => A.ACTIVE_STATUS.includes(d.status));
    const mes = A.today().slice(0, 7);
    const gm = g.filter(d => (d.data_ganho_perdido || '').slice(0, 7) === mes), rm = D.filter(d => (d.dt_receb || '').slice(0, 7) === mes);
    return bot('<b>Resumo</b>\n• ' + D.length + ' propostas no total\n• Em negociação: ' + ab.length + ' (' + A.BRL(s(ab)) + ')\n• Em elaboração: ' + el.length + ' (' + el.filter(d => ['Urgente', 'Alta'].includes(d.prioridade)).length + ' urgentes/altas)\n• Ganhas: ' + g.length + ' (' + A.BRL(s(g)) + ') · Perdidas: ' + p.length + ' (' + A.BRL(s(p)) + ')\n• Este mês: ' + rm.length + ' recebidas, ' + gm.length + ' ganhas (' + A.BRL(s(gm)) + ')');
  }
  if (/^(alertas?|meus alertas|o que (esta|ta) atrasado)$/.test(n)) {
    if (!window.Alertas) return bot('O módulo de alertas ainda está carregando.');
    const al = window.Alertas.calcular();
    if (!al.length) return bot('Nenhum alerta aberto.');
    return bot('Alertas abertos (' + al.length + '):\n' + al.slice(0, 12).map(a => '• ' + desc(a.d) + '\n   <b>' + esc(a.titulo) + '</b>' + (a.detalhe ? ' — ' + esc(String(a.detalhe).split('\n')[0]) : '')).join('\n') + (al.length > 12 ? '\n…e mais ' + (al.length - 12) + '. Veja a aba Alertas.' : ''),
      [['Abrir aba Alertas', () => A.setView('alertas')]]);
  }
  if ((m = t.match(/^(?:lembrar|lembrete|me lembra(?:r)?)\s+(?:de\s+|da\s+|do\s+)?(.+?)\s+(?:em|no dia|dia|para|pra)\s+([^:]+?)\s*(?::\s*(.+))?$/i))) {
    const data = parseDate(m[2]);
    if (data === undefined) return bot('Não entendi a data "' + esc(m[2]) + '". Use dd/mm, dd/mm/aaaa, hoje, amanhã ou "em 3 dias".');
    return withTarget(m[1], d => confirmChange(d, { lembrete_em: data, lembrete_nota: (m[3] || d.lembrete_nota || '').trim() || null }));
  }
  if ((m = n.match(/^(?:limpar|remover|apagar)\s+(?:o\s+)?lembrete\s+(?:de |da |do )?(.+)$/))) {
    return withTarget(m[1], d => confirmChange(d, { lembrete_em: null, lembrete_nota: null }));
  }
  if (/^(sincronizar|sincroniza|atualizar planilha|manda pro excel|mandar para o excel)$/.test(n)) {
    document.getElementById('syncBtn').click();
    return bot('Pedi a sincronização. A planilha é atualizada na próxima rodada do notebook (12h e 17h30) ou quando você rodar o atalho.');
  }
  if (/^(pendencias|pendentes|o que (esta|ta) pendente|atividades pendentes)$/.test(n)) {
    return listResult(A.data.filter(d => d.atividades && d.status !== 'Cancelado'), 'Atividades pendentes', d => d.atividades);
  }
  if ((m = n.match(/^follow ?-?ups?(?: (\d+))?$/))) {
    const dias = m[1] ? +m[1] : 7;
    const arr = A.data.filter(d => d.status_bid === 'Em aberto' && (d.dt_final || d.dt_v1) && !A.ACTIVE_STATUS.includes(d.status))
      .map(d => [d, A.daysBetween(d.dt_final || d.dt_v1, A.today())]).filter(x => x[1] >= dias && x[1] <= 90).sort((a, b) => a[1] - b[1]);
    return listResult(arr.map(x => x[0]), 'Follow-ups (entregues há ' + dias + '+ dias, ainda em aberto)', d => 'última entrega ' + A.fmtDate(d.dt_final || d.dt_v1) + ' · ' + A.daysBetween(d.dt_final || d.dt_v1, A.today()) + ' dias');
  }
  if (/^(em elaboracao|elaboracao|em andamento|fila|minha fila)$/.test(n)) {
    const P = { 'Urgente': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
    return listResult(A.data.filter(d => A.ACTIVE_STATUS.includes(d.status)).sort((a, b) => (P[a.prioridade] ?? 9) - (P[b.prioridade] ?? 9)), 'Em elaboração', d => (d.prioridade || 'sem prioridade') + ' · recebido ' + A.fmtDate(d.dt_receb) + (d.data_prevista ? ' · prazo ' + A.fmtDate(d.data_prevista) : ''));
  }
  if (/^(urgentes?|prioridades?)$/.test(n)) {
    return listResult(A.data.filter(d => A.ACTIVE_STATUS.includes(d.status) && ['Urgente', 'Alta'].includes(d.prioridade)), 'Urgentes e altas em elaboração', d => d.prioridade + (d.data_prevista ? ' · prazo ' + A.fmtDate(d.data_prevista) : ''));
  }
  if ((m = t.match(/^(?:buscar|busca|procurar|mostrar?|listar?|ver)\s+(.+)$/i))) {
    return listResult(find(m[1]), 'Resultado para "' + esc(m[1]) + '"', d => (d.atividades ? 'pendência: ' + d.atividades : ''));
  }
  if ((m = t.match(/^(?:abrir|editar|abre)\s+(.+)$/i))) return withTarget(m[1], d => { A.openEditor(d.id); bot('Abri ' + desc(d) + ' no formulário.'); });

  // nova proposta
  if ((m = t.match(/^(?:nova proposta|nova|criar proposta|incluir proposta|adicionar proposta)\s*:?\s*(.+)$/i))) return novaProposta(m[1]);

  // perdido X por motivo
  if ((m = t.match(/^(?:marcar\s+)?(?:perdid[oa]|perdemos)\s+(.+?)\s+(?:por|motivo)\s+(.+)$/i))) {
    const mot = matchList('lost_review', m[2]);
    if (!mot) return bot('Motivo "' + esc(m[2]) + '" não está na lista: ' + A.LISTS.lost_review.join(', '));
    return withTarget(m[1], d => confirmChange(d, { status_bid: 'Perdido', lost_review: mot, ...(d.data_ganho_perdido ? {} : { data_ganho_perdido: A.today() }) }));
  }
  // entregas
  if ((m = n.match(/^(?:entreguei|enviei|entregue|enviado|mandei)\s+(?:a\s+)?(v1|versao 1|primeira versao|final|versao final|vfinal|revisao|nova versao)\s+(?:de |da |do |para |pro |pra )?(.+)$/))) {
    const tipo = m[1];
    return withTarget(m[2], d => {
      const ch = {};
      if (/v1|versao 1|primeira/.test(tipo)) { ch.dt_v1 = A.today(); if (!d.qtd_versao) ch.qtd_versao = 1; }
      else if (/final/.test(tipo)) { ch.dt_final = A.today(); ch.status = 'Concluído'; ch.qtd_versao = (d.qtd_versao || 1) + (d.dt_v1 ? 1 : 0); }
      else { ch.qtd_versao = (d.qtd_versao || 1) + 1; ch.dt_final = A.today(); }
      if (d.status_bid !== 'Ganho' && d.status_bid !== 'Perdido' && d.status_bid !== 'Em aberto') ch.status_bid = 'Em aberto';
      confirmChange(d, ch);
    });
  }
  // limpar pendência
  if ((m = n.match(/^(?:limpar|remover|apagar|concluir|resolvi|resolver)\s+(?:a\s+)?pendencias?\s+(?:de |da |do )?(.+)$/))) return withTarget(m[1], d => confirmChange(d, { atividades: null }));
  // obs (acrescenta)
  if ((m = t.match(/^(?:obs|observa[cç][aã]o|nota|anotar)\s+(?:de |da |do |em |no |na )?(.+?)\s*:\s*(.+)$/i))) {
    return withTarget(m[1], d => {
      const stamp = A.today().split('-').reverse().slice(0, 2).join('/');
      confirmChange(d, { obs: (d.obs ? d.obs + '\n' : '') + stamp + ' ' + m[2].trim() });
    });
  }
  // marcar X como Y
  if ((m = t.match(/^(?:marcar|marca|mudar|muda|mover|move|colocar|coloca|passar|passa|atualizar|atualiza)\s+(.+)$/i))) {
    // tenta cada separador (como/para/pra/em), do último para o primeiro, até o final ser um estado conhecido
    const resto = m[1]; const seps = [...resto.matchAll(/\s+(?:como|para|pra|em)\s+/gi)].reverse();
    let alvo = null, hit = null;
    for (const sp of seps) {
      const est = semAcento(resto.slice(sp.index + sp[0].length)).trim();
      const h = ESTADOS.find(([re]) => re.test(est));
      if (h) { alvo = resto.slice(0, sp.index); hit = h; }
    }
    if (hit) return withTarget(alvo, d => {
      const ch = { ...hit[1] };
      if (['Ganho', 'Perdido'].includes(ch.status_bid) && !d.data_ganho_perdido) ch.data_ganho_perdido = A.today();
      if (ch.status_bid === 'Ganho' && (!d.lost_review || d.lost_review === 'TBD')) ch.lost_review = 'N/A';
      confirmChange(d, ch, ch.status_bid === 'Perdido' && (!d.lost_review || ['TBD', 'N/A'].includes(d.lost_review)) ? 'Dica: informe o motivo com "perdido ' + esc(alvo) + ' por preço".' : '');
    });
  }
  // <campo> de X: valor
  if ((m = t.match(/^([a-zçãõáéíóúâêô\\ ]{2,30}?)\s+(?:de|da|do|para|pra|no|na)\s+(.+?)\s*[:=]\s*(.*)$/i)) || (m = t.match(/^([a-zçãõáéíóúâêô\\ ]{2,30}?)\s+(.+?)\s*[:=]\s*(.*)$/i))) {
    const campo = ALIAS[semAcento(m[1]).replace(/\\/g, ' ').trim()];
    if (campo) {
      const c = coerce(campo, m[3]);
      if (c.err) return bot('Não gravei: ' + esc(c.err) + '.');
      return withTarget(m[2], d => {
        const ch = { [campo]: c.v };
        if (campo === 'status_bid' && ['Ganho', 'Perdido'].includes(c.v) && !d.data_ganho_perdido) ch.data_ganho_perdido = A.today();
        confirmChange(d, ch);
      });
    }
  }
  // prioridade X alta (sem dois pontos)
  if ((m = n.match(/^prioridade\s+(?:de |da |do )?(.+)\s+(urgente|alta|media|baixa|em espera)$/))) {
    const v = matchList('prioridade', m[2]); return withTarget(m[1], d => confirmChange(d, { prioridade: v }));
  }

  // fallback: tenta busca
  const r = find(t);
  if (r.length) return listResult(r, 'Não reconheci um comando, mas achei estas propostas');
  bot('Não entendi. Digite <b>ajuda</b> para ver os comandos.');
}

function novaProposta(txt) {
  const partes = txt.split(';').map(s => s.trim()).filter(Boolean);
  const row = { arquiteto: 'Aleff Gulá', demanda: 'Fast-Track', status: 'Novo', status_bid: 'Em aberto', lost_review: 'TBD', prioridade: 'Média', qtd_versao: 1, dt_receb: A.today() };
  const erros = [];
  partes.forEach((p, i) => {
    const kv = p.match(/^([a-zçãõáéíóúâêô ]{2,30}?)\s*:\s*(.+)$/i);
    const campo = kv && ALIAS[semAcento(kv[1]).trim()];
    if (campo) { const c = coerce(campo, kv[2]); if (c.err) erros.push(c.err); else row[campo] = c.v; }
    else if (i === 0) {
      const cp = p.split(/\s+[\/|–-]\s+|\s*\/\s*/);
      row.cliente = cp[0].trim(); if (cp.length > 1) row.projeto = cp.slice(1).join(' / ').trim();
    } else erros.push('não entendi "' + p + '"');
  });
  if (!row.cliente) return bot('Formato: <b>nova proposta: Cliente / Projeto; comercial: Nome; valor: 80 mil</b>');
  if (erros.length) return bot('Não criei: ' + esc(erros.join('; ')) + '.');
  const linhas = Object.entries(row).map(([k, v]) => '• ' + A.FMAP[k][1] + ': <b>' + esc(fmt(k, v)) + '</b>').join('\n');
  bot('Criar esta proposta?\n' + linhas, [
    ['Criar', async () => { const r = await A.insert(row, 'chat'); if (r) bot('Criada. Vai para a planilha na próxima sincronização.', [['Abrir', () => A.openEditor(r.id)]]); }, true],
    ['Abrir no formulário', () => A.openEditor(null, row)],
    ['Cancelar', () => bot('Ok, não criei.')],
  ]);
}

window.Chat = { handle, find, parseNum, parseDate };
})();
