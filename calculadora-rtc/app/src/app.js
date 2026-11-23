// Rotas HTTP do sistema. Separado de server.js para facilitar os testes.
//
// Regra de acesso: cada usuário só enxerga as empresas em que tem uma linha em "acessos".
// O contador entra como "contador"; a empresa que se cadastra sozinha entra como "dono";
// quem chega por convite entra como "contador" (se a conta for de contador) ou "membro".
import express from 'express';
import { fileURLToPath } from 'node:url';
import { calcular, statusCalculadoras } from './calculadoras.js';
import { config } from './config.js';
import {
  carregarUsuario, conferirSenha, criarSessao, encerrarSessao, exigirLogin, hashSenha, hashToken,
  limitadorLogin, novoToken,
} from './auth.js';

const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIAS_CONVITE = 7;

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

const usuarioParaApi = (u) => ({ id: u.id, nome: u.nome, email: u.email, tipo: u.tipo });

const empresaParaApi = (e) => ({
  id: e.id,
  razaoSocial: e.razao_social,
  cnpj: e.cnpj,
  regime: e.regime,
  uf: e.uf,
  municipioIbge: e.municipio_ibge,
  temAliquotasEfetivas: Boolean(e.aliquotas_efetivas),
  papel: e.papel,
  pessoas: e.pessoas,
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

// Pedidos que mudam dados precisam vir do próprio site, em JSON.
// Junto com o cookie SameSite=Lax, isso barra envio de formulário por outro site (CSRF).
function protegerEscrita(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origem = req.get('origin');
  if (origem && new URL(origem).host !== req.get('host')) {
    return res.status(403).json({ erros: ['Origem não permitida.'] });
  }
  if (req.headers['content-length'] > 0 && !req.is('application/json')) {
    return res.status(415).json({ erros: ['Envie os dados em JSON.'] });
  }
  next();
}

export function criarApp(db) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use('/api', protegerEscrita, carregarUsuario(db));

  const limitador = limitadorLogin();
  const linkBase = (req) => config.appUrl || `${req.protocol}://${req.get('host')}`;

  // Papel do usuário na empresa, ou undefined se não tiver acesso.
  const papelNa = (usuarioId, empresaId) =>
    db.prepare('SELECT papel FROM acessos WHERE usuario_id = ? AND empresa_id = ?').get(usuarioId, empresaId)?.papel;

  const buscarEmpresas = db.prepare(`
    SELECT e.*, a.papel, (SELECT COUNT(*) FROM acessos x WHERE x.empresa_id = e.id) AS pessoas
    FROM empresas e JOIN acessos a ON a.empresa_id = e.id AND a.usuario_id = ?
    ORDER BY e.razao_social`);

  // ================= Conta =================
  app.post('/api/auth/cadastro', (req, res) => {
    const { nome, email, senha, tipo } = req.body ?? {};
    const erros = [];
    if (!nome?.trim()) erros.push('Informe seu nome.');
    if (!EMAIL.test(email ?? '')) erros.push('E-mail inválido.');
    if (String(senha ?? '').length < 8) erros.push('A senha precisa ter pelo menos 8 caracteres.');
    if (!['contador', 'empresa'].includes(tipo)) erros.push('Escolha se você é contador ou empresa.');
    if (erros.length) return res.status(400).json({ erros });
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email.trim())) {
      return res.status(409).json({ erros: ['Já existe uma conta com esse e-mail. Use "Entrar".'] });
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES (?, ?, ?, ?)')
      .run(nome.trim(), email.trim(), hashSenha(senha), tipo);
    criarSessao(db, res, Number(lastInsertRowid), { seguro: config.cookieSeguro });
    res.status(201).json(usuarioParaApi(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(lastInsertRowid)));
  });

  app.post('/api/auth/entrar', (req, res) => {
    const { email, senha } = req.body ?? {};
    const chave = `${req.ip}|${String(email ?? '').toLowerCase()}`;
    if (limitador.bloqueado(chave)) {
      return res.status(429).json({ erros: ['Muitas tentativas. Espere 15 minutos e tente de novo.'] });
    }
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email ?? '').trim());
    if (!u || !conferirSenha(String(senha ?? ''), u.senha_hash)) {
      limitador.falhou(chave);
      return res.status(401).json({ erros: ['E-mail ou senha incorretos.'] });
    }
    limitador.limpar(chave);
    criarSessao(db, res, u.id, { seguro: config.cookieSeguro });
    res.json(usuarioParaApi(u));
  });

  app.post('/api/auth/sair', (req, res) => {
    encerrarSessao(db, req, res);
    res.status(204).end();
  });

  app.get('/api/eu', exigirLogin, (req, res) => res.json(usuarioParaApi(req.usuario)));

  // ================= Convites (consulta pública) =================
  // Quem recebe o link vê de quem é o convite antes de entrar ou criar a conta.
  app.get('/api/convites/:token', (req, res) => {
    const c = db.prepare(`
      SELECT c.email, c.aceito_em, c.expira_em > datetime('now') AS valido, e.razao_social, u.nome AS convidado_por
      FROM convites c JOIN empresas e ON e.id = c.empresa_id JOIN usuarios u ON u.id = c.criado_por
      WHERE c.token_hash = ?`).get(hashToken(req.params.token));
    if (!c) return res.status(404).json({ erros: ['Convite não encontrado.'] });
    res.json({
      empresa: c.razao_social,
      convidadoPor: c.convidado_por,
      email: c.email,
      situacao: c.aceito_em ? 'aceito' : c.valido ? 'pendente' : 'expirado',
    });
  });

  // ================= Tela inicial =================
  app.get('/api/status', async (_req, res) => {
    res.json(await statusCalculadoras());
  });

  // Daqui para baixo, tudo exige login.
  app.use('/api', exigirLogin);

  app.get('/api/resumo', (req, res) => {
    const empresas = db.prepare(`
      SELECT COUNT(*) AS total, SUM(e.regime = 'regular') AS regular, SUM(e.regime = 'simples') AS simples
      FROM empresas e JOIN acessos a ON a.empresa_id = e.id AND a.usuario_id = ?`).get(req.usuario.id);
    const calculos = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(c.situacao <> 'ok') AS comPendencia,
             ROUND(COALESCE(SUM(c.v_cbs), 0), 2) AS cbs,
             ROUND(COALESCE(SUM(c.v_ibs), 0), 2) AS ibs,
             ROUND(COALESCE(SUM(c.v_is), 0), 2) AS imposto_seletivo
      FROM calculos c JOIN acessos a ON a.empresa_id = c.empresa_id AND a.usuario_id = ?
      WHERE c.criado_em >= datetime('now', 'start of month')`).get(req.usuario.id);
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

  // ================= Empresas =================
  app.get('/api/empresas', (req, res) => {
    res.json(buscarEmpresas.all(req.usuario.id).map(empresaParaApi));
  });

  app.post('/api/empresas', (req, res) => {
    const b = req.body ?? {};
    const erros = validarEmpresa(b);
    if (erros.length) return res.status(400).json({ erros });
    const cnpj = b.cnpj.replace(/\D/g, '');
    const jaTem = db.prepare(`
      SELECT 1 FROM empresas e JOIN acessos a ON a.empresa_id = e.id
      WHERE a.usuario_id = ? AND e.cnpj = ?`).get(req.usuario.id, cnpj);
    if (jaTem) return res.status(409).json({ erros: ['Você já cadastrou uma empresa com esse CNPJ.'] });

    const papel = req.usuario.tipo === 'contador' ? 'contador' : 'dono';
    db.exec('BEGIN');
    try {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO empresas (razao_social, cnpj, regime, uf, municipio_ibge, aliquotas_efetivas, criado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        b.razaoSocial.trim(), cnpj, b.regime, b.uf, Number(b.municipioIbge),
        b.regime === 'simples' && b.aliquotasEfetivas ? JSON.stringify(b.aliquotasEfetivas) : null,
        req.usuario.id,
      );
      db.prepare('INSERT INTO acessos (usuario_id, empresa_id, papel) VALUES (?, ?, ?)')
        .run(req.usuario.id, lastInsertRowid, papel);
      db.exec('COMMIT');
      const criada = buscarEmpresas.all(req.usuario.id).find((e) => e.id === Number(lastInsertRowid));
      res.status(201).json(empresaParaApi(criada));
    } catch (e) {
      db.exec('ROLLBACK');
      // Banco da versão antiga ainda tem CNPJ único para todo o sistema.
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ erros: ['Esse CNPJ já está cadastrado no sistema.'] });
      }
      throw e;
    }
  });

  // Quem cadastrou apaga a empresa para todos; os demais só deixam de ter acesso.
  app.delete('/api/empresas/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!papelNa(req.usuario.id, id)) return res.status(404).end();
    const e = db.prepare('SELECT criado_por FROM empresas WHERE id = ?').get(id);
    if (e.criado_por === req.usuario.id) db.prepare('DELETE FROM empresas WHERE id = ?').run(id);
    else db.prepare('DELETE FROM acessos WHERE usuario_id = ? AND empresa_id = ?').run(req.usuario.id, id);
    res.status(204).end();
  });

  // Quem tem acesso à empresa e quem foi convidado.
  app.get('/api/empresas/:id/pessoas', (req, res) => {
    const id = Number(req.params.id);
    if (!papelNa(req.usuario.id, id)) return res.status(404).json({ erros: ['Empresa não encontrada.'] });
    const pessoas = db.prepare(`
      SELECT u.nome, u.email, u.tipo, a.papel FROM acessos a JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.empresa_id = ? ORDER BY a.criado_em`).all(id);
    const pendentes = db.prepare(`
      SELECT email, criado_em, expira_em FROM convites
      WHERE empresa_id = ? AND aceito_em IS NULL AND expira_em > datetime('now') ORDER BY criado_em DESC`).all(id);
    res.json({ pessoas, convitesPendentes: pendentes });
  });

  // ================= Convites =================
  // Não enviamos e-mail ainda: a resposta traz o link para a pessoa copiar e mandar (WhatsApp, e-mail…).
  app.post('/api/empresas/:id/convites', (req, res) => {
    const id = Number(req.params.id);
    if (!papelNa(req.usuario.id, id)) return res.status(404).json({ erros: ['Empresa não encontrada.'] });
    const email = String(req.body?.email ?? '').trim();
    if (!EMAIL.test(email)) return res.status(400).json({ erros: ['E-mail inválido.'] });
    if (email.toLowerCase() === req.usuario.email.toLowerCase()) {
      return res.status(400).json({ erros: ['Você já tem acesso a esta empresa.'] });
    }
    const jaTem = db.prepare(`
      SELECT 1 FROM acessos a JOIN usuarios u ON u.id = a.usuario_id WHERE a.empresa_id = ? AND u.email = ?`).get(id, email);
    if (jaTem) return res.status(409).json({ erros: ['Essa pessoa já tem acesso a esta empresa.'] });

    const token = novoToken();
    db.prepare(`
      INSERT INTO convites (token_hash, empresa_id, email, criado_por, expira_em)
      VALUES (?, ?, ?, ?, datetime('now', ?))`).run(hashToken(token), id, email, req.usuario.id, `+${DIAS_CONVITE} days`);
    res.status(201).json({ email, link: `${linkBase(req)}/convite.html?token=${token}`, validoPorDias: DIAS_CONVITE });
  });

  // O convite vale para o e-mail convidado: um link repassado para outra pessoa não funciona.
  app.post('/api/convites/:token/aceitar', (req, res) => {
    const c = db.prepare(`
      SELECT *, expira_em > datetime('now') AS valido FROM convites WHERE token_hash = ?`).get(hashToken(req.params.token));
    if (!c) return res.status(404).json({ erros: ['Convite não encontrado.'] });
    if (c.aceito_em) return res.status(410).json({ erros: ['Este convite já foi usado.'] });
    if (!c.valido) return res.status(410).json({ erros: ['Este convite expirou. Peça um novo.'] });
    if (c.email.toLowerCase() !== req.usuario.email.toLowerCase()) {
      return res.status(403).json({ erros: [`Este convite é para ${c.email}. Entre com essa conta.`] });
    }
    const papel = req.usuario.tipo === 'contador' ? 'contador' : 'membro';
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO acessos (usuario_id, empresa_id, papel) VALUES (?, ?, ?)')
        .run(req.usuario.id, c.empresa_id, papel);
      db.prepare("UPDATE convites SET aceito_por = ?, aceito_em = datetime('now') WHERE id = ?").run(req.usuario.id, c.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ empresaId: c.empresa_id });
  });

  // ================= Cálculos =================
  app.get('/api/calculos', (req, res) => {
    const limite = Math.min(Number(req.query.limite) || 20, 100);
    const linhas = db.prepare(`
      SELECT c.*, e.razao_social FROM calculos c
      JOIN empresas e ON e.id = c.empresa_id
      JOIN acessos a ON a.empresa_id = c.empresa_id AND a.usuario_id = ?
      ORDER BY c.criado_em DESC, c.id DESC LIMIT ?`).all(req.usuario.id, limite);
    res.json(linhas.map(calculoParaApi));
  });

  app.get('/api/calculos/:id', (req, res) => {
    const c = db.prepare(`
      SELECT c.*, e.razao_social FROM calculos c
      JOIN empresas e ON e.id = c.empresa_id
      JOIN acessos a ON a.empresa_id = c.empresa_id AND a.usuario_id = ?
      WHERE c.id = ?`).get(req.usuario.id, Number(req.params.id));
    if (!c) return res.status(404).end();
    res.json({ ...calculoParaApi(c), entrada: JSON.parse(c.entrada), resposta: c.resposta ? JSON.parse(c.resposta) : null });
  });

  app.post('/api/calculos', async (req, res) => {
    const b = req.body ?? {};
    const erros = validarCalculo(b);
    if (erros.length) return res.status(400).json({ erros });
    if (!papelNa(req.usuario.id, Number(b.empresaId))) return res.status(404).json({ erros: ['Empresa não encontrada.'] });
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(Number(b.empresaId));

    const salvar = db.prepare(`
      INSERT INTO calculos (empresa_id, usuario_id, regime, tp_doc, data_fato, situacao, itens_total, itens_calculados,
                            valor_base, v_cbs, v_ibs, v_is, mensagem, entrada, resposta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    try {
      const { payload, resposta, resumo } = await calcular(empresa, b);
      const { lastInsertRowid } = salvar.run(
        empresa.id, req.usuario.id, empresa.regime, b.tpDoc ?? null, b.data, resumo.situacao, resumo.itensTotal,
        resumo.itensCalculados, resumo.valorBase, resumo.vCBS, resumo.vIBS, resumo.vIS,
        resumo.erros.join('\n') || null, JSON.stringify(payload), JSON.stringify(resposta),
      );
      res.status(201).json({ id: Number(lastInsertRowid), ...resumo, resposta });
    } catch (e) {
      const mensagem = e.payload ? e.message : `Não foi possível falar com a calculadora (${e.message}).`;
      salvar.run(
        empresa.id, req.usuario.id, empresa.regime, b.tpDoc ?? null, b.data, 'erro', b.itens.length, 0,
        null, null, null, null, mensagem, JSON.stringify(e.payload ?? b),
        e.resposta ? JSON.stringify(e.resposta) : null,
      );
      res.status(502).json({ erros: [mensagem], resposta: e.resposta ?? null });
    }
  });

  return app;
}
