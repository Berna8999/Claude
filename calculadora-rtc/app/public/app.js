// Tela inicial do sistema: status das calculadoras, resumo do mês,
// últimos cálculos, empresas e os dois atalhos (cadastrar empresa / novo cálculo).

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

let empresas = [];

// ---------- Utilidades ----------
async function api(caminho, opcoes = {}) {
  const resp = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes.headers ?? {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (!resp.ok) throw Object.assign(new Error('Erro na API'), { erros: corpo?.erros ?? [`HTTP ${resp.status}`] });
  return corpo;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinheiro = (v) => (v === null || v === undefined ? '—' : brl.format(v));
const formatarCnpj = (c) => String(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const iniciais = (nome) => nome.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || nome.slice(0, 2).toUpperCase();
// Aceita "1.234,56" (formato brasileiro) e "1234.56".
const numero = (v) => {
  const s = String(v ?? '').trim();
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
};
const dataLocal = (sqlite) => new Date(`${sqlite.replace(' ', 'T')}Z`);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('visivel');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('visivel'), 3000);
}

function mostrarErros(lista, erros) {
  lista.hidden = !erros?.length;
  lista.innerHTML = (erros ?? []).map((e) => `<li>${esc(e)}</li>`).join('');
}

// ---------- Topo ----------
function saudacao() {
  const h = new Date().getHours();
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const hoje = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#saudacao').textContent = `${periodo} · ${hoje}`;

  const ano = new Date().getFullYear();
  const itens = [...document.querySelectorAll('#linha-tempo li')];
  const atual = itens.filter((li) => Number(li.dataset.ano) <= ano).pop();
  atual?.classList.add('atual');
}

// ---------- Status das calculadoras ----------
function pintarStatus(el, s) {
  el.classList.remove('online', 'offline');
  el.classList.add(s.online ? 'online' : 'offline');
  $('.status-detalhe', el).textContent = s.online
    ? `Online · ${s.latenciaMs} ms${s.dataVersaoDb ? ` · base de ${dataBr.format(new Date(`${s.dataVersaoDb}T12:00`))}` : ''}`
    : `Fora do ar (${s.erro}) · rode "docker compose up"`;
  $('.status-versao', el).textContent = s.online && s.versaoApp ? `v${s.versaoApp}` : '';
}

async function carregarStatus() {
  for (const id of ['#status-regular', '#status-simples']) {
    $('.status-detalhe', $(id)).textContent = 'Verificando…';
  }
  try {
    const s = await api('/status');
    pintarStatus($('#status-regular'), s.regular);
    pintarStatus($('#status-simples'), s.simples);
  } catch {
    toast('Não foi possível consultar o status.');
  }
}

// ---------- Resumo ----------
async function carregarResumo() {
  const r = await api('/resumo');
  $('#kpi-empresas').textContent = r.empresas.total;
  $('#kpi-empresas-sub').textContent = r.empresas.total
    ? `${r.empresas.regular} no regime regular · ${r.empresas.simples} no Simples`
    : 'nenhuma ainda';
  $('#kpi-calculos').textContent = r.mes.calculos;
  $('#kpi-calculos-sub').textContent = r.mes.comPendencia
    ? `${r.mes.comPendencia} com pendência para revisar`
    : r.mes.calculos ? 'todos sem pendência' : 'nenhum neste mês';
  $('#kpi-cbs').textContent = brl.format(r.mes.vCBS);
  $('#kpi-ibs').textContent = brl.format(r.mes.vIBS);
}

// ---------- Empresas ----------
async function carregarEmpresas() {
  empresas = await api('/empresas');
  const ul = $('#lista-empresas');
  if (!empresas.length) {
    ul.innerHTML = '<li><span class="vazio-lista">Nenhuma empresa cadastrada.</span></li>';
    return;
  }
  ul.innerHTML = empresas.slice(0, 6).map((e) => `
    <li>
      <span class="avatar">${esc(iniciais(e.razaoSocial))}</span>
      <div class="info">
        <strong title="${esc(e.razaoSocial)}">${esc(e.razaoSocial)}</strong>
        <span>${formatarCnpj(e.cnpj)}</span>
      </div>
      <span class="regime">${e.regime === 'simples' ? 'Simples' : 'Regular'}</span>
    </li>`).join('');
}

// ---------- Últimos cálculos ----------
const SITUACAO = { ok: 'Calculado', parcial: 'Parcial', erro: 'Com erro' };

async function carregarCalculos() {
  const calculos = await api('/calculos?limite=8');
  const alvo = $('#calculos-conteudo');

  if (!calculos.length) {
    const temEmpresa = empresas.length > 0;
    alvo.innerHTML = `
      <div class="vazio">
        <h3>Comece em dois passos</h3>
        <p>Cadastre as empresas e calcule a CBS, o IBS e o Imposto Seletivo das operações com o motor oficial da Receita Federal.</p>
        <ol class="passos">
          <li class="${temEmpresa ? 'feito' : ''}"><span><strong>Cadastre uma empresa</strong>: CNPJ, regime e município.</span></li>
          <li><span><strong>Faça o primeiro cálculo</strong>: informe os itens com NCM/NBS e cClassTrib.</span></li>
        </ol>
        <button class="botao primario" data-acao="${temEmpresa ? 'calculo' : 'empresa'}">
          ${temEmpresa ? 'Fazer o primeiro cálculo' : 'Cadastrar empresa'}
        </button>
      </div>`;
    return;
  }

  alvo.innerHTML = `
    <div class="tabela-rolagem">
      <table>
        <thead><tr>
          <th>Empresa</th><th>Situação</th><th>Itens</th>
          <th class="dinheiro">Base</th><th class="dinheiro">CBS</th><th class="dinheiro">IBS</th><th class="dinheiro">IS</th>
        </tr></thead>
        <tbody>
          ${calculos.map((c) => `
            <tr title="${esc(c.mensagem ?? '')}">
              <td>
                <span class="empresa-nome">${esc(c.empresa)}</span>
                <span class="sub">${dataBr.format(dataLocal(c.criadoEm))} · ${c.regime === 'simples' ? 'Simples' : 'Regular'}</span>
              </td>
              <td><span class="selo ${c.situacao}">${SITUACAO[c.situacao]}</span></td>
              <td class="num">${c.itensCalculados}/${c.itensTotal}</td>
              <td class="dinheiro">${dinheiro(c.valorBase)}</td>
              <td class="dinheiro">${dinheiro(c.vCBS)}</td>
              <td class="dinheiro">${dinheiro(c.vIBS)}</td>
              <td class="dinheiro">${dinheiro(c.vIS)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function recarregarPainel() {
  await carregarEmpresas();
  await Promise.all([carregarResumo(), carregarCalculos()]);
}

// ---------- Modal: empresa ----------
const modalEmpresa = $('#modal-empresa');
const formEmpresa = $('#form-empresa');

function abrirModalEmpresa() {
  formEmpresa.reset();
  mostrarErros($('#erros-empresa'), []);
  $('#grupo-simples').hidden = true;
  modalEmpresa.showModal();
  formEmpresa.razaoSocial.focus();
}

formEmpresa.regime.addEventListener('change', () => {
  $('#grupo-simples').hidden = formEmpresa.regime.value !== 'simples';
});

formEmpresa.cnpj.addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 14);
  e.target.value = d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
});

formEmpresa.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formEmpresa;
  const corpo = {
    razaoSocial: f.razaoSocial.value,
    cnpj: f.cnpj.value,
    regime: f.regime.value,
    uf: f.uf.value,
    municipioIbge: f.municipioIbge.value.trim(),
  };
  if (corpo.regime === 'simples' && (f.pCBSSN.value || f.pIBSSN.value)) {
    corpo.aliquotasEfetivas = { anexoI: { pCBSSN: f.pCBSSN.value.replace(',', '.') || null, pIBSSN: f.pIBSSN.value.replace(',', '.') || null } };
  }
  try {
    await api('/empresas', { method: 'POST', body: corpo });
    modalEmpresa.close();
    toast('Empresa cadastrada.');
    await recarregarPainel();
  } catch (err) {
    mostrarErros($('#erros-empresa'), err.erros);
  }
});

// ---------- Modal: cálculo ----------
const modalCalculo = $('#modal-calculo');
const formCalculo = $('#form-calculo');

function adicionarItem() {
  const no = $('#tpl-item').content.firstElementChild.cloneNode(true);
  $('.remover', no).addEventListener('click', () => {
    if ($('#itens').children.length > 1) no.remove();
  });
  $('#itens').append(no);
}

function atualizarFormCalculo() {
  const empresa = empresas.find((e) => String(e.id) === formCalculo.empresaId.value);
  const regime = empresa?.regime ?? 'regular';
  modalCalculo.dataset.regime = regime;
  const ano = Number((formCalculo.data.value || '').slice(0, 4));
  $('#grupo-aliquotas').hidden = !(regime === 'regular' && ano >= 2027);
}

function abrirModalCalculo() {
  if (!empresas.length) {
    toast('Cadastre uma empresa antes de calcular.');
    abrirModalEmpresa();
    return;
  }
  formCalculo.reset();
  $('#select-empresa').innerHTML = empresas
    .map((e) => `<option value="${e.id}">${esc(e.razaoSocial)} (${e.regime === 'simples' ? 'Simples' : 'Regular'})</option>`)
    .join('');
  formCalculo.data.value = new Date().toISOString().slice(0, 10);
  $('#itens').innerHTML = '';
  adicionarItem();
  mostrarErros($('#erros-calculo'), []);
  $('#resultado-calculo').hidden = true;
  atualizarFormCalculo();
  modalCalculo.showModal();
}

formCalculo.empresaId.addEventListener('change', atualizarFormCalculo);
formCalculo.data.addEventListener('change', atualizarFormCalculo);
$('#btn-add-item').addEventListener('click', adicionarItem);

function mostrarResultado(r) {
  const el = $('#resultado-calculo');
  el.hidden = false;
  el.innerHTML = `
    <div class="resultado-topo">
      <span class="selo ${r.situacao}">${SITUACAO[r.situacao]}</span>
      <span>${r.itensCalculados} de ${r.itensTotal} itens calculados</span>
    </div>
    <div class="resultado-valores">
      <div><span>Base de cálculo</span><strong>${dinheiro(r.valorBase)}</strong></div>
      <div><span>CBS</span><strong>${dinheiro(r.vCBS)}</strong></div>
      <div><span>IBS</span><strong>${dinheiro(r.vIBS)}</strong></div>
      <div><span>Imposto Seletivo</span><strong>${dinheiro(r.vIS)}</strong></div>
    </div>
    ${r.erros?.length ? `<ul class="resultado-erros">${r.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
}

formCalculo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formCalculo;
  const regime = modalCalculo.dataset.regime;
  const itens = [...document.querySelectorAll('#itens .item')].map((no) => {
    const v = (n) => $(`[name="${n}"]`, no).value.trim();
    const codigo = v('codigo').replace(/\D/g, '');
    return {
      descricao: v('descricao') || undefined,
      // NCM tem 8 dígitos; NBS tem 9.
      ...(codigo.length === 9 ? { nbs: codigo } : codigo ? { ncm: codigo } : {}),
      cst: regime === 'regular' ? v('cst') : undefined,
      cAtivSN: regime === 'simples' ? v('cAtivSN').padStart(2, '0') : undefined,
      cClassTrib: v('cClassTrib'),
      valor: numero(v('valor')),
    };
  });
  const corpo = { empresaId: Number(f.empresaId.value), data: f.data.value, tpDoc: f.tpDoc.value, itens };
  if (!$('#grupo-aliquotas').hidden) {
    corpo.aliquotasNominais = { cbs: numero(f.aliqCbs.value), ibsEstadual: numero(f.aliqIbsUf.value), ibsMunicipal: numero(f.aliqIbsMun.value) };
  }

  const btn = $('#btn-calcular');
  btn.disabled = true;
  btn.textContent = 'Calculando…';
  mostrarErros($('#erros-calculo'), []);
  $('#resultado-calculo').hidden = true;
  try {
    mostrarResultado(await api('/calculos', { method: 'POST', body: corpo }));
  } catch (err) {
    mostrarErros($('#erros-calculo'), err.erros);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Calcular';
    recarregarPainel();
  }
});

// ---------- Ligações gerais ----------
document.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#btn-nova-empresa').addEventListener('click', abrirModalEmpresa);
$('#btn-novo-calculo').addEventListener('click', abrirModalCalculo);
$('#btn-atualizar-status').addEventListener('click', carregarStatus);
document.querySelectorAll('.status-card').forEach((c) => c.addEventListener('click', carregarStatus));
$('#abrir-menu').addEventListener('click', () => $('#sidebar').classList.toggle('aberta'));
document.addEventListener('click', (e) => {
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (acao === 'empresa') abrirModalEmpresa();
  if (acao === 'calculo') abrirModalCalculo();
  if (e.target.closest('[data-em-breve]')) {
    e.preventDefault();
    toast('Esta tela ainda vai ser construída.');
  }
  if ($('#sidebar').classList.contains('aberta') && !e.target.closest('#sidebar, #abrir-menu')) {
    $('#sidebar').classList.remove('aberta');
  }
});
$('#select-uf').innerHTML = UFS.map((uf) => `<option ${uf === 'SP' ? 'selected' : ''}>${uf}</option>`).join('');

saudacao();
carregarStatus();
recarregarPainel().catch(() => toast('Não foi possível carregar o painel.'));
