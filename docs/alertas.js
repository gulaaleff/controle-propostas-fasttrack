/* Alertas das demandas em andamento: lembrete por demanda, parada há X dias, prazo e pendência parada. */
(function () {
'use strict';
const A = window.App, sb = A.sb;
const $ = id => document.getElementById(id);
const esc = A.esc;

const PADRAO = {
  escopo: { novo: true, andamento: true, revisao: true, ignorarDecididas: true },
  lembrete: { ativo: true },
  parada: { ativo: true, limite: 120, dias: { 'Urgente': 1, 'Alta': 3, 'Média': 5, 'Baixa': 10, 'Em espera': 0, 'N/A': 7 } },
  prazo: { ativo: true, antes: 2, limiteVencido: 45 },
  pendencia: { ativo: true, dias: 5 },
};
const PRIOS = ['Urgente', 'Alta', 'Média', 'Baixa', 'Em espera', 'N/A'];
const REGRAS = {
  lembrete: 'Lembrete',
  parada: 'Parada',
  prazo: 'Prazo',
  pendencia: 'Pendência',
};
let CFG = JSON.parse(JSON.stringify(PADRAO));
let BAIXAS = {};   // "propostaId|regra" -> { adiado_ate, resolvido_em }
let notificados = new Set(JSON.parse(localStorage.getItem('alertasNotificados') || '[]'));

function mescla(base, novo) {
  const out = JSON.parse(JSON.stringify(base));
  Object.keys(novo || {}).forEach(k => {
    if (novo[k] && typeof novo[k] === 'object' && !Array.isArray(novo[k])) out[k] = mescla(out[k] || {}, novo[k]);
    else out[k] = novo[k];
  });
  return out;
}
async function carregar() {
  const email = A.user.email;
  const [cfg, bx] = await Promise.all([
    sb.from('alertas_config').select('regras').eq('email', email).maybeSingle(),
    sb.from('alertas_baixa').select('*').eq('usuario', email),
  ]);
  if (cfg.data && cfg.data.regras) CFG = mescla(PADRAO, cfg.data.regras);
  BAIXAS = {};
  (bx.data || []).forEach(b => BAIXAS[b.proposta_id + '|' + b.regra] = b);
  desenhaConfig();
  atualizarContador();
}
let salvarT = null;
function salvarConfig() {
  clearTimeout(salvarT);
  $('cfgSalvo').textContent = 'salvando…';
  salvarT = setTimeout(async () => {
    const { error } = await sb.from('alertas_config').upsert({ email: A.user.email, regras: CFG, atualizado_em: new Date().toISOString() });
    $('cfgSalvo').textContent = error ? 'não salvou' : 'salvo';
    if (error) A.toast('Configuração não salva: ' + error.message, { err: true });
    setTimeout(() => $('cfgSalvo').textContent = '', 2500);
  }, 600);
}

// ---------- Cálculo ----------
const hoje = () => A.today();
function ultimaMov(d) {
  const datas = [d.updated_at ? d.updated_at.slice(0, 10) : null, d.dt_final, d.dt_v1, d.dt_inicio, d.dt_receb].filter(Boolean);
  return datas.sort().pop() || null;
}
function ativa(d) {
  if (CFG.escopo.ignorarDecididas && ['Ganho', 'Perdido', 'Cancelado'].includes(d.status_bid)) return false;
  return (CFG.escopo.novo && d.status === 'Novo')
    || (CFG.escopo.andamento && d.status === 'Em Andamento')
    || (CFG.escopo.revisao && d.status_bid === 'Revisão');
}
function vigente(id, regra, d) {
  const b = BAIXAS[id + '|' + regra];
  if (!b) return true;
  if (b.adiado_ate && b.adiado_ate >= hoje()) return false;
  if (b.resolvido_em && d.updated_at && new Date(d.updated_at) <= new Date(b.resolvido_em)) return false;
  if (b.resolvido_em && !d.updated_at) return false;
  return true;
}
function calcular() {
  const H = hoje(), lista = [];
  A.data.forEach(d => {
    if (!ativa(d)) return;
    const add = (regra, nivel, titulo, detalhe, ordem) => {
      if (!vigente(d.id, regra, d)) return;
      lista.push({ id: d.id + '|' + regra, regra, nivel, titulo, detalhe, ordem, d });
    };
    if (CFG.lembrete.ativo && d.lembrete_em && d.lembrete_em <= H) {
      const atraso = A.daysBetween(d.lembrete_em, H);
      add('lembrete', atraso > 0 ? 'alto' : 'medio',
        atraso > 0 ? 'Lembrete de ' + A.fmtDate(d.lembrete_em) + ' (há ' + atraso + ' dias)' : 'Lembrete para hoje',
        d.lembrete_nota || '', -1000 - atraso);
    }
    if (CFG.parada.ativo) {
      const lim = Number(CFG.parada.dias[d.prioridade || 'N/A'] ?? CFG.parada.dias['N/A']) || 0;
      const mov = ultimaMov(d);
      if (lim > 0 && mov) {
        const idade = A.daysBetween(mov, H);
        if (idade >= lim && idade <= Number(CFG.parada.limite || 9999)) add('parada', idade >= lim * 2 ? 'alto' : 'medio',
          'Parada há ' + idade + ' dias', 'Prioridade ' + (d.prioridade || 'N/A') + ' · limite de ' + lim + ' dias · última movimentação em ' + A.fmtDate(mov), -idade);
      }
    }
    if (CFG.prazo.ativo) {
      const p = d.data_prevista || d.dt_prevista;
      if (p) {
        const faltam = A.daysBetween(H, p);
        if (faltam <= Number(CFG.prazo.antes || 0) && -faltam <= Number(CFG.prazo.limiteVencido || 9999)) add('prazo', faltam < 0 ? 'alto' : 'medio',
          faltam < 0 ? 'Prazo vencido há ' + (-faltam) + ' dias' : (faltam === 0 ? 'Prazo é hoje' : 'Prazo em ' + faltam + ' dias'),
          'Data prevista ' + A.fmtDate(p), -2000 - (-faltam));
      }
    }
    if (CFG.pendencia.ativo && d.atividades) {
      const mov = ultimaMov(d), lim = Number(CFG.pendencia.dias || 0);
      if (mov && lim > 0) {
        const idade = A.daysBetween(mov, H);
        if (idade >= lim) add('pendencia', idade >= lim * 2 ? 'alto' : 'medio',
          'Pendência parada há ' + idade + ' dias', d.atividades, -idade);
      }
    }
  });
  return lista.sort((a, b) => (a.nivel === b.nivel ? a.ordem - b.ordem : (a.nivel === 'alto' ? -1 : 1)));
}

// ---------- Contador e notificações ----------
function atualizarContador() {
  if (!A.user) return;
  const n = calcular().length;
  const bell = $('bellCount'), tab = $('tabAlertaCount');
  bell.textContent = n; bell.classList.toggle('on', n > 0);
  tab.textContent = n; tab.classList.toggle('on', n > 0);
  notificar();
}
function notificar() {
  if (localStorage.getItem('alertasNotif') !== '1' || !('Notification' in window) || Notification.permission !== 'granted') return;
  const novos = calcular().filter(a => a.nivel === 'alto' && !notificados.has(a.id));
  if (!novos.length) return;
  novos.slice(0, 3).forEach(a => {
    try { new Notification(a.titulo, { body: A.label(a.d), tag: a.id }); } catch (e) { /* ignora */ }
  });
  if (novos.length > 3) { try { new Notification('+' + (novos.length - 3) + ' outros alertas', { tag: 'resto' }); } catch (e) {} }
  novos.forEach(a => notificados.add(a.id));
  try { localStorage.setItem('alertasNotificados', JSON.stringify([...notificados].slice(-300))); } catch (e) {}
}
$('notifBtn').onclick = async () => {
  if (!('Notification' in window)) { A.toast('Este navegador não tem notificações.', { err: true }); return; }
  if (localStorage.getItem('alertasNotif') === '1') {
    localStorage.setItem('alertasNotif', '0'); pintaNotifBtn(); A.toast('Notificações desligadas.'); return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { A.toast('O navegador bloqueou as notificações.', { err: true }); return; }
  localStorage.setItem('alertasNotif', '1'); pintaNotifBtn(); notificar();
  A.toast('Notificações ligadas enquanto o site estiver aberto.');
};
function pintaNotifBtn() {
  const on = localStorage.getItem('alertasNotif') === '1';
  $('notifBtn').textContent = on ? 'Desligar notificações do navegador' : 'Ativar notificações do navegador';
  $('notifBtn').classList.toggle('primary', on);
}

// ---------- Baixas ----------
async function baixa(a, campos) {
  const linha = { proposta_id: a.d.id, regra: a.regra, usuario: A.user.email, adiado_ate: null, resolvido_em: null, atualizado_em: new Date().toISOString(), ...campos };
  const { error } = await sb.from('alertas_baixa').upsert(linha);
  if (error) { A.toast('Não consegui gravar: ' + error.message, { err: true }); return; }
  BAIXAS[a.d.id + '|' + a.regra] = linha;
  render(); atualizarContador();
}
function adiar(a, dias) {
  const d = new Date(); d.setDate(d.getDate() + dias);
  baixa(a, { adiado_ate: d.toISOString().slice(0, 10) });
  A.toast('Adiado por ' + dias + (dias === 1 ? ' dia' : ' dias') + '.');
}
function resolver(a) {
  baixa(a, { resolvido_em: new Date().toISOString() });
  A.toast('Alerta resolvido. Ele volta se a proposta mudar.');
}

// ---------- Telas ----------
function render() {
  const lista = calcular();
  const altos = lista.filter(a => a.nivel === 'alto');
  const porRegra = r => lista.filter(a => a.regra === r).length;
  $('alertaKpis').innerHTML = [
    ['Alertas abertos', lista.length, altos.length + ' urgentes', '#f59e0b'],
    ['Lembretes', porRegra('lembrete'), 'definidos por você', '#8b5cf6'],
    ['Paradas', porRegra('parada'), 'sem movimento', '#ef4444'],
    ['Prazos', porRegra('prazo'), 'vencidos ou próximos', '#06b6d4'],
    ['Pendências', porRegra('pendencia'), 'atividade parada', '#22c55e'],
  ].map(a => '<div class="kpi"><div class="bar" style="background:' + a[3] + '"></div><div class="lbl">' + a[0] + '</div><div class="val">' + a[1] + '</div><div class="foot">' + a[2] + '</div></div>').join('');
  $('alertaCount').textContent = '(' + lista.length + ')';
  const box = $('alertaLista');
  if (!lista.length) { box.innerHTML = '<div class="empty">Nenhum alerta. Ajuste as regras ao lado se quiser avisos mais cedo.</div>'; return; }
  box.innerHTML = lista.map((a, i) => '<div class="item alerta ' + a.nivel + '" data-i="' + i + '">' +
    '<div class="h"><div class="t">' + esc(a.d.cliente || '—') + '</div><span class="tag">' + REGRAS[a.regra] + '</span></div>' +
    '<div class="p">' + esc(a.d.projeto || '') + '</div>' +
    '<div class="a"><b>' + esc(a.titulo) + '</b>' + (a.detalhe ? '\n' + esc(a.detalhe) : '') + '</div>' +
    '<div class="f"><span>' + esc(a.d.comercial || '') + ' · ' + esc(a.d.status || '') + ' / ' + esc(a.d.status_bid || '') + '</span><span>' + (a.d.valor ? A.BRL(a.d.valor) : '') + '</span></div>' +
    '<div class="acoes"><button class="btn sm" data-a="abrir">Abrir</button><button class="btn sm" data-a="1">Adiar 1d</button>' +
    '<button class="btn sm" data-a="3">Adiar 3d</button><button class="btn sm" data-a="7">Adiar 7d</button>' +
    '<button class="btn sm" data-a="ok">Resolver</button></div></div>').join('');
  box.querySelectorAll('.item').forEach(el => {
    const a = lista[+el.dataset.i];
    el.querySelectorAll('button').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const v = b.dataset.a;
      if (v === 'abrir') A.openEditor(a.d.id);
      else if (v === 'ok') resolver(a);
      else adiar(a, +v);
    });
  });
  pintaNotifBtn();
}

function desenhaConfig() {
  const num = (valor, min, max) => '<input type="number" value="' + valor + '" min="' + min + '" max="' + max + '">';
  $('cfgBox').innerHTML =
    '<div class="grupo" data-g="escopo"><label>Demandas consideradas</label>' +
      '<label><input type="checkbox" data-k="novo"' + (CFG.escopo.novo ? ' checked' : '') + '> Novo</label>' +
      '<label><input type="checkbox" data-k="andamento"' + (CFG.escopo.andamento ? ' checked' : '') + '> Em Andamento</label>' +
      '<label><input type="checkbox" data-k="revisao"' + (CFG.escopo.revisao ? ' checked' : '') + '> Status BID em Revisão</label>' +
      '<label><input type="checkbox" data-k="ignorarDecididas"' + (CFG.escopo.ignorarDecididas ? ' checked' : '') + '> Ignorar ganhas, perdidas e canceladas</label>' +
    '</div>' +
    '<div class="grupo" data-g="lembrete"><label><input type="checkbox" data-k="ativo"' + (CFG.lembrete.ativo ? ' checked' : '') + '> <b>Lembrete por demanda</b></label>' +
      '<div class="mut n">Preencha "Lembrete em" na proposta ou use o chat: <i>lembrar de CCPR rollouts em 22/09: cobrar retorno</i>.</div></div>' +
    '<div class="grupo" data-g="parada"><label><input type="checkbox" data-k="ativo"' + (CFG.parada.ativo ? ' checked' : '') + '> <b>Parada há X dias</b></label>' +
      '<div class="mut n">Dias sem nenhuma movimentação, por prioridade (0 desliga).</div>' +
      '<div class="sub">' + PRIOS.map(p => '<span>' + p + '</span>' + num(CFG.parada.dias[p] ?? 0, 0, 180).replace('<input', '<input data-prio="' + p + '"')).join('') +
        '<span>Ignorar paradas há mais de</span>' + num(CFG.parada.limite, 7, 999).replace('<input', '<input data-k="limite"') + '</div></div>' +
    '<div class="grupo" data-g="prazo"><label><input type="checkbox" data-k="ativo"' + (CFG.prazo.ativo ? ' checked' : '') + '> <b>Prazo (Data Prevista)</b></label>' +
      '<div class="sub"><span>Avisar quantos dias antes</span>' + num(CFG.prazo.antes, 0, 60).replace('<input', '<input data-k="antes"') +
        '<span>Ignorar vencidos há mais de</span>' + num(CFG.prazo.limiteVencido, 1, 999).replace('<input', '<input data-k="limiteVencido"') + '</div></div>' +
    '<div class="grupo" data-g="pendencia"><label><input type="checkbox" data-k="ativo"' + (CFG.pendencia.ativo ? ' checked' : '') + '> <b>Pendência parada</b></label>' +
      '<div class="sub"><span>Dias sem mexer na proposta</span>' + num(CFG.pendencia.dias, 1, 180).replace('<input', '<input data-k="dias"') + '</div></div>';

  $('cfgBox').querySelectorAll('.grupo').forEach(g => {
    const nome = g.dataset.g;
    g.querySelectorAll('input').forEach(inp => {
      inp.onchange = () => {
        if (inp.dataset.prio) CFG.parada.dias[inp.dataset.prio] = Number(inp.value);
        else if (inp.type === 'checkbox') CFG[nome][inp.dataset.k] = inp.checked;
        else CFG[nome][inp.dataset.k] = Number(inp.value);
        salvarConfig(); render(); atualizarContador();
      };
    });
  });
}

$('bellBtn').onclick = () => A.setView('alertas');
A.onLoad.push(() => carregar().catch(e => console.error('alertas:', e)));
setInterval(() => { if (A.user) atualizarContador(); }, 5 * 60000);

window.Alertas = { render, atualizarContador, calcular, get cfg() { return CFG; } };
})();
