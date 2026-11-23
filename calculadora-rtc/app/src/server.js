import { config } from './config.js';
import { abrirBanco } from './db.js';
import { criarApp } from './app.js';

const db = abrirBanco(config.dbPath);
const app = criarApp(db);

app.listen(config.porta, () => {
  console.log(`Sistema no ar: http://localhost:${config.porta}`);
  console.log(`  Regime Regular   -> ${config.regimeRegularUrl}`);
  console.log(`  Simples Nacional -> ${config.simplesNacionalUrl}`);
});
