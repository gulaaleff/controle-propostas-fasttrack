/* Pré-Vendas Fast Track — app principal (dados no Supabase) */
(function () {
'use strict';

const cfg = window.APP_CONFIG;
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

// ---------- Domínio ----------
const FIELDS = [
  // [chave, rótulo, tipo, opções]
  ['cliente', 'Cliente', 'text'],
  ['projeto', 'Projeto', 'text'],
  ['demanda', 'Demanda', 'list', 'demanda'],
  ['prioridade', 'Priorização', 'list', 'prioridade'],
  ['status', 'Status PV', 'list', 'status'],
  ['status_bid', 'Status BID', 'list', 'status_bid'],
  ['lost_review', 'Lost Review', 'list', 'lost_review'],
  ['valor', 'Valor (R$)', 'number'],
  ['horas', 'Horas Totais', 'number'],
  ['arquiteto', 'Arquiteto', 'text'],
  ['comercial', 'Comercial', 'text'],
  ['hubspot', 'Hubspot', 'int'],
  ['chamado', 'Nº Chamado', 'int'],
  ['atividades', 'Atividades Pendentes', 'textarea'],
  ['data_prevista', 'Data Prevista', 'date'],
  ['dt_receb', 'DT Recebimento', 'date'],
  ['dt_inicio', 'DT Início PV', 'date'],
  ['dt_prevista', 'DT Prevista', 'date'],
  ['dt_v1', 'DT Entrega V1', 'date'],
  ['dt_final', 'DT Entrega vFinal', 'date'],
  ['qtd_versao', 'QTD Versionamento', 'int'],
  ['data_ganho_perdido', 'Data Ganho\\Perdido', 'date'],
  ['consultores', 'Consultores', 'text'],
  ['modulos', 'Módulos', 'text'],
  ['obs', 'OBS', 'textarea'],
];
const FMAP = Object.fromEntries(FIELDS.map(f => [f[0], f]));
const LISTS = {
  demanda: ['Fast-Track', 'AMS', 'Interno', 'Produto', 'Solution Center'],
  prioridade: ['Urgente', 'Alta', 'Média', 'Baixa', 'Em espera', 'N/A'],
  status: ['Novo', 'Em Andamento', 'Concluído', 'Parado', 'Cancelado'],
  status_bid: ['Em aberto', 'Revisão', 'Ganho', 'Perdido', 'Cancelado', 'N/A'],
  lost_review: ['N/A', 'TBD', 'Preço', 'Escopo', 'Prazo', 'Internalização', 'Escopo Não SAP', 'Opp Descontinuada', 'Outros'],
};
const BRL = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CO = { green: '#22c55e', red: '#ef4444', amber: '#f59e0b', accent: '#3b82f6', violet: '#8b5cf6', cyan: '#06b6d4', mut: '#93a0bd' };
const SBCOLOR = { 'Ganho': '#22c55e', 'Perdido': '#ef4444', 'Em aberto': '#f59e0b', 'Cancelado': '#64748b', 'Revisão': '#8b5cf6', 'N/A': '#475569' };
const ACTIVE_STATUS = ['Novo', 'Em Andamento'];

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = s => s ? s.split('-').reverse().join('/') : '—';
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const daysBetween = (a, b) => (!a || !b) ? null : Math.round((new Date(b) - new Date(a)) / 86400000);
const $ = id => document.getElementById(id);

let DATA = [], VIEW = 'dash', USER = null, channel = null;

// ---------- Toast ----------
let toastT = null;
function toast(msg, opts = {}) {
  const t = $('toast');
  t.className = 'show' + (opts.err ? ' err' : '');
  t.innerHTML = '<span>' + esc(msg) + '</span>';
  if (opts.undo) {
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'Desfazer';
    b.onclick = () => { t.className = ''; opts.undo(); };
    t.appendChild(b);
  }
  clearTimeout(toastT);
  toastT = setTimeout(() => t.className = '', opts.undo ? 7000 : 3500);
}

// ---------- Auth ----------
async function initAuth() {
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    $('lgBtn').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('lgEmail').value.trim(), password: $('lgPass').value });
    $('lgBtn').disabled = false;
    if (error) $('loginMsg').textContent = traduzErro(error.message);
  };
  $('lgSignup').onclick = async e => {
    e.preventDefault();
    const email = $('lgEmail').value.trim(), password = $('lgPass').value;
    if (!email || password.length < 6) { $('loginMsg').textContent = 'Preencha e-mail e uma senha com pelo menos 6 caracteres e clique em "Criar acesso".'; return; }
    const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin.startsWith('http') ? location.href.split('#')[0] : undefined } });
    $('loginMsg').textContent = error ? traduzErro(error.message) : 'Acesso criado. Confirme pelo link enviado ao seu e-mail e depois entre aqui.';
  };
  $('lgReset').onclick = async e => {
    e.preventDefault();
    const email = $('lgEmail').value.trim();
    if (!email) { $('loginMsg').textContent = 'Digite o e-mail e clique em "Esqueci a senha".'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    $('loginMsg').textContent = error ? traduzErro(error.message) : 'Enviamos um link para redefinir a senha.';
  };
  $('userBtn').onclick = logout;

  sb.auth.onAuthStateChange(async (ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') {
      const nova = prompt('Digite a nova senha (mínimo 6 caracteres):');
      if (nova) { const { error } = await sb.auth.updateUser({ password: nova }); toast(error ? traduzErro(error.message) : 'Senha alterada.', { err: !!error }); }
    }
    if (session && (!USER || USER.id !== session.user.id)) { USER = session.user; await onLogin(); }
    if (!session) { USER = null; $('login').style.display = 'flex'; }
  });
}
function traduzErro(m) {
  if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'E-mail ainda não confirmado. Abra o link que enviamos.';
  if (/already registered/i.test(m)) return 'Esse e-mail já tem acesso. Use "Entrar" ou "Esqueci a senha".';
  if (/rate limit/i.test(m)) return 'Muitas tentativas de envio de e-mail. Aguarde alguns minutos.';
  return m;
}
async function logout() { await sb.auth.signOut(); location.reload(); }

async function onLogin() {
  $('login').style.display = 'none';
  $('userBtn').title = 'Sair (' + USER.email + ')';
  const { data: perm } = await sb.from('usuarios_permitidos').select('email').maybeSingle();
  if (!perm) { $('naEmail').textContent = USER.email; $('noAccess').style.display = 'flex'; return; }
  await load();
  subscribe();
}

// ---------- Dados ----------
async function load() {
  $('stamp').textContent = 'carregando…';
  const { data, error } = await sb.from('propostas').select('*').eq('excluido', false).order('dt_receb', { ascending: false, nullsFirst: false }).range(0, 9999);
  if (error) { toast('Erro ao carregar: ' + error.message, { err: true }); return; }
  DATA = data.map(norm);
  buildFilters();
  stamp();
  render();
}
function norm(d) { ['valor', 'horas'].forEach(k => d[k] = d[k] == null ? null : Number(d[k])); return d; }
function stamp() { $('stamp').textContent = DATA.length + ' propostas · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

function subscribe() {
  if (channel) return;
  channel = sb.channel('propostas-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'propostas' }, p => {
      const row = p.new && p.new.id ? norm(p.new) : null;
      const i = DATA.findIndex(d => d.id === (row ? row.id : p.old.id));
      if (row && row.excluido) { if (i >= 0) DATA.splice(i, 1); }
      else if (row && i >= 0) DATA[i] = row;
      else if (row) DATA.unshift(row);
      stamp();
      scheduleRender();
    }).subscribe();
}
let rT = null;
function scheduleRender() { clearTimeout(rT); rT = setTimeout(() => { if (!$('drawer').classList.contains('open')) render(); }, 250); }

async function update(id, changes, origem = 'web') {
  const before = DATA.find(d => d.id === id);
  const prev = {}; Object.keys(changes).forEach(k => prev[k] = before ? before[k] : null);
  const { data, error } = await sb.from('propostas').update({ ...changes, origem }).eq('id', id).select().single();
  if (error) { toast('Não salvou: ' + error.message, { err: true }); return null; }
  const i = DATA.findIndex(d => d.id === id); if (i >= 0) DATA[i] = norm(data);
  render();
  return { row: data, prev };
}
async function insert(row, origem = 'web') {
  const { data, error } = await sb.from('propostas').insert({ ...row, origem }).select().single();
  if (error) { toast('Não salvou: ' + error.message, { err: true }); return null; }
  if (!DATA.find(d => d.id === data.id)) DATA.unshift(norm(data));
  buildFilters(); render();
  return data;
}
function label(d) { return (d.cliente || '—') + ' · ' + (d.projeto || ''); }

// ---------- Filtros ----------
const F = { mes: '', demanda: '', comercial: '', arquiteto: '', status_bid: '', status: '', modulo: '' };
let SEARCH = '';
const uniq = k => [...new Set(DATA.map(d => d[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
function modulosList() { const s = new Set(); DATA.forEach(d => (d.modulos || '').split(',').forEach(m => { m = m.trim(); if (m) s.add(m); })); return [...s].sort(); }
function meses() { const s = new Set(); DATA.forEach(d => { if (d.dt_receb) s.add(d.dt_receb.slice(0, 7)); }); return [...s].sort(); }
function buildFilters() {
  const DEF = [
    ['mes', 'Mês (receb.)', meses().map(m => [m, MESES[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4)])],
    ['demanda', 'Tipo Demanda', uniq('demanda').map(v => [v, v])],
    ['status', 'Status PV', uniq('status').map(v => [v, v])],
    ['status_bid', 'Status BID', uniq('status_bid').map(v => [v, v])],
    ['comercial', 'Comercial', uniq('comercial').map(v => [v, v])],
    ['arquiteto', 'Arquiteto', uniq('arquiteto').map(v => [v, v])],
    ['modulo', 'Módulo', modulosList().map(v => [v, v])],
  ];
  const fc = $('filters'); fc.innerHTML = '';
  DEF.forEach(([k, lbl, opts]) => {
    const l = document.createElement('label'); l.textContent = lbl;
    const s = document.createElement('select');
    s.innerHTML = '<option value="">Todos</option>' + opts.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('');
    s.value = F[k]; s.onchange = () => { F[k] = s.value; render(); };
    l.appendChild(s); fc.appendChild(l);
  });
  const sl = document.createElement('label'); sl.textContent = 'Busca';
  const si = document.createElement('input'); si.className = 'search'; si.placeholder = 'cliente, projeto, comercial…'; si.value = SEARCH;
  si.oninput = () => { SEARCH = si.value; render(); };
  sl.appendChild(si); fc.appendChild(sl);
  const rb = document.createElement('button'); rb.className = 'btn primary'; rb.textContent = 'Limpar';
  rb.onclick = () => { Object.keys(F).forEach(k => F[k] = ''); SEARCH = ''; buildFilters(); render(); };
  fc.appendChild(rb);
}
function filtered() {
  const q = SEARCH.toLowerCase();
  return DATA.filter(d => {
    if (F.mes && (d.dt_receb || '').slice(0, 7) !== F.mes) return false;
    for (const k of ['demanda', 'status_bid', 'status', 'comercial', 'arquiteto']) if (F[k] && d[k] !== F[k]) return false;
    if (F.modulo && !(d.modulos || '').split(',').map(x => x.trim()).includes(F.modulo)) return false;
    if (q && ![d.cliente, d.projeto, d.comercial, d.arquiteto, d.modulos, d.atividades, d.obs, d.hubspot].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---------- Views ----------
function setView(v) {
  VIEW = v;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ['dash', 'pend', 'lost', 'kb', 'hist'].forEach(x => $('v-' + x).style.display = x === v ? 'block' : 'none');
  $('filters').style.display = v === 'hist' ? 'none' : 'flex';
  render();
}
let CH = {};
function draw(id, c) { if (CH[id]) CH[id].destroy(); CH[id] = new Chart($(id), c); }
function render() {
  if (!USER) return;
  const rows = filtered();
  if (VIEW === 'dash') renderDash(rows);
  else if (VIEW === 'pend') renderPend(rows);
  else if (VIEW === 'lost') renderLost(rows);
  else if (VIEW === 'kb') renderKanban(rows);
  else if (VIEW === 'hist') renderHist();
}
function kpiHtml(list) { return list.map(a => '<div class="kpi"><div class="bar" style="background:' + a[3] + '"></div><div class="lbl">' + a[0] + '</div><div class="val">' + a[1] + '</div><div class="foot">' + a[2] + '</div></div>').join(''); }
const sumV = arr => arr.reduce((s, d) => s + (d.valor || 0), 0);
const hbar = (color) => ({ indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: '#222b42' }, ticks: { precision: 0 } }, y: { grid: { display: false } } } });

function renderDash(rows) {
  const n = rows.length;
  const ganho = rows.filter(d => d.status_bid === 'Ganho'), perdido = rows.filter(d => d.status_bid === 'Perdido');
  const aberto = rows.filter(d => d.status_bid === 'Em aberto'), cancel = rows.filter(d => d.status_bid === 'Cancelado');
  const emExec = rows.filter(d => ['Novo', 'Em Andamento', 'Revisão'].includes(d.status));
  const dec = ganho.length + perdido.length;
  const conv = n ? ganho.length / n : 0, win = dec ? ganho.length / dec : 0, perda = n ? perdido.length / n : 0;
  const tempos = ganho.map(d => daysBetween(d.dt_receb, d.data_ganho_perdido)).filter(x => x != null && x >= 0);
  const tmedio = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : 0;
  const rec = rows.map(d => d.dt_receb ? new Date(d.dt_receb).getTime() : null).filter(x => x != null);
  const ref = rec.length ? Math.max(...rec) : null;
  const maduras = (ref != null && tmedio > 0) ? rows.filter(d => d.dt_receb && new Date(d.dt_receb).getTime() <= ref - tmedio * 86400000) : rows;
  const convReal = maduras.length ? maduras.filter(d => d.status_bid === 'Ganho').length / maduras.length : 0;
  $('kpis').innerHTML = kpiHtml([
    ['Total de Propostas', n, 'no filtro atual', CO.accent],
    ['Pipeline Total', BRL(sumV(rows)), rows.filter(d => d.valor).length + ' com valor', CO.cyan],
    ['Em Negociação', aberto.length, BRL(sumV(aberto)), CO.amber],
    ['Em Execução', emExec.length, 'Novo · Em Andam. · Revisão', CO.cyan],
    ['Ganhas', ganho.length, BRL(sumV(ganho)), CO.green],
    ['Perdidas', perdido.length, BRL(sumV(perdido)), CO.red],
    ['Taxa de Conversão', (conv * 100).toFixed(1) + '%', 'ganhas ÷ total · win rate ' + (win * 100).toFixed(0) + '%', CO.violet],
    ['Conversão Real', (convReal * 100).toFixed(1) + '%', 'exclui ' + (n - maduras.length) + ' recentes (< ' + tmedio + 'd)', CO.green],
    ['Taxa de Perda', (perda * 100).toFixed(1) + '%', perdido.length + ' ÷ ' + n, CO.red],
    ['Ticket Médio', BRL(n ? sumV(rows) / n : 0), 'pipeline ÷ total', CO.cyan],
    ['Tempo Médio Conversão', tmedio + ' d', 'receb.→ganho (n=' + tempos.length + ')', CO.green],
  ]);
  const ms = meses();
  draw('cMes', { type: 'bar', data: { labels: ms.map(m => MESES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4)), datasets: [
    { label: 'Recebidas', data: ms.map(m => rows.filter(d => (d.dt_receb || '').slice(0, 7) === m).length), backgroundColor: CO.accent, borderRadius: 4 },
    { label: 'Ganhas', data: ms.map(m => ganho.filter(d => (d.data_ganho_perdido || d.dt_receb || '').slice(0, 7) === m).length), backgroundColor: CO.green, borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, grid: { color: '#222b42' } }, x: { grid: { display: false } } } } });
  draw('cFunil', { type: 'bar', data: { labels: ['Em execução', 'Em aberto', 'Ganho', 'Perdido', 'Cancelado'], datasets: [{ data: [emExec.length, aberto.length, ganho.length, perdido.length, cancel.length], backgroundColor: [CO.cyan, CO.amber, CO.green, CO.red, '#64748b'], borderRadius: 4 }] }, options: hbar() });
  const lr = {}; perdido.forEach(d => { const k = d.lost_review && d.lost_review !== 'N/A' ? d.lost_review : 'Não classif.'; lr[k] = (lr[k] || 0) + 1; });
  draw('cPerda', { type: 'doughnut', data: { labels: Object.keys(lr), datasets: [{ data: Object.values(lr), backgroundColor: [CO.red, CO.amber, CO.violet, CO.cyan, CO.mut, CO.accent, CO.green] }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  draw('cValor', { type: 'bar', data: { labels: ['Em aberto', 'Ganho', 'Perdido', 'Cancelado'], datasets: [{ data: [sumV(aberto), sumV(ganho), sumV(perdido), sumV(cancel)], backgroundColor: [CO.amber, CO.green, CO.red, '#64748b'], borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => BRL(c.raw) } } }, scales: { y: { beginAtZero: true, grid: { color: '#222b42' }, ticks: { callback: v => v >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : 'R$ ' + Math.round(v / 1000) + ' mil' } }, x: { grid: { display: false } } } } });
  const dm = {}; rows.forEach(d => { const k = d.demanda || '—'; dm[k] = (dm[k] || 0) + 1; });
  draw('cDemanda', { type: 'pie', data: { labels: Object.keys(dm), datasets: [{ data: Object.values(dm), backgroundColor: [CO.accent, CO.cyan, CO.violet, CO.amber, CO.mut] }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  const top = (key, src, split) => { const m = {}; src.forEach(d => (split ? (d[key] || '').split(',') : [d[key]]).forEach(x => { x = (x || '').trim(); if (x) m[x] = (m[x] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10); };
  const cm = top('comercial', rows), md = top('modulos', rows, true);
  draw('cComercial', { type: 'bar', data: { labels: cm.map(x => x[0]), datasets: [{ data: cm.map(x => x[1]), backgroundColor: CO.cyan, borderRadius: 4 }] }, options: hbar() });
  draw('cModulo', { type: 'bar', data: { labels: md.map(x => x[0]), datasets: [{ data: md.map(x => x[1]), backgroundColor: CO.violet, borderRadius: 4 }] }, options: hbar() });
  renderTable(rows);
}

const COLS = [['cliente', 'Cliente'], ['projeto', 'Projeto'], ['demanda', 'Demanda'], ['status', 'Status PV'], ['status_bid', 'Status BID'], ['comercial', 'Comercial'], ['valor', 'Valor'], ['horas', 'Horas'], ['dt_receb', 'Recebido'], ['atividades', 'Pendência']];
let sortKey = 'dt_receb', sortDir = -1;
function pill(v) { const c = SBCOLOR[v] || '#93a0bd'; return '<span class="pill" style="background:' + c + '22;color:' + c + '">' + esc(v || '—') + '</span>'; }
function renderTable(rows) {
  $('thead').innerHTML = COLS.map(c => '<th data-k="' + c[0] + '">' + c[1] + (sortKey === c[0] ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('');
  document.querySelectorAll('#thead th').forEach(th => th.onclick = () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; } render(); });
  const s = [...rows].sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * sortDir; });
  $('tbody').innerHTML = s.map(d => '<tr data-id="' + d.id + '"><td title="' + esc(d.cliente) + '">' + esc(d.cliente || '—') + '</td><td title="' + esc(d.projeto) + '">' + esc(d.projeto || '—') + '</td><td>' + esc(d.demanda || '—') + '</td><td>' + esc(d.status || '—') + '</td><td>' + pill(d.status_bid) + '</td><td>' + esc(d.comercial || '—') + '</td><td class="num">' + (d.valor ? BRL(d.valor) : '—') + '</td><td class="num">' + (d.horas != null ? d.horas : '—') + '</td><td>' + fmtDate(d.dt_receb) + '</td><td title="' + esc(d.atividades) + '">' + esc(d.atividades || '') + '</td></tr>').join('');
  $('tblCount').textContent = '(' + rows.length + ')';
}

function itemHtml(d, extra) {
  return '<div class="item" data-id="' + d.id + '"><div class="t">' + esc(d.cliente || '—') + '</div><div class="p">' + esc(d.projeto || '') + '</div>' + (extra || '') +
    '<div class="f"><span>' + esc(d.comercial || '') + ' · ' + esc(d.status || '') + ' / ' + esc(d.status_bid || '') + '</span><span>' + (d.valor ? BRL(d.valor) : '') + '</span></div></div>';
}
function listInto(id, arr, extraFn) { $(id).innerHTML = arr.length ? arr.map(d => itemHtml(d, extraFn && extraFn(d))).join('') : '<div class="empty">Nada por aqui.</div>'; }
const PRIO = { 'Urgente': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3, 'Em espera': 4 };
function renderPend(rows) {
  const hoje = today();
  const ativ = rows.filter(d => d.atividades && d.status !== 'Cancelado').sort((a, b) => (PRIO[a.prioridade] ?? 9) - (PRIO[b.prioridade] ?? 9));
  const elab = rows.filter(d => ACTIVE_STATUS.includes(d.status)).sort((a, b) => (PRIO[a.prioridade] ?? 9) - (PRIO[b.prioridade] ?? 9) || String(a.dt_receb).localeCompare(String(b.dt_receb)));
  const dias = +$('fuDias').value || 7;
  const follow = rows.filter(d => d.status_bid === 'Em aberto' && (d.dt_final || d.dt_v1) && !ACTIVE_STATUS.includes(d.status))
    .map(d => ({ d, idade: daysBetween(d.dt_final || d.dt_v1, hoje) }))
    .filter(x => x.idade >= dias && x.idade <= 90).sort((a, b) => a.idade - b.idade);
  const lim = new Date(); lim.setDate(lim.getDate() + 3); const limS = lim.toISOString().slice(0, 10);
  const ini = new Date(); ini.setDate(ini.getDate() - 30); const iniS = ini.toISOString().slice(0, 10);
  const prazo = rows.filter(d => ACTIVE_STATUS.includes(d.status) && (d.data_prevista || d.dt_prevista) && (d.data_prevista || d.dt_prevista) <= limS && (d.data_prevista || d.dt_prevista) >= iniS)
    .sort((a, b) => String(a.data_prevista || a.dt_prevista).localeCompare(String(b.data_prevista || b.dt_prevista)));
  $('pendKpis').innerHTML = kpiHtml([
    ['Com atividade pendente', ativ.length, 'coluna Atividades Pendentes', CO.amber],
    ['Em elaboração', elab.length, 'Novo + Em Andamento', CO.cyan],
    ['Urgentes / Altas', elab.filter(d => ['Urgente', 'Alta'].includes(d.prioridade)).length, 'entre as em elaboração', CO.red],
    ['Follow-ups sugeridos', follow.length, 'sem movimento ≥ ' + dias + ' dias', CO.violet],
    ['Prazos a vencer', prazo.length, 'em elaboração · vencidos (30d) ou em até 3 dias', CO.red],
  ]);
  $('pAtivCount').textContent = '(' + ativ.length + ')';
  $('pElabCount').textContent = '(' + elab.length + ')';
  listInto('pAtiv', ativ, d => '<div class="a">' + esc(d.atividades) + '</div>');
  $('pFollow').innerHTML = follow.length ? follow.map(x => itemHtml(x.d, '<div class="a">Última entrega em ' + fmtDate(x.d.dt_final || x.d.dt_v1) + ' · <b>' + x.idade + ' dias</b>' + (x.d.obs ? '\n' + esc(x.d.obs) : '') + '</div>')).join('') : '<div class="empty">Nenhum follow-up nesse intervalo.</div>';
  listInto('pElab', elab, d => '<div class="a">' + esc(d.prioridade || 'Sem prioridade') + ' · recebido ' + fmtDate(d.dt_receb) + '</div>');
  listInto('pPrazo', prazo, d => { const p = d.data_prevista || d.dt_prevista; return '<div class="a">Prazo ' + fmtDate(p) + (p < hoje ? ' · <b style="color:var(--red)">vencido</b>' : '') + '</div>'; });
}
$('fuDias') && ($('fuDias').oninput = () => render());

function renderLost(rows) {
  const lost = rows.filter(d => d.status_bid === 'Perdido').sort((a, b) => (b.valor || 0) - (a.valor || 0));
  const tot = sumV(lost), comV = lost.filter(d => d.valor);
  const mot = {}; lost.forEach(d => { const k = d.lost_review && d.lost_review !== 'N/A' ? d.lost_review : 'Não classif.'; mot[k] = (mot[k] || 0) + 1; });
  const topM = Object.entries(mot).sort((a, b) => b[1] - a[1])[0];
  $('lostKpis').innerHTML = kpiHtml([
    ['Propostas Perdidas', lost.length, 'no filtro atual', CO.red],
    ['Valor Total Perdido', BRL(tot), comV.length + ' com valor', CO.red],
    ['Ticket Médio Perdido', BRL(comV.length ? tot / comV.length : 0), comV.length + ' propostas', CO.amber],
    ['Principal Motivo', topM ? esc(topM[0]) : '—', topM ? topM[1] + ' caso(s)' : '', CO.violet],
  ]);
  draw('cPerdaTab', { type: 'doughnut', data: { labels: Object.keys(mot), datasets: [{ data: Object.values(mot), backgroundColor: [CO.red, CO.amber, CO.violet, CO.cyan, CO.mut, CO.accent, CO.green] }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  const cm = {}; lost.forEach(d => { if (d.comercial) cm[d.comercial] = (cm[d.comercial] || 0) + 1; });
  const cmS = Object.entries(cm).sort((a, b) => b[1] - a[1]).slice(0, 10);
  draw('cPerdaCom', { type: 'bar', data: { labels: cmS.map(x => x[0]), datasets: [{ data: cmS.map(x => x[1]), backgroundColor: CO.red, borderRadius: 4 }] }, options: hbar() });
  $('lostCount').textContent = '(' + lost.length + ' · ' + BRL(tot) + ')';
  $('lostBody').innerHTML = lost.length ? lost.map(d => '<tr data-id="' + d.id + '"><td>' + esc(d.cliente || '—') + '</td><td class="wrap">' + esc(d.projeto || '—') + '</td><td class="num">' + (d.valor ? BRL(d.valor) : '—') + '</td><td>' + esc(d.comercial || '—') + '</td><td>' + fmtDate(d.data_ganho_perdido) + '</td><td>' + pill(d.lost_review && d.lost_review !== 'N/A' ? d.lost_review : 'Não classif.') + '</td><td class="wrap">' + esc(d.obs || '—') + '</td></tr>').join('')
    : '<tr><td colspan="7" class="empty">Nenhuma proposta perdida no filtro atual.</td></tr>';
}

const ORDER = { status_bid: LISTS.status_bid, status: LISTS.status, prioridade: LISTS.prioridade };
function renderKanban(rows) {
  const g = $('kbGroup').value;
  if ($('kbScope').value === 'ativas') rows = rows.filter(d => !(['Concluído', 'Cancelado'].includes(d.status) && d.status_bid !== 'Em aberto' && d.status_bid !== 'Revisão'));
  const groups = {}; rows.forEach(d => { const k = d[g] || '—'; (groups[k] = groups[k] || []).push(d); });
  let cols = (ORDER[g] || []).slice();
  Object.keys(groups).sort().forEach(k => { if (!cols.includes(k)) cols.push(k); });
  if (!ORDER[g]) cols = cols.filter(c => groups[c]);
  const board = $('board'); board.innerHTML = '';
  cols.forEach(c => {
    const items = (groups[c] || []).sort((a, b) => (b.valor || 0) - (a.valor || 0));
    const col = document.createElement('div'); col.className = 'col'; col.dataset.col = c;
    col.innerHTML = '<div class="colhead"><div class="nm"><span class="dot" style="background:' + (SBCOLOR[c] || '#64748b') + '"></span>' + esc(c) + '</div><span class="cnt">' + items.length + '</span></div><div class="colval">' + BRL(sumV(items)) + '</div><div class="cards"></div>';
    const cc = col.querySelector('.cards');
    items.forEach(d => {
      const k = document.createElement('div'); k.className = 'kcard'; k.draggable = true; k.dataset.id = d.id;
      k.style.borderLeftColor = SBCOLOR[d.status_bid] || '#3b82f6';
      const mods = (d.modulos || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 4).map(m => '<span class="chip">' + esc(m) + '</span>').join('');
      k.innerHTML = '<div class="t">' + esc(d.cliente || '—') + '</div><div class="p">' + esc(d.projeto || '') + '</div>' + (mods ? '<div class="chips">' + mods + '</div>' : '') +
        '<div class="kfoot"><span>' + esc(d.comercial || '') + '</span><span class="kval">' + (d.valor ? BRL(d.valor) : '') + '</span></div>' +
        '<div class="kfoot" style="margin-top:4px"><span>' + esc(d.status || '') + (d.prioridade && d.prioridade !== 'N/A' ? ' · ' + esc(d.prioridade) : '') + '</span><span>' + fmtDate(d.dt_receb) + '</span></div>';
      k.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', d.id); k.style.opacity = '.4'; });
      k.addEventListener('dragend', () => k.style.opacity = '1');
      cc.appendChild(k);
    });
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag'));
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.classList.remove('drag');
      const id = e.dataTransfer.getData('text/plain'); const d = DATA.find(x => x.id === id);
      const novo = c === '—' ? null : c;
      if (!d || d[g] === novo) return;
      const ch = { [g]: novo };
      if (g === 'status_bid' && ['Ganho', 'Perdido'].includes(novo) && !d.data_ganho_perdido) ch.data_ganho_perdido = today();
      const r = await update(id, ch);
      if (r) toast(label(d) + ' → ' + FMAP[g][1] + ': ' + (novo || '—'), { undo: () => update(id, r.prev) });
    });
    board.appendChild(col);
  });
}
$('kbGroup').onchange = render; $('kbScope').onchange = render;

async function renderHist() {
  $('histBody').innerHTML = '<tr><td colspan="5" class="empty">Carregando…</td></tr>';
  const { data, error } = await sb.from('propostas_log').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) { $('histBody').innerHTML = '<tr><td colspan="5" class="empty">' + esc(error.message) + '</td></tr>'; return; }
  const byId = Object.fromEntries(DATA.map(d => [d.id, d]));
  $('histBody').innerHTML = data.length ? data.map(h => {
    const p = byId[h.proposta_id];
    let alt = '';
    if (h.acao === 'insert') alt = 'Nova proposta';
    else alt = Object.entries(h.alteracoes || {}).filter(([k]) => FMAP[k]).map(([k, v]) => FMAP[k][1] + ': ' + (v.de ?? '—') + ' → ' + (v.para ?? '—')).join(' · ');
    return '<tr data-id="' + h.proposta_id + '"><td>' + new Date(h.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + '</td><td title="' + esc(p ? label(p) : '') + '">' + esc(p ? label(p) : h.proposta_id) + '</td><td>' + esc(h.origem || '') + '</td><td>' + esc(h.usuario || '') + '</td><td class="wrap">' + esc(alt) + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">Nenhuma alteração registrada ainda.</td></tr>';
}
$('histReload').onclick = renderHist;

// ---------- Editor ----------
let EDIT = null;
function openEditor(id, preset) {
  const d = id ? DATA.find(x => x.id === id) : { arquiteto: 'Aleff Gulá', demanda: 'Fast-Track', status: 'Novo', status_bid: 'Em aberto', lost_review: 'TBD', prioridade: 'Média', qtd_versao: 1, dt_receb: today(), ...(preset || {}) };
  if (!d) return;
  EDIT = id || null;
  $('edTitle').textContent = id ? (d.cliente || 'Proposta') : 'Nova proposta';
  $('edSub').textContent = id ? (d.projeto || '') + (d.excel_row ? ' · linha ' + d.excel_row + ' da planilha' : ' · ainda não está na planilha') : 'Vai para a planilha na próxima sincronização';
  const sections = { cliente: 'Identificação', prioridade: 'Situação', valor: 'Comercial', atividades: 'Acompanhamento', data_prevista: 'Datas', consultores: 'Equipe' };
  const dl = k => { const vals = uniq(k); return vals.length ? '<datalist id="dl_' + k + '">' + vals.map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>' : ''; };
  $('edForm').innerHTML = FIELDS.map(([k, lbl, t, lst]) => {
    let h = sections[k] ? '<div class="sec">' + sections[k] + '</div>' : '';
    const v = d[k] == null ? '' : d[k];
    const full = ['projeto', 'atividades', 'obs', 'consultores', 'modulos', 'cliente'].includes(k) ? ' full' : '';
    if (t === 'list') {
      const opts = LISTS[lst].slice(); if (v && !opts.includes(v)) opts.push(v);
      h += '<label>' + lbl + '<select name="' + k + '"><option value=""></option>' + opts.map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></label>';
    } else if (t === 'textarea') h += '<label class="full">' + lbl + '<textarea name="' + k + '">' + esc(v) + '</textarea></label>';
    else if (t === 'date') h += '<label>' + lbl + '<input type="date" name="' + k + '" value="' + esc(v) + '"></label>';
    else if (t === 'number' || t === 'int') h += '<label>' + lbl + '<input type="number" step="' + (t === 'int' ? '1' : '0.01') + '" name="' + k + '" value="' + esc(v) + '"></label>';
    else h += '<label class="' + full.trim() + '">' + lbl + '<input name="' + k + '" value="' + esc(v) + '"' + (['cliente', 'comercial', 'arquiteto'].includes(k) ? ' list="dl_' + k + '"' : '') + '></label>' + (['cliente', 'comercial', 'arquiteto'].includes(k) ? dl(k) : '');
    return h;
  }).join('');
  $('drawer').classList.add('open');
  setTimeout(() => $('edForm').querySelector(id ? '[name=status]' : '[name=cliente]').focus(), 50);
}
function closeEditor() { $('drawer').classList.remove('open'); EDIT = null; render(); }
function readForm() {
  const out = {};
  FIELDS.forEach(([k, , t]) => {
    const el = $('edForm').querySelector('[name="' + k + '"]'); let v = el.value.trim();
    if (v === '') v = null;
    else if (t === 'number') v = Number(v);
    else if (t === 'int') v = parseInt(v, 10);
    out[k] = v;
  });
  return out;
}
$('edSave').onclick = async () => {
  const f = readForm();
  if (!f.cliente && !f.projeto) { toast('Informe ao menos cliente ou projeto.', { err: true }); return; }
  $('edSave').disabled = true;
  if (EDIT) {
    const d = DATA.find(x => x.id === EDIT); const ch = {};
    Object.keys(f).forEach(k => { if ((d[k] ?? null) !== f[k]) ch[k] = f[k]; });
    if (Object.keys(ch).length) { const id = EDIT; const r = await update(id, ch); if (r) toast('Salvo: ' + Object.keys(ch).map(k => FMAP[k][1]).join(', '), { undo: () => update(id, r.prev) }); }
  } else {
    const r = await insert(f); if (r) toast('Proposta criada: ' + label(r));
  }
  $('edSave').disabled = false;
  closeEditor();
};
$('edCancel').onclick = closeEditor; $('edClose').onclick = closeEditor;
$('newBtn').onclick = () => openEditor(null);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('drawer').classList.contains('open')) closeEditor(); });
document.addEventListener('click', e => {
  const el = e.target.closest('tr[data-id], .item[data-id], .kcard[data-id]');
  if (el && !e.target.closest('.chat')) openEditor(el.dataset.id);
});
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); };

// ---------- API p/ chat ----------
window.App = { sb, get data() { return DATA; }, FIELDS, FMAP, LISTS, update, insert, openEditor, setView, toast, esc, BRL, fmtDate, today, daysBetween, label, logout, ACTIVE_STATUS };

initAuth();
})();
