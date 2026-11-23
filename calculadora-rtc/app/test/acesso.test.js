// Testes de ponta a ponta da API: conta, separação de dados entre clientes e convite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';

let servidor;
let base;

before(async () => {
  const app = criarApp(abrirBanco(':memory:'));
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

// Cliente HTTP mínimo que guarda o cookie de sessão, como um navegador.
function cliente() {
  let cookie = '';
  return async (metodo, caminho, corpo) => {
    const resp = await fetch(`${base}/api${caminho}`, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const setCookie = resp.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const texto = await resp.text();
    return { status: resp.status, corpo: texto ? JSON.parse(texto) : null };
  };
}

const empresa = { razaoSocial: 'Padaria Pão Quente ME', cnpj: '11.444.777/0001-61', regime: 'simples', uf: 'SP', municipioIbge: '3550308' };

test('sem login, a API recusa os dados', async () => {
  const anonimo = cliente();
  assert.equal((await anonimo('GET', '/empresas')).status, 401);
  assert.equal((await anonimo('GET', '/eu')).status, 401);
});

test('cadastro valida os campos e não repete e-mail', async () => {
  const c = cliente();
  const ruim = await c('POST', '/auth/cadastro', { nome: '', email: 'x', senha: '123', tipo: 'outro' });
  assert.equal(ruim.status, 400);
  assert.equal(ruim.corpo.erros.length, 4);

  assert.equal((await c('POST', '/auth/cadastro', { nome: 'Ana', email: 'ana@teste.com', senha: 'senha-forte', tipo: 'empresa' })).status, 201);
  assert.equal((await cliente()('POST', '/auth/cadastro', { nome: 'Outra', email: 'ANA@teste.com', senha: 'senha-forte', tipo: 'empresa' })).status, 409);
});

test('login com senha errada falha; certa funciona; sair encerra a sessão', async () => {
  const c = cliente();
  assert.equal((await c('POST', '/auth/entrar', { email: 'ana@teste.com', senha: 'errada123' })).status, 401);
  const ok = await c('POST', '/auth/entrar', { email: 'ana@teste.com', senha: 'senha-forte' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.tipo, 'empresa');
  assert.equal((await c('GET', '/eu')).status, 200);
  assert.equal((await c('POST', '/auth/sair')).status, 204);
  assert.equal((await c('GET', '/eu')).status, 401);
});

test('cada conta só vê as próprias empresas, e o convite dá acesso ao contador', async () => {
  const dona = cliente();
  const contador = cliente();
  const intruso = cliente();
  await dona('POST', '/auth/cadastro', { nome: 'Bia Dona', email: 'bia@padaria.com', senha: 'senha-forte', tipo: 'empresa' });
  await contador('POST', '/auth/cadastro', { nome: 'Caio Contador', email: 'caio@escritorio.com', senha: 'senha-forte', tipo: 'contador' });
  await intruso('POST', '/auth/cadastro', { nome: 'Davi', email: 'davi@outro.com', senha: 'senha-forte', tipo: 'contador' });

  const criada = await dona('POST', '/empresas', empresa);
  assert.equal(criada.status, 201);
  assert.equal(criada.corpo.papel, 'dono');
  const id = criada.corpo.id;

  // O contador e o intruso não enxergam a empresa.
  assert.deepEqual((await contador('GET', '/empresas')).corpo, []);
  assert.equal((await intruso('GET', `/empresas/${id}/pessoas`)).status, 404);
  assert.equal((await intruso('POST', `/empresas/${id}/convites`, { email: 'davi@outro.com' })).status, 404);

  // A dona convida o contador.
  const convite = await dona('POST', `/empresas/${id}/convites`, { email: 'caio@escritorio.com' });
  assert.equal(convite.status, 201);
  const token = new URL(convite.corpo.link).searchParams.get('token');

  // Qualquer um vê de quem é o convite, mas só o e-mail convidado consegue aceitar.
  const info = await cliente()('GET', `/convites/${token}`);
  assert.deepEqual(info.corpo, { empresa: empresa.razaoSocial, convidadoPor: 'Bia Dona', email: 'caio@escritorio.com', situacao: 'pendente' });
  assert.equal((await intruso('POST', `/convites/${token}/aceitar`)).status, 403);

  assert.equal((await contador('POST', `/convites/${token}/aceitar`)).status, 200);
  const doContador = (await contador('GET', '/empresas')).corpo;
  assert.equal(doContador.length, 1);
  assert.equal(doContador[0].papel, 'contador');
  assert.equal(doContador[0].pessoas, 2);

  // Convite não pode ser usado duas vezes; o intruso continua sem ver nada.
  assert.equal((await contador('POST', `/convites/${token}/aceitar`)).status, 410);
  assert.deepEqual((await intruso('GET', '/empresas')).corpo, []);

  // O contador pode cadastrar o mesmo CNPJ? Não: ele já tem acesso a ele.
  assert.equal((await contador('POST', '/empresas', empresa)).status, 409);
  // Outro contador pode cadastrar o mesmo CNPJ na conta dele, sem ver a da dona.
  assert.equal((await intruso('POST', '/empresas', empresa)).status, 201);

  // O contador "sai" da empresa sem apagá-la para a dona.
  assert.equal((await contador('DELETE', `/empresas/${id}`)).status, 204);
  assert.equal((await contador('GET', '/empresas')).corpo.length, 0);
  assert.equal((await dona('GET', '/empresas')).corpo.length, 1);
});

test('pedido de outra origem é recusado', async () => {
  const resp = await fetch(`${base}/api/auth/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.com' },
    body: JSON.stringify({ email: 'ana@teste.com', senha: 'senha-forte' }),
  });
  assert.equal(resp.status, 403);
});
