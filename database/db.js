import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IS_VERCEL = process.env.VERCEL === '1'
const DATA_DIR = IS_VERCEL ? '/tmp' : join(__dirname, '../data')
const DB_PATH = join(DATA_DIR, 'uploads.json')

// Garantir que a pasta data existe (só localmente)
if (!IS_VERCEL && !existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
if (!existsSync(DB_PATH)) writeFileSync(DB_PATH, '[]')

function lerDB() {
  try { return JSON.parse(readFileSync(DB_PATH, 'utf-8')) }
  catch { return [] }
}

function salvarDB(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

export function salvarUpload(upload) {
  const db = lerDB()
  db.unshift(upload) // mais recente primeiro
  salvarDB(db)
  return upload
}

export function listarUploads() {
  return lerDB()
}

export function buscarUpload(id) {
  return lerDB().find(u => u.id === id) || null
}

export function deletarUpload(id) {
  let db = lerDB()
  db = db.filter(u => u.id !== id)
  salvarDB(db)
}

export function limparExpirados() {
  let db = lerDB()
  const agora = new Date()
  const expirados = db.filter(u => new Date(u.expiraEm) < agora)
  db = db.filter(u => new Date(u.expiraEm) >= agora)
  salvarDB(db)
  return expirados.length
}

export function estatisticas() {
  const db = lerDB()
  const agora = new Date()
  const ativos = db.filter(u => new Date(u.expiraEm) >= agora)
  const totalBytes = ativos.reduce((acc, u) => acc + (u.tamanho || 0), 0)
  return {
    total: db.length,
    ativos: ativos.length,
    expirados: db.length - ativos.length,
    totalBytes,
    totalMB: (totalBytes / 1024 / 1024).toFixed(2)
  }
}
