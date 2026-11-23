// Banco do próprio sistema: usuários, empresas, acessos, convites e cálculos.
// Usa o SQLite embutido no Node 22 (node:sqlite), sem dependência nativa.
// Não confundir com o banco das calculadoras, que fica dentro de cada contêiner.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSAO_ESQUEMA = 2;

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const versao = db.prepare('PRAGMA user_version').get().user_version;
  const temEmpresas = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'empresas'").get();

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      senha_hash TEXT NOT NULL,
      -- contador: atende várias empresas · empresa: usa o sistema para o próprio CNPJ
      tipo       TEXT NOT NULL CHECK (tipo IN ('contador', 'empresa')),
      criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expira_em  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS empresas (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      razao_social       TEXT    NOT NULL,
      cnpj               TEXT    NOT NULL,
      regime             TEXT    NOT NULL CHECK (regime IN ('regular', 'simples')),
      uf                 TEXT    NOT NULL,
      municipio_ibge     INTEGER NOT NULL,
      -- Só Simples Nacional: linha de alíquotas efetivas (JSON no formato
      -- "aliquotasEfetivas" da calculadora). Hoje vem do PGDAS-D, informada à mão.
      aliquotas_efetivas TEXT,
      criado_por         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Quem enxerga cada empresa. Uma empresa pode ter o dono e o contador dela.
    CREATE TABLE IF NOT EXISTS acessos (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      papel      TEXT    NOT NULL CHECK (papel IN ('dono', 'contador', 'membro')),
      criado_em  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (usuario_id, empresa_id)
    );

    CREATE TABLE IF NOT EXISTS convites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash  TEXT    NOT NULL UNIQUE,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      email       TEXT    NOT NULL COLLATE NOCASE,
      criado_por  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em   TEXT    NOT NULL DEFAULT (datetime('now')),
      expira_em   TEXT    NOT NULL,
      aceito_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      aceito_em   TEXT
    );

    CREATE TABLE IF NOT EXISTS calculos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      usuario_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      regime           TEXT    NOT NULL,
      tp_doc           TEXT,
      data_fato        TEXT    NOT NULL,
      situacao         TEXT    NOT NULL CHECK (situacao IN ('ok', 'parcial', 'erro')),
      itens_total      INTEGER NOT NULL DEFAULT 0,
      itens_calculados INTEGER NOT NULL DEFAULT 0,
      valor_base       REAL,
      v_cbs            REAL,
      v_ibs            REAL,
      v_is             REAL,
      mensagem         TEXT,
      entrada          TEXT    NOT NULL,
      resposta         TEXT,
      criado_em        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Banco criado pela versão sem login: acrescenta as colunas novas.
  // As empresas antigas ficam sem dono (invisíveis) até alguém cadastrá-las de novo.
  if (versao < 2 && temEmpresas) {
    const colunas = (tabela) => db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
    if (!colunas('empresas').includes('criado_por')) {
      db.exec('ALTER TABLE empresas ADD COLUMN criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL');
    }
    if (!colunas('calculos').includes('usuario_id')) {
      db.exec('ALTER TABLE calculos ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL');
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_calculos_empresa ON calculos(empresa_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_acessos_empresa ON acessos(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
    PRAGMA user_version = ${VERSAO_ESQUEMA};
  `);
  return db;
}
