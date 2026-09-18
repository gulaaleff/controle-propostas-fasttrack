/* Aba Tabela: todas as demandas em linhas, com filtro por coluna, ordenação e exportação. */
(function () {
'use strict';
const A = window.App;
const $ = id => document.getElementById(id);
const esc = A.esc;
const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const COLUNAS = [
  ['cliente', 'Cliente', 'text'], ['projeto', 'Projeto', 'text'], ['demanda', 'Demanda', 'list'],
  ['prioridade', 'Priorização', 'list'], ['status', 'Status PV', 'list'], ['status_bid', 'Status BID', 'list'],
  ['lost_review', 'Lost Review', 'list'], ['valor', 'Valor', 'num'], ['horas', 'Horas', 'num'],
  ['comercial', 'Comercial', 'list'], ['arquiteto', 'Arquiteto', 'list'], ['modulos', 'Módulos', 'text'],
  ['consultores', 'Consultores', 'text'], ['atividades', 'Atividades Pendentes', 'text'],
  ['dt_receb', 'Recebimento', 'date'], ['dt_inicio', 'Início PV', 'date'], ['dt_prevista', 'DT Prevista', 'date'],
  ['data_prevista', 'Data Prevista', 'date'], ['dt_v1', 'Entrega V1', 'date'], ['dt_final', 'Entrega Final', 'date'],
  ['data_ganho_perdido', 'Ganho/Perdido', 'date'], ['qtd_versao', 'Versões', 'num'],
  ['hubspot', 'Hubspot', 'num'], ['chamado', 'Chamado', 'num'], ['lembrete_em', 'Lembrete', 'date'],
  ['obs', 'OBS', 'text'], ['excel_row', 'Linha', 'num'],
];
const CMAP = Object.fromEntries(COLUNAS.map(c => [c[0], c]));
const PADRAO_VISIVEIS = ['cliente', 'projeto', 'demanda', 'prioridade', 'status', 'status_bid', 'comercial', 'valor', 'horas', 'modulos', 'atividades', 'dt_receb', 'dt_v1', 'data_prevista'];

let PREF = { cols: PADRAO_VISIVEIS.slice(), dens: 'normal', quebra: false, ordem: { k: 'dt_receb', dir: -1 } };
let FILTROS = {};   // coluna -> { valores:Set } | { de, ate } | { texto }
let BUSCA = '';

try {
  const p = JSON.parse(localStorage.getItem('tabelaPrefs') || 'null');
  if (p && Array.isArray(p.cols) && p.cols.length) PREF = Object.assign(PREF, p);
} catch (e) { /* ignora */ }
function salvarPref() { try { localStorage.setItem('tabelaPrefs', JSON.stringify(PREF)); } catch (e) {} }

// ---------- Filtros ----------
function valorTexto(d, k) {
  const t = CMAP[k][2], v = d[k];
  if (v == null || v === '') return '';
  if (t === 'date') return A.fmtDate(v);
  if (k === 'valor') return A.BRL(v);
  if (t === 'num') return String(v);
  return String(v);
}
function passa(d) {
  for (const k of Object.keys(FILTROS)) {
    const f = FILTROS[k], t = CMAP[k][2];
    if (f.valores) {
      const v = d[k] == null || d[k] === '' ? '(vazio)' : String(d[k]);
      if (!f.valores.includes(v)) return false;
    } else if (f.texto) {
      if (!semAcento(d[k]).includes(semAcento(f.texto))) return false;
    } else if (f.de != null || f.ate != null) {
      const v = t === 'date' ? d[k] : (d[k] == null ? null : Number(d[k]));
      if (v == null) return false;
      if (f.de != null && f.de !== '' && v < (t === 'date' ? f.de : Number(f.de))) return false;
      if (f.ate != null && f.ate !== '' && v > (t === 'date' ? f.ate : Number(f.ate))) return false;
    }
  }
  if (BUSCA) {
    const alvo = PREF.cols.map(k => valorTexto(d, k)).join(' ');
    if (!semAcento(alvo).includes(semAcento(BUSCA))) return false;
  }
  return true;
}
function linhas() {
  const out = A.data.filter(passa);
  const { k, dir } = PREF.ordem, t = CMAP[k] ? CMAP[k][2] : 'text';
  out.sort((a, b) => {
    let x = a[k], y = b[k];
    if (x == null || x === '') return 1;
    if (y == null || y === '') return -1;
    if (t === 'num') return (Number(x) - Number(y)) * dir;
    return String(x).localeCompare(String(y), 'pt-BR') * dir;
  });
  return out;
}

// ---------- Popover ----------
function fecharPop() { $('pop').style.display = 'none'; $('pop').innerHTML = ''; }
document.addEventListener('click', e => { if (!e.target.closest('#pop') && !e.target.closest('.fun') && !e.target.closest('#tbColsBtn')) fecharPop(); });
function abrirPop(alvo, html, montar) {
  const pop = $('pop');
  pop.innerHTML = html; pop.style.display = 'block';
  const r = alvo.getBoundingClientRect();
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 10)) + 'px';
  montar(pop);
}
function popFiltro(k, alvo) {
  const [, titulo, t] = CMAP[k];
  const f = FILTROS[k] || {};
  if (t === 'num' || t === 'date') {
    const tipo = t === 'date' ? 'date' : 'number';
    abrirPop(alvo, '<b>' + esc(titulo) + '</b><div class="faixa"><span>de</span><input type="' + tipo + '" id="pfDe" value="' + (f.de ?? '') + '">' +
      '<span>até</span><input type="' + tipo + '" id="pfAte" value="' + (f.ate ?? '') + '"></div>' +
      '<label><input type="checkbox" id="pfVazio"' + (f.valores && f.valores.includes('(vazio)') ? ' checked' : '') + '> Só os vazios</label>' +
      '<div class="rodape"><button class="btn sm" id="pfLimpar">Limpar</button><button class="btn sm primary" id="pfOk">Aplicar</button></div>', pop => {
      pop.querySelector('#pfOk').onclick = () => {
        const de = pop.querySelector('#pfDe').value, ate = pop.querySelector('#pfAte').value;
        if (pop.querySelector('#pfVazio').checked) FILTROS[k] = { valores: ['(vazio)'] };
        else if (de || ate) FILTROS[k] = { de: de || null, ate: ate || null };
        else delete FILTROS[k];
        fecharPop(); render();
      };
      pop.querySelector('#pfLimpar').onclick = () => { delete FILTROS[k]; fecharPop(); render(); };
    });
    return;
  }
  const distintos = [...new Set(A.data.map(d => d[k] == null || d[k] === '' ? '(vazio)' : String(d[k])))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const sel = new Set(f.valores || distintos);
  const muitos = distintos.length > 40;
  abrirPop(alvo, '<b>' + esc(titulo) + '</b>' +
    (muitos ? '<div class="faixa" style="grid-template-columns:1fr"><input id="pfTexto" placeholder="contém…" value="' + esc(f.texto || '') + '"></div>' : '') +
    '<input id="pfBusca" placeholder="filtrar a lista…" style="width:100%;margin-top:8px">' +
    '<div class="opts" id="pfOpts"></div>' +
    '<div class="rodape"><button class="btn sm" id="pfTudo">Marcar tudo</button><button class="btn sm" id="pfLimpar">Limpar</button><button class="btn sm primary" id="pfOk">Aplicar</button></div>', pop => {
    const cx = () => [...pop.querySelectorAll('#pfOpts input')];
    const desenha = q => {
      pop.querySelector('#pfOpts').innerHTML = distintos.filter(v => !q || semAcento(v).includes(semAcento(q)))
        .slice(0, 400).map(v => '<label><input type="checkbox" value="' + esc(v) + '"' + (sel.has(v) ? ' checked' : '') + '> ' + esc(v) + '</label>').join('');
    };
    desenha('');
    pop.querySelector('#pfBusca').oninput = e => desenha(e.target.value);
    pop.querySelector('#pfTudo').onclick = () => cx().forEach(c => c.checked = true);
    pop.querySelector('#pfLimpar').onclick = () => { delete FILTROS[k]; fecharPop(); render(); };
    pop.querySelector('#pfOk').onclick = () => {
      const marcados = cx().filter(c => c.checked).map(c => c.value);
      const texto = pop.querySelector('#pfTexto') ? pop.querySelector('#pfTexto').value.trim() : '';
      if (texto) FILTROS[k] = { texto };
      else if (marcados.length && marcados.length < distintos.length) FILTROS[k] = { valores: marcados };
      else delete FILTROS[k];
      fecharPop(); render();
    };
  });
}
function popColunas(alvo) {
  abrirPop(alvo, '<b>Colunas visíveis</b><div class="opts">' + COLUNAS.map(c =>
    '<label><input type="checkbox" value="' + c[0] + '"' + (PREF.cols.includes(c[0]) ? ' checked' : '') + '> ' + esc(c[1]) + '</label>').join('') +
    '</div><div class="rodape"><button class="btn sm" id="pcPadrao">Padrão</button><button class="btn sm primary" id="pcOk">Aplicar</button></div>', pop => {
    pop.querySelector('#pcOk').onclick = () => {
      const marcados = [...pop.querySelectorAll('input:checked')].map(c => c.value);
      PREF.cols = COLUNAS.map(c => c[0]).filter(k => marcados.includes(k));
      if (!PREF.cols.length) PREF.cols = PADRAO_VISIVEIS.slice();
      salvarPref(); fecharPop(); render();
    };
    pop.querySelector('#pcPadrao').onclick = () => { PREF.cols = PADRAO_VISIVEIS.slice(); salvarPref(); fecharPop(); render(); };
  });
}

// ---------- Render ----------
function descreveFiltro(k) {
  const f = FILTROS[k];
  if (f.texto) return 'contém "' + f.texto + '"';
  if (f.valores) return f.valores.length <= 3 ? f.valores.join(', ') : f.valores.length + ' valores';
  const fmt = v => CMAP[k][2] === 'date' ? A.fmtDate(v) : v;
  if (f.de && f.ate) return fmt(f.de) + ' a ' + fmt(f.ate);
  if (f.de) return '≥ ' + fmt(f.de);
  return '≤ ' + fmt(f.ate);
}
function render() {
  const rows = linhas();
  const tab = $('tbTabela');
  tab.className = 'tbgrid' + (PREF.dens === 'compacta' ? ' compacta' : '') + (PREF.quebra ? ' quebra' : '');
  $('tbHead').innerHTML = PREF.cols.map((k, i) => {
    const [, titulo] = CMAP[k];
    const ord = PREF.ordem.k === k ? (PREF.ordem.dir > 0 ? ' ▲' : ' ▼') : '';
    return '<th class="' + (i === 0 ? 'fix1' : '') + '" data-k="' + k + '"><span class="ord">' + esc(titulo) + ord + '</span>' +
      '<button class="fun' + (FILTROS[k] ? ' on' : '') + '" title="Filtrar">▼</button></th>';
  }).join('');
  $('tbHead').querySelectorAll('th').forEach(th => {
    const k = th.dataset.k;
    th.querySelector('.ord').onclick = () => {
      PREF.ordem = { k, dir: PREF.ordem.k === k ? -PREF.ordem.dir : 1 };
      salvarPref(); render();
    };
    th.querySelector('.fun').onclick = e => { e.stopPropagation(); popFiltro(k, e.target); };
  });

  $('tbBody').innerHTML = rows.map(d => '<tr data-id="' + d.id + '">' + PREF.cols.map((k, i) => {
    const t = CMAP[k][2], txt = valorTexto(d, k);
    const cls = (i === 0 ? 'fix1 ' : '') + (t === 'num' ? 'num' : '');
    if (k === 'status_bid' || k === 'status' || k === 'prioridade') {
      const c = k === 'status_bid' ? cor(d.status_bid) : (k === 'status' ? corStatus(d.status) : corPrio(d.prioridade));
      return '<td class="' + cls + '">' + (txt ? '<span class="pill" style="background:' + c + '22;color:' + c + '">' + esc(txt) + '</span>' : '') + '</td>';
    }
    return '<td class="' + cls + '" title="' + esc(txt) + '">' + esc(txt) + '</td>';
  }).join('') + '</tr>').join('');
  if (!rows.length) $('tbBody').innerHTML = '<tr><td class="empty" colspan="' + PREF.cols.length + '">Nenhuma proposta com esses filtros.</td></tr>';

  const soma = (k) => rows.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  $('tbFoot').innerHTML = PREF.cols.map((k, i) => {
    let v = '';
    if (i === 0) v = rows.length + ' linhas';
    else if (k === 'valor') v = A.BRL(soma('valor'));
    else if (k === 'horas') v = soma('horas').toLocaleString('pt-BR');
    return '<td class="' + (i === 0 ? 'fix1 ' : '') + (CMAP[k][2] === 'num' ? 'num' : '') + '">' + v + '</td>';
  }).join('');

  $('tbResumo').textContent = rows.length + ' de ' + A.data.length + ' propostas · ' + A.BRL(soma('valor')) + ' · ' + soma('horas').toLocaleString('pt-BR') + ' h';
  $('tbChips').innerHTML = Object.keys(FILTROS).map(k =>
    '<span class="chipf"><b>' + esc(CMAP[k][1]) + ':</b> ' + esc(descreveFiltro(k)) + '<button data-k="' + k + '" title="Remover">✕</button></span>').join('');
  $('tbChips').querySelectorAll('button').forEach(b => b.onclick = () => { delete FILTROS[b.dataset.k]; render(); });
  $('tbDens').classList.toggle('primary', PREF.dens === 'compacta');
  $('tbQuebra').classList.toggle('primary', PREF.quebra);
}
function corStatus(s) { return ({ 'Novo': '#06b6d4', 'Em Andamento': '#3b82f6', 'Concluído': '#22c55e', 'Parado': '#f59e0b', 'Cancelado': '#64748b' })[s] || '#93a0bd'; }
function corPrio(p) { return ({ 'Urgente': '#ef4444', 'Alta': '#f59e0b', 'Média': '#3b82f6', 'Baixa': '#64748b', 'Em espera': '#8b5cf6' })[p] || '#93a0bd'; }
function cor(sb) { return ({ 'Ganho': '#22c55e', 'Perdido': '#ef4444', 'Em aberto': '#f59e0b', 'Cancelado': '#64748b', 'Revisão': '#8b5cf6' })[sb] || '#93a0bd'; }

function csv() {
  const rows = linhas();
  const sep = ';';
  const cel = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const linhasCsv = [PREF.cols.map(k => cel(CMAP[k][1])).join(sep)]
    .concat(rows.map(d => PREF.cols.map(k => {
      const t = CMAP[k][2];
      if (t === 'num' && d[k] != null) return cel(String(d[k]).replace('.', ','));
      if (t === 'date') return cel(A.fmtDate(d[k]) === '—' ? '' : A.fmtDate(d[k]));
      return cel(d[k]);
    }).join(sep)));
  const blob = new Blob(['﻿' + linhasCsv.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'propostas-' + A.today() + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

$('tbBusca').oninput = e => { BUSCA = e.target.value; render(); };
$('tbColsBtn').onclick = e => { e.stopPropagation(); popColunas(e.target); };
$('tbDens').onclick = () => { PREF.dens = PREF.dens === 'compacta' ? 'normal' : 'compacta'; salvarPref(); render(); };
$('tbQuebra').onclick = () => { PREF.quebra = !PREF.quebra; salvarPref(); render(); };
$('tbCsv').onclick = csv;
$('tbLimpar').onclick = () => { FILTROS = {}; BUSCA = ''; $('tbBusca').value = ''; render(); };

window.Tabela = { render, get filtros() { return FILTROS; } };
})();
