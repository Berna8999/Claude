// Banco do próprio sistema (empresas e histórico de cálculos).
// Usa o SQLite embutido no Node 22 (node:sqlite), sem dependência nativa.
// Não confundir com o banco das calculadoras, que fica dentro de cada contêiner.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS empresas (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      razao_social       TEXT    NOT NULL,
      cnpj               TEXT    NOT NULL UNIQUE,
      regime             TEXT    NOT NULL CHECK (regime IN ('regular', 'simples')),
      uf                 TEXT    NOT NULL,
      municipio_ibge     INTEGER NOT NULL,
      -- Só Simples Nacional: linha de alíquotas efetivas (JSON no formato
      -- "aliquotasEfetivas" da calculadora). Hoje vem do PGDAS-D, informada à mão.
      aliquotas_efetivas TEXT,
      criado_em          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calculos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_calculos_empresa ON calculos(empresa_id, criado_em DESC);
  `);
  return db;
}
