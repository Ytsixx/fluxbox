import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import expressLayouts from 'express-ejs-layouts'
import { UTApi } from 'uploadthing/server'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import cron from 'node-cron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  salvarUpload, listarUploads, buscarUpload,
  deletarUpload, limparExpirados, estatisticas
} from './database/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'fluxbox-admin-2025'

// ── UploadThing ───────────────────────────────────────────────────────────────
const utapi = new UTApi()

// ── Multer (memória) ──────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
})

// ── Expiração em ms ───────────────────────────────────────────────────────────
const EXPIRY_OPTIONS = {
  '1d': 24 * 60 * 60 * 1000,
  '2d': 2 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
}

const EXPIRY_LABELS = {
  '1d': '1 Day',
  '2d': '2 Days',
  '3d': '3 Days',
}

// ── Segurança ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(join(__dirname, 'public')))

// ── Template Engine ───────────────────────────────────────────────────────────
app.use(expressLayouts)
app.set('layout', 'layout')
app.set('view engine', 'ejs')
app.set('views', join(__dirname, 'views'))

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function tempoRestante(expiraEm) {
  const diff = new Date(expiraEm) - new Date()
  if (diff <= 0) return 'Expirado / Expired'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Cron: limpar expirados a cada hora ───────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  const count = limparExpirados()
  if (count > 0) console.log(`🗑️ ${count} ficheiros expirados removidos`)
})

// ── Rotas Públicas ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.render('index', {
    title: 'FluxBox — Temporary File Hosting',
    description: 'Upload and share files temporarily. Free, fast and no registration required.',
    expiryOptions: EXPIRY_LABELS,
    layout: 'layout',
  })
})

app.get('/history', (req, res) => {
  const uploads = listarUploads()
  res.render('history', {
    title: 'History / Histórico — FluxBox',
    description: 'Your recent uploads on FluxBox.',
    uploads,
    formatBytes,
    tempoRestante,
    layout: 'layout',
  })
})

app.get('/f/:id', (req, res) => {
  const upload = buscarUpload(req.params.id)
  if (!upload) {
    return res.status(404).render('404', {
      title: '404 — FluxBox',
      description: 'File not found.',
      layout: 'layout',
    })
  }
  const expirado = new Date(upload.expiraEm) < new Date()
  res.render('file', {
    title: `${upload.nome} — FluxBox`,
    description: `Download ${upload.nome} on FluxBox.`,
    upload,
    expirado,
    formatBytes,
    tempoRestante,
    layout: 'layout',
  })
})

// ── Upload API ────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' })

    const expiry = req.body.expiry || '1d'
    if (!EXPIRY_OPTIONS[expiry]) return res.status(400).json({ error: 'Invalid expiry.' })

    // Upload para UploadThing
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype })
    const file = new File([blob], req.file.originalname, { type: req.file.mimetype })
    const response = await utapi.uploadFiles(file)

    if (!response.data) throw new Error(response.error?.message || 'Upload failed.')

    const id = uuidv4().split('-')[0] + uuidv4().split('-')[0]
    const expiraEm = new Date(Date.now() + EXPIRY_OPTIONS[expiry])

    const uploadData = {
      id,
      nome: req.file.originalname,
      tipo: req.file.mimetype,
      tamanho: req.file.size,
      url: response.data.url,
      utKey: response.data.key,
      expiry,
      expiraEm: expiraEm.toISOString(),
      criadoEm: new Date().toISOString(),
    }

    salvarUpload(uploadData)

    res.json({
      success: true,
      id,
      url: `https://files.fluxdev.site/f/${id}`,
      directUrl: response.data.url,
      expiraEm: expiraEm.toISOString(),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// ── Admin ─────────────────────────────────────────────────────────────────────
app.get(`/${ADMIN_SECRET}`, (req, res) => {
  const uploads = listarUploads()
  const stats = estatisticas()
  res.render('admin', {
    title: 'Admin — FluxBox',
    description: '',
    uploads,
    stats,
    formatBytes,
    tempoRestante,
    layout: 'layout',
  })
})

app.post(`/${ADMIN_SECRET}/deletar`, async (req, res) => {
  const { id } = req.body
  const upload = buscarUpload(id)
  if (upload) {
    try { await utapi.deleteFiles(upload.utKey) } catch {}
    deletarUpload(id)
  }
  res.redirect(`/${ADMIN_SECRET}`)
})

app.post(`/${ADMIN_SECRET}/limpar-expirados`, async (req, res) => {
  const uploads = listarUploads()
  const expirados = uploads.filter(u => new Date(u.expiraEm) < new Date())
  for (const u of expirados) {
    try { await utapi.deleteFiles(u.utKey) } catch {}
  }
  limparExpirados()
  res.redirect(`/${ADMIN_SECRET}`)
})

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', {
    title: '404 — FluxBox',
    description: 'Page not found.',
    layout: 'layout',
  })
})

app.listen(PORT, () => console.log(`📦 FluxBox rodando em http://localhost:${PORT}`))
