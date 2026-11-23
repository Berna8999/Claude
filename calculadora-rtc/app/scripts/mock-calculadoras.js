// Simulador das duas calculadoras, para desenvolver a tela sem subir o Java.
// Os valores são FICTÍCIOS: servem só para testar o fluxo do sistema.
//
//   npm run mock            (portas 8080 e 8082, as mesmas das calculadoras reais)
import { createServer } from 'node:http';

const lerCorpo = (req) => new Promise((ok) => {
  let dados = '';
  req.on('data', (c) => { dados += c; });
  req.on('end', () => { try { ok(JSON.parse(dados || '{}')); } catch { ok({}); } });
});

const responder = (res, status, corpo) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
};

const r2 = (v) => Math.round(v * 100) / 100;

function regimeRegular(op) {
  const objetos = op.itens.map((it) => {
    if (!it.cClassTrib) return { nObj: it.numero, estadoItem: 'INCONSISTENCIA_ENTRADA', erros: [{ code: 'REG-000', detail: 'cClassTrib ausente (simulado)' }] };
    const a = it.aliquotasNominais ?? { cbs: 0.9, ibsEstadual: 0.05, ibsMunicipal: 0.05 };
    const vCBS = r2(it.baseCalculo * a.cbs / 100);
    const vIBSUF = r2(it.baseCalculo * a.ibsEstadual / 100);
    const vIBSMun = r2(it.baseCalculo * a.ibsMunicipal / 100);
    return { nObj: it.numero, estadoItem: 'CALCULO_SIMULADO', tribCalc: { IBSCBS: { CST: it.cst, cClassTrib: it.cClassTrib, gIBSCBS: { vBC: it.baseCalculo, vIBS: r2(vIBSUF + vIBSMun), gCBS: { vCBS } } } } };
  });
  const ok = objetos.filter((o) => o.tribCalc);
  const soma = (f) => r2(ok.reduce((s, o) => s + Number(f(o.tribCalc.IBSCBS.gIBSCBS)), 0));
  return {
    objetos,
    total: { tribCalc: { ISTot: { vIS: '0.00' }, IBSCBSTot: { vBCIBSCBS: soma((g) => g.vBC), gIBS: { vIBS: soma((g) => g.vIBS) }, gCBS: { vCBS: soma((g) => g.gCBS.vCBS) } } } },
  };
}

function simplesNacional(op) {
  const objetos = op.itens.map((it) => {
    if (!it.cAtivSN) return { nObj: it.numero, estadoItem: 'NAO_CALCULADO', motivoEstado: { descricao: 'cAtivSN ausente (simulado)' } };
    const base = Number(it.baseCalculo);
    return { nObj: it.numero, estadoItem: 'CALCULADO', tribCalc: { vBC: base, pCBSSN: 1.16, vCBSSN: r2(base * 0.0116), pIBSSN: 0.01, vIBSSN: r2(base * 0.0001) } };
  });
  const ok = objetos.filter((o) => o.tribCalc);
  const soma = (k) => r2(ok.reduce((s, o) => s + o.tribCalc[k], 0));
  return { objetos, total: { vBC: soma('vBC'), vCBSSNtot: soma('vCBSSN'), vIBSSNtot: soma('vIBSSN'), totalIs: 0 } };
}

function servidor(nome, porta, rotas) {
  createServer(async (req, res) => {
    const rota = rotas[`${req.method} ${req.url.split('?')[0]}`];
    if (!rota) return responder(res, 404, { title: 'rota não simulada' });
    responder(res, 200, rota(req.method === 'POST' ? await lerCorpo(req) : null));
  }).listen(porta, () => console.log(`[mock] ${nome} em http://localhost:${porta}/api`));
}

const versao = (app) => () => ({ versaoApp: `${app}-mock`, versaoDb: '0.0.0-mock', dataVersaoDb: '2026-11-19', ambiente: 'mock' });

servidor('Regime Regular', 8080, {
  'GET /api/calculadora/dados-abertos/versao': versao('1.7.2'),
  'POST /api/calculadora/observabilidade/regime-geral': regimeRegular,
});
servidor('Simples Nacional', 8082, {
  'GET /api/versao': versao('1.0.2'),
  'POST /api/calculadora/observabilidade/simples-nacional/nao-assistido': simplesNacional,
});
