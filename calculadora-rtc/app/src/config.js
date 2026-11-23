// Configuração lida das variáveis de ambiente (com padrões para rodar local).
export const config = {
  porta: Number(process.env.PORT ?? 3000),
  // URLs base das calculadoras oficiais (já incluem o context-path /api).
  regimeRegularUrl: (process.env.REGIME_REGULAR_URL ?? 'http://localhost:8080/api').replace(/\/$/, ''),
  simplesNacionalUrl: (process.env.SIMPLES_NACIONAL_URL ?? 'http://localhost:8082/api').replace(/\/$/, ''),
  dbPath: process.env.DB_PATH ?? './data/sistema.db',
  timeoutCalculoMs: Number(process.env.TIMEOUT_CALCULO_MS ?? 15000),
  timeoutStatusMs: Number(process.env.TIMEOUT_STATUS_MS ?? 3000),
};
