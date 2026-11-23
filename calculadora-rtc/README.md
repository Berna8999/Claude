# Sistema Calculadora RTC

Sistema para empresas calcularem a **CBS**, o **IBS** e o **Imposto Seletivo** da Reforma Tributária (LC 214/2025),
usando como motor de cálculo as calculadoras oficiais e de código aberto da Receita Federal:

- [calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular) (v1.7.2)
- [calculadora-rtc-simples-nacional](https://github.com/ReceitaFederal/calculadora-rtc-simples-nacional) (v1.0.2)

## Arquitetura

```
 Navegador ──► app (Node.js, porta 3000)
                 │  tela inicial + API própria (/api/...)
                 │  banco próprio: empresas e histórico (SQLite)
                 │
                 ├──► regime-regular   (Java, porta 8080)  empresas do regime regular
                 └──► simples-nacional (Java, porta 8082)  empresas do Simples Nacional
```

As calculadoras rodam **sem alteração**, cada uma no seu contêiner. O sistema escolhe qual chamar
pelo regime da empresa. Para atualizar uma calculadora, troque a versão (`REF`) no `docker-compose.yml`.

O banco das calculadoras é gerado a partir dos scripts Flyway do repositório Regime Regular. O Simples Nacional
não tem Flyway próprio e usa esse mesmo banco (ver `docker/calculadora.Dockerfile`).

## Como rodar

### Tudo com Docker (recomendado)

```bash
docker compose up --build
```

- Sistema: http://localhost:3000
- Swagger do Regime Regular: http://localhost:8080/api/swagger-ui.html
- Swagger do Simples Nacional: http://localhost:8082/api/swagger-ui.html

O primeiro build demora, porque clona os repositórios, gera o banco e compila os JARs.

### Só a tela, sem o Java (desenvolvimento)

Precisa do Node 22.13 ou mais novo. O simulador responde nas mesmas portas das calculadoras reais, com valores
**fictícios**.

```bash
cd app
npm install
npm run mock     # num terminal: simula as duas calculadoras
npm run dev      # em outro terminal: sobe o sistema em http://localhost:3000
```

### Testes

```bash
cd app && npm test
```

## Estrutura

```
calculadora-rtc/
├── docker-compose.yml           sobe app + duas calculadoras
├── docker/calculadora.Dockerfile  build genérico das calculadoras oficiais
└── app/
    ├── src/
    │   ├── server.js            inicialização
    │   ├── app.js               rotas da API e validações
    │   ├── calculadoras.js      integração: monta o payload e lê a resposta de cada calculadora
    │   ├── db.js                banco do sistema (empresas e cálculos)
    │   └── config.js            variáveis de ambiente
    ├── public/                  tela inicial (HTML, CSS e JS, sem framework)
    ├── scripts/mock-calculadoras.js
    └── test/
```

## Contas e convites

- Cada pessoa cria a conta como **contador** (atende várias empresas) ou **empresa** (usa para o próprio CNPJ).
- Cada conta só enxerga as empresas em que tem acesso. Dois contadores podem cadastrar o mesmo CNPJ, e um não vê o
  do outro.
- **Convite:** pelo ícone ao lado da empresa, gera-se um link para um e-mail. A empresa convida o contador, ou o
  contador convida alguém da empresa. O link vale por 7 dias, só pode ser usado uma vez e só funciona para o e-mail
  convidado. Por enquanto o sistema não envia e-mail: o link é copiado e mandado por WhatsApp ou e-mail.
- Quem cadastrou a empresa pode apagá-la. Os demais só saem dela.
- Senhas guardadas com scrypt; sessão em cookie `httpOnly` de 30 dias; até 10 tentativas de login a cada 15 minutos.

Variáveis para produção:

| Variável | Para quê |
|---|---|
| `APP_URL` | Endereço público, usado nos links de convite (ex.: `https://app.seudominio.com.br`). Começando com `https`, o cookie passa a ser só HTTPS |
| `TRUST_PROXY` | `true` quando o sistema estiver atrás de um proxy (Caddy, Nginx) que faz o HTTPS |
| `COOKIE_SEGURO` | Força o cookie só HTTPS (`true`) ou não (`false`), ignorando `APP_URL` |

## API do sistema

| Método | Rota | Para quê |
|---|---|---|
| POST | `/api/auth/cadastro`, `/api/auth/entrar`, `/api/auth/sair` | Conta e sessão |
| GET | `/api/eu` | Usuário logado |
| GET | `/api/empresas/:id/pessoas` | Quem tem acesso e convites pendentes |
| POST | `/api/empresas/:id/convites` | Gera o link de convite para um e-mail |
| GET | `/api/convites/:token` | Dados do convite (público) |
| POST | `/api/convites/:token/aceitar` | Aceita o convite (precisa estar logado com o e-mail convidado) |
| GET | `/api/status` | Se as calculadoras estão no ar, e com qual versão |
| GET | `/api/resumo` | Números da tela inicial: empresas e totais do mês |
| GET/POST | `/api/empresas` | Lista e cadastra empresas (CNPJ, regime, UF, município IBGE) |
| DELETE | `/api/empresas/:id` | Remove a empresa e o histórico dela |
| GET | `/api/calculos?limite=20` | Últimos cálculos |
| GET | `/api/calculos/:id` | Um cálculo, com o payload enviado e a resposta completa da calculadora |
| POST | `/api/calculos` | Faz um cálculo (veja abaixo) |

Exemplo de cálculo:

```json
{
  "empresaId": 1,
  "data": "2027-03-10",
  "tpDoc": "55",
  "aliquotasNominais": { "cbs": 8.8, "ibsEstadual": 0.05, "ibsMunicipal": 0.05 },
  "itens": [
    { "ncm": "10063021", "cst": "200", "cClassTrib": "200003", "valor": 100.00 }
  ]
}
```

- **Regime Regular:** usa `cst`. A partir de 2027 as `aliquotasNominais` são obrigatórias, porque a tabela oficial
  de referência só tem 2026.
- **Simples Nacional:** usa `cAtivSN` (código da atividade) em cada item, e a linha de alíquotas efetivas
  cadastrada na empresa. Até a Release 16 da Receita, essas alíquotas vêm do PGDAS-D e são informadas à mão.

Os dois usam os endpoints de **observabilidade** das calculadoras: cada item tem seu próprio resultado, e um item
com erro não derruba a nota inteira. O cálculo fica salvo como `ok`, `parcial` ou `erro`.

## Próximos passos

- [ ] Tela de Empresas (editar e preencher as alíquotas efetivas de todos os anexos do Simples)
- [ ] Tela de Cálculos (histórico com filtro, detalhe com a memória de cálculo)
- [ ] Tabelas oficiais: busca de NCM, NBS e cClassTrib pelos dados abertos da calculadora
- [ ] Importar itens de XML de NF-e ou de planilha
- [x] Login, separação dos dados por cliente e convite entre contador e empresa
- [ ] Trocar o SQLite pelo PostgreSQL (Supabase)
- [ ] Enviar o convite por e-mail e recuperar senha
- [ ] Gerar o XML do grupo de tributação (`/calculadora/xml/generate`)
