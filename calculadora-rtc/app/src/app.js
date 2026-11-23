// Rotas HTTP do sistema. Separado de server.js para facilitar os testes.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { calcular, statusCalculadoras } from './calculadoras.js';

const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));

export function cnpjValido(valor) {
  const c = String(valor ?? '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const d of base) {
      soma += Number(d) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

function validarEmpresa(b) {
  const erros = [];
  if (!b.razaoSocial?.trim()) erros.push('Informe a razão social.');
  if (!cnpjValido(b.cnpj)) erros.push('CNPJ inválido.');
  if (!['regular', 'simples'].includes(b.regime)) erros.push('Regime deve ser "regular" ou "simples".');
  if (!UFS.has(b.uf)) erros.push('UF inválida.');
  if (!/^\d{7}$/.test(String(b.municipioIbge ?? ''))) erros.push('Código IBGE do município deve ter 7 dígitos.');
  return erros;
}

function validarCalculo(b) {
  const erros = [];
  if (!Number.isInteger(Number(b.empresaId))) erros.push('Informe a empresa.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data ?? '')) erros.push('Data do fato gerador deve estar no formato AAAA-MM-DD.');
  if (!Array.isArray(b.itens) || b.itens.length === 0) erros.push('Informe ao menos um item.');
  (b.itens ?? []).forEach((it, i) => {
    if (!it.cClassTrib) erros.push(`Item ${i + 1}: informe o cClassTrib.`);
    if (!(Number(it.valor) >= 0)) erros.push(`Item ${i + 1}: valor inválido.`);
    if (it.ncm && it.nbs) erros.push(`Item ${i + 1}: informe NCM ou NBS, não os dois.`);
  });
  return erros;
}

const empresaParaApi = (e) => ({
  id: e.id,
  razaoSocial: e.razao_social,
  cnpj: e.cnpj,
  regime: e.regime,
  uf: e.uf,
  municipioIbge: e.municipio_ibge,
  temAliquotasEfetivas: Boolean(e.aliquotas_efetivas),
  criadoEm: e.criado_em,
});

const calculoParaApi = (c) => ({
  id: c.id,
  empresaId: c.empresa_id,
  empresa: c.razao_social,
  regime: c.regime,
  tpDoc: c.tp_doc,
  dataFato: c.data_fato,
  situacao: c.situacao,
  itensTotal: c.itens_total,
  itensCalculados: c.itens_calculados,
  valorBase: c.valor_base,
  vCBS: c.v_cbs,
  vIBS: c.v_ibs,
  vIS: c.v_is,
  mensagem: c.mensagem,
  criadoEm: c.criado_em,
});

export function criarApp(db) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  // ---- Tela inicial ----
  app.get('/api/status', async (_req, res) => {
    res.json(await statusCalculadoras());
  });

  app.get('/api/resumo', (_req, res) => {
    const empresas = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(regime = 'regular') AS regular,
             SUM(regime = 'simples') AS simples
      FROM empresas`).get();
    const calculos = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(situacao <> 'ok') AS comPendencia,
             ROUND(COALESCE(SUM(v_cbs), 0), 2) AS cbs,
             ROUND(COALESCE(SUM(v_ibs), 0), 2) AS ibs,
             ROUND(COALESCE(SUM(v_is), 0), 2) AS imposto_seletivo
      FROM calculos
      WHERE criado_em >= datetime('now', 'start of month')`).get();
    res.json({
      empresas: { total: empresas.total, regular: empresas.regular ?? 0, simples: empresas.simples ?? 0 },
      mes: {
        calculos: calculos.total,
        comPendencia: calculos.comPendencia ?? 0,
        vCBS: calculos.cbs,
        vIBS: calculos.ibs,
        vIS: calculos.imposto_seletivo,
      },
    });
  });

  // ---- Empresas ----
  app.get('/api/empresas', (_req, res) => {
    res.json(db.prepare('SELECT * FROM empresas ORDER BY razao_social').all().map(empresaParaApi));
  });

  app.post('/api/empresas', (req, res) => {
    const b = req.body ?? {};
    const erros = validarEmpresa(b);
    if (erros.length) return res.status(400).json({ erros });
    const cnpj = b.cnpj.replace(/\D/g, '');
    if (db.prepare('SELECT 1 FROM empresas WHERE cnpj = ?').get(cnpj)) {
      return res.status(409).json({ erros: ['Já existe uma empresa com esse CNPJ.'] });
    }
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO empresas (razao_social, cnpj, regime, uf, municipio_ibge, aliquotas_efetivas)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      b.razaoSocial.trim(), cnpj, b.regime, b.uf, Number(b.municipioIbge),
      b.regime === 'simples' && b.aliquotasEfetivas ? JSON.stringify(b.aliquotasEfetivas) : null,
    );
    res.status(201).json(empresaParaApi(db.prepare('SELECT * FROM empresas WHERE id = ?').get(lastInsertRowid)));
  });

  app.delete('/api/empresas/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM empresas WHERE id = ?').run(Number(req.params.id));
    res.status(changes ? 204 : 404).end();
  });

  // ---- Cálculos ----
  app.get('/api/calculos', (req, res) => {
    const limite = Math.min(Number(req.query.limite) || 20, 100);
    const linhas = db.prepare(`
      SELECT c.*, e.razao_social FROM calculos c JOIN empresas e ON e.id = c.empresa_id
      ORDER BY c.criado_em DESC, c.id DESC LIMIT ?`).all(limite);
    res.json(linhas.map(calculoParaApi));
  });

  app.get('/api/calculos/:id', (req, res) => {
    const c = db.prepare(`
      SELECT c.*, e.razao_social FROM calculos c JOIN empresas e ON e.id = c.empresa_id
      WHERE c.id = ?`).get(Number(req.params.id));
    if (!c) return res.status(404).end();
    res.json({ ...calculoParaApi(c), entrada: JSON.parse(c.entrada), resposta: c.resposta ? JSON.parse(c.resposta) : null });
  });

  app.post('/api/calculos', async (req, res) => {
    const b = req.body ?? {};
    const erros = validarCalculo(b);
    if (erros.length) return res.status(400).json({ erros });
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(Number(b.empresaId));
    if (!empresa) return res.status(404).json({ erros: ['Empresa não encontrada.'] });

    const salvar = db.prepare(`
      INSERT INTO calculos (empresa_id, regime, tp_doc, data_fato, situacao, itens_total, itens_calculados,
                            valor_base, v_cbs, v_ibs, v_is, mensagem, entrada, resposta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    try {
      const { payload, resposta, resumo } = await calcular(empresa, b);
      const { lastInsertRowid } = salvar.run(
        empresa.id, empresa.regime, b.tpDoc ?? null, b.data, resumo.situacao, resumo.itensTotal,
        resumo.itensCalculados, resumo.valorBase, resumo.vCBS, resumo.vIBS, resumo.vIS,
        resumo.erros.join('\n') || null, JSON.stringify(payload), JSON.stringify(resposta),
      );
      res.status(201).json({ id: Number(lastInsertRowid), ...resumo, resposta });
    } catch (e) {
      const mensagem = e.payload ? e.message : `Não foi possível falar com a calculadora (${e.message}).`;
      salvar.run(
        empresa.id, empresa.regime, b.tpDoc ?? null, b.data, 'erro', b.itens.length, 0,
        null, null, null, null, mensagem, JSON.stringify(e.payload ?? b),
        e.resposta ? JSON.stringify(e.resposta) : null,
      );
      res.status(502).json({ erros: [mensagem], resposta: e.resposta ?? null });
    }
  });

  return app;
}
