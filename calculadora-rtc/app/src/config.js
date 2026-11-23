// Configuração lida das variáveis de ambiente (com padrões para rodar local).
const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');

export const config = {
  porta: Number(process.env.PORT ?? 3000),
  // Endereço público do sistema, usado nos links de convite (ex.: https://app.seudominio.com.br).
  // Vazio: usa o endereço da própria requisição.
  appUrl,
  // Cookie de sessão só por HTTPS. Liga sozinho quando APP_URL começa com https.
  cookieSeguro: process.env.COOKIE_SEGURO ? process.env.COOKIE_SEGURO === 'true' : appUrl.startsWith('https://'),
  // Atrás de um proxy reverso (Caddy, Nginx), para o IP e o protocolo saírem certos.
  trustProxy: process.env.TRUST_PROXY === 'true',
  // URLs base das calculadoras oficiais (já incluem o context-path /api).
  regimeRegularUrl: (process.env.REGIME_REGULAR_URL ?? 'http://localhost:8080/api').replace(/\/$/, ''),
  simplesNacionalUrl: (process.env.SIMPLES_NACIONAL_URL ?? 'http://localhost:8082/api').replace(/\/$/, ''),
  dbPath: process.env.DB_PATH ?? './data/sistema.db',
  timeoutCalculoMs: Number(process.env.TIMEOUT_CALCULO_MS ?? 15000),
  timeoutStatusMs: Number(process.env.TIMEOUT_STATUS_MS ?? 3000),
};
