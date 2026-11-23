// Integração com as calculadoras oficiais da Receita Federal.
//
// O sistema recebe um formato de entrada único (empresa + itens) e decide qual
// calculadora chamar pelo regime da empresa:
//   regular -> calculadora-rtc-regime-regular  POST /calculadora/observabilidade/regime-geral
//   simples -> calculadora-rtc-simples-nacional POST /calculadora/observabilidade/simples-nacional/nao-assistido
//
// Usamos os endpoints de "observabilidade" porque eles devolvem o resultado
// item a item (um item com erro não derruba a nota inteira).
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const ESTADOS_CALCULADOS = new Set(['CALCULADO', 'CALCULO_SIMULADO']);

async function requisitar(url, { metodo = 'GET', corpo, timeoutMs }) {
  const inicio = performance.now();
  const resp = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }
  return { ok: resp.ok, status: resp.status, json, texto, latenciaMs: Math.round(performance.now() - inicio) };
}

// ---------- Status (tela inicial) ----------

async function statusDe(nome, url) {
  try {
    const r = await requisitar(url, { timeoutMs: config.timeoutStatusMs });
    if (!r.ok) return { nome, online: false, erro: `HTTP ${r.status}` };
    const v = r.json ?? {};
    return {
      nome,
      online: true,
      latenciaMs: r.latenciaMs,
      versaoApp: v.versaoApp ?? null,
      versaoDb: v.versaoDb ?? null,
      dataVersaoDb: v.dataVersaoDb ?? null,
    };
  } catch (e) {
    return { nome, online: false, erro: e.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão' };
  }
}

export async function statusCalculadoras() {
  const [regular, simples] = await Promise.all([
    statusDe('Regime Regular', `${config.regimeRegularUrl}/calculadora/dados-abertos/versao`),
    statusDe('Simples Nacional', `${config.simplesNacionalUrl}/versao`),
  ]);
  return { regular, simples };
}

// ---------- Montagem dos payloads ----------

const dinheiro = (v) => Number(v).toFixed(2);
const idOperacao = () => randomUUID().replaceAll('-', '');

export function montarPayloadRegimeRegular(empresa, entrada) {
  return {
    id: idOperacao(),
    versao: '1.0.0',
    dhFatoGerador: `${entrada.data}T12:00:00-03:00`,
    municipio: empresa.municipio_ibge,
    uf: empresa.uf,
    itens: entrada.itens.map((item, i) => ({
      numero: i + 1,
      ...(item.ncm ? { ncm: item.ncm } : {}),
      ...(item.nbs ? { nbs: item.nbs } : {}),
      cst: item.cst,
      cClassTrib: item.cClassTrib,
      baseCalculo: Number(dinheiro(item.valor)),
      ...(item.quantidade ? { quantidade: Number(item.quantidade) } : {}),
      ...(item.unidade ? { unidade: item.unidade } : {}),
      // A partir de 2027 as alíquotas nominais são obrigatórias (antes disso, proibidas).
      ...(entrada.aliquotasNominais ? { aliquotasNominais: entrada.aliquotasNominais } : {}),
    })),
  };
}

export function montarPayloadSimples(empresa, entrada) {
  const nfse = entrada.tpDoc === '91';
  return {
    id: idOperacao(),
    versao: '3.0.0',
    data: entrada.data,
    tpDoc: entrada.tpDoc ?? '55',
    // NF-e/NFC-e usam CRT; a NFS-e usa opSimpNac/regApIBSCBSSN/regApTribSN.
    ...(nfse
      ? { opSimpNac: '3', regApIBSCBSSN: '1', regApTribSN: '1' }
      : { CRT: '1' }),
    aliquotasEfetivas: empresa.aliquotas_efetivas ? JSON.parse(empresa.aliquotas_efetivas) : null,
    itens: entrada.itens.map((item, i) => ({
      numero: i + 1,
      cAtivSN: item.cAtivSN ?? null,
      cClassTrib: item.cClassTrib,
      ...(item.ncm ? { ncm: item.ncm } : {}),
      ...(item.nbs ? { nbs: item.nbs } : {}),
      baseCalculo: dinheiro(item.valor),
      ...(nfse ? {} : { valorImpostoSeletivo: dinheiro(item.valorImpostoSeletivo ?? 0) }),
    })),
  };
}

// ---------- Leitura das respostas ----------

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export function resumirResposta(regime, resp) {
  const objetos = Array.isArray(resp?.objetos) ? resp.objetos : [];
  const itensCalculados = objetos.filter((o) => ESTADOS_CALCULADOS.has(o.estadoItem)).length;
  const erros = objetos.flatMap((o) => [
    ...(o.erros ?? []).map((e) => `Item ${o.nObj}: ${e.detail ?? e.title ?? e.code}`),
    // Simples Nacional: item não calculado vem com "motivoEstado" em vez de "erros".
    ...(!o.erros?.length && o.motivoEstado?.descricao ? [`Item ${o.nObj}: ${o.motivoEstado.descricao}`] : []),
  ]);

  let totais;
  if (regime === 'regular') {
    const t = resp?.total?.tribCalc ?? {};
    totais = {
      valorBase: num(t.IBSCBSTot?.vBCIBSCBS),
      vCBS: num(t.IBSCBSTot?.gCBS?.vCBS),
      vIBS: num(t.IBSCBSTot?.gIBS?.vIBS),
      vIS: num(t.ISTot?.vIS),
    };
  } else {
    const t = resp?.total ?? {};
    totais = { valorBase: num(t.vBC), vCBS: num(t.vCBSSNtot), vIBS: num(t.vIBSSNtot), vIS: num(t.totalIs) };
  }

  let situacao = 'ok';
  if (itensCalculados === 0) situacao = 'erro';
  else if (itensCalculados < objetos.length) situacao = 'parcial';

  return { situacao, itensTotal: objetos.length, itensCalculados, erros, ...totais };
}

// ---------- Cálculo ----------

export async function calcular(empresa, entrada) {
  const regular = empresa.regime === 'regular';
  const payload = regular ? montarPayloadRegimeRegular(empresa, entrada) : montarPayloadSimples(empresa, entrada);
  const url = regular
    ? `${config.regimeRegularUrl}/calculadora/observabilidade/regime-geral`
    : `${config.simplesNacionalUrl}/calculadora/observabilidade/simples-nacional/nao-assistido`;

  const r = await requisitar(url, { metodo: 'POST', corpo: payload, timeoutMs: config.timeoutCalculoMs });
  if (!r.ok) {
    const detalhe = r.json?.detail ?? r.json?.title ?? r.json?.message ?? r.texto?.slice(0, 300);
    const err = new Error(`A calculadora respondeu HTTP ${r.status}${detalhe ? `: ${detalhe}` : ''}`);
    err.payload = payload;
    err.resposta = r.json ?? r.texto;
    throw err;
  }
  return { payload, resposta: r.json, resumo: resumirResposta(empresa.regime, r.json) };
}
