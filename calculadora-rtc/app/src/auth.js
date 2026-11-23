// Login por e-mail e senha, com sessão em cookie httpOnly.
// Senhas: scrypt com sal aleatório. Sessões e convites: guardamos só o hash do token,
// então quem ler o banco não consegue se passar por ninguém.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const COOKIE = 'sessao';
const DURACAO_SESSAO_DIAS = 30;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const novoToken = () => randomBytes(32).toString('base64url');

export function hashSenha(senha) {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export function conferirSenha(senha, guardado) {
  const [alg, salB64, hashB64] = String(guardado).split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = scryptSync(senha, Buffer.from(salB64, 'base64'), esperado.length);
  return timingSafeEqual(esperado, calculado);
}

function lerCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? '').split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export function criarSessao(db, res, usuarioId, { seguro }) {
  const token = novoToken();
  db.prepare("INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, datetime('now', ?))")
    .run(hashToken(token), usuarioId, `+${DURACAO_SESSAO_DIAS} days`);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: seguro,
    maxAge: DURACAO_SESSAO_DIAS * 864e5,
    path: '/',
  });
}

export function encerrarSessao(db, req, res) {
  const token = lerCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
}

// Coloca req.usuario quando há sessão válida (não bloqueia).
export function carregarUsuario(db) {
  const buscar = db.prepare(`
    SELECT u.id, u.nome, u.email, u.tipo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_em > datetime('now')`);
  return (req, _res, next) => {
    const token = lerCookies(req)[COOKIE];
    req.usuario = token ? buscar.get(hashToken(token)) ?? null : null;
    next();
  };
}

export function exigirLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erros: ['Entre na sua conta para continuar.'] });
  next();
}

// Limite simples contra tentativa de senha em massa: 10 tentativas por 15 minutos por IP + e-mail.
export function limitadorLogin() {
  const tentativas = new Map();
  const janelaMs = 15 * 60 * 1000;
  return {
    bloqueado(chave) {
      const t = tentativas.get(chave);
      if (!t || Date.now() - t.inicio > janelaMs) return false;
      return t.n >= 10;
    },
    falhou(chave) {
      const t = tentativas.get(chave);
      if (!t || Date.now() - t.inicio > janelaMs) tentativas.set(chave, { n: 1, inicio: Date.now() });
      else t.n += 1;
    },
    limpar(chave) { tentativas.delete(chave); },
  };
}
