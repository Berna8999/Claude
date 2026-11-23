import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPayloadRegimeRegular, montarPayloadSimples, resumirResposta } from '../src/calculadoras.js';
import { cnpjValido } from '../src/app.js';

const empresaRegular = { regime: 'regular', uf: 'RS', municipio_ibge: 4314902 };
const empresaSimples = {
  regime: 'simples', uf: 'SP', municipio_ibge: 3550308,
  aliquotas_efetivas: JSON.stringify({ anexoI: { pCBSSN: '1.1612', pIBSSN: '0.0129' } }),
};

test('CNPJ: aceita válido e recusa inválido', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11222333000182'), false);
  assert.equal(cnpjValido('00000000000000'), false);
});

test('payload do Regime Regular segue o formato da calculadora', () => {
  const p = montarPayloadRegimeRegular(empresaRegular, {
    data: '2027-03-10',
    aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 },
    itens: [{ ncm: '10063021', cst: '200', cClassTrib: '200003', valor: '100', quantidade: 20, unidade: 'KG' }],
  });
  assert.equal(p.dhFatoGerador, '2027-03-10T12:00:00-03:00');
  assert.equal(p.municipio, 4314902);
  assert.deepEqual(p.itens[0], {
    numero: 1, ncm: '10063021', cst: '200', cClassTrib: '200003', baseCalculo: 100,
    quantidade: 20, unidade: 'KG', aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 },
  });
});

test('payload do Simples: NF-e usa CRT, NFS-e usa opSimpNac', () => {
  const nfe = montarPayloadSimples(empresaSimples, { data: '2027-03-15', tpDoc: '55', itens: [{ cAtivSN: '01', cClassTrib: '000001', ncm: '22030000', valor: 950 }] });
  assert.equal(nfe.CRT, '1');
  assert.equal(nfe.itens[0].baseCalculo, '950.00');
  assert.equal(nfe.itens[0].valorImpostoSeletivo, '0.00');
  assert.equal(nfe.aliquotasEfetivas.anexoI.pCBSSN, '1.1612');

  const nfse = montarPayloadSimples(empresaSimples, { data: '2027-03-15', tpDoc: '91', itens: [{ cAtivSN: '12', cClassTrib: '000001', nbs: '114051000', valor: 10000 }] });
  assert.equal(nfse.CRT, undefined);
  assert.equal(nfse.opSimpNac, '3');
  assert.equal('valorImpostoSeletivo' in nfse.itens[0], false);
});

test('resumo do Regime Regular lê totais e itens com erro', () => {
  const r = resumirResposta('regular', {
    objetos: [
      { nObj: 1, estadoItem: 'CALCULO_SIMULADO' },
      { nObj: 2, estadoItem: 'INCONSISTENCIA_ENTRADA', erros: [{ code: 'REG-011', detail: 'NCM não vinculada' }] },
    ],
    total: { tribCalc: { ISTot: { vIS: '15.00' }, IBSCBSTot: { vBCIBSCBS: '1465.00', gIBS: { vIBS: '0.64' }, gCBS: { vCBS: '56.76' } } } },
  });
  assert.equal(r.situacao, 'parcial');
  assert.equal(r.itensCalculados, 1);
  assert.deepEqual([r.valorBase, r.vCBS, r.vIBS, r.vIS], [1465, 56.76, 0.64, 15]);
  assert.deepEqual(r.erros, ['Item 2: NCM não vinculada']);
});

test('resumo do Simples lê os totais próprios', () => {
  const r = resumirResposta('simples', {
    objetos: [{ nObj: 1, estadoItem: 'CALCULADO' }],
    total: { vBC: 950, vCBSSNtot: 11.03, vIBSSNtot: 0.12, totalIs: 0 },
  });
  assert.equal(r.situacao, 'ok');
  assert.deepEqual([r.valorBase, r.vCBS, r.vIBS, r.vIS], [950, 11.03, 0.12, 0]);
});
