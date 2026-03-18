// ── State ─────────────────────────────────────────────────────────────────────
let selectedFiles = []
let selectedExpiry = '1d'
const HISTORY_KEY = 'fluxbox_history'

// ── DOM ───────────────────────────────────────────────────────────────────────
const dropZone     = document.getElementById('drop-zone')
const fileInput    = document.getElementById('file-input')
const btnUpload    = document.getElementById('btn-upload')
const uploadText   = document.getElementById('upload-text')
const uploadIcon   = document.getElementById('upload-icon')
const uploadLoader = document.getElementById('upload-loader')
const progressWrap = document.getElementById('upload-progress')
const progressFill = document.getElementById('progress-fill')
const progressText = document.getElementById('progress-text')
const progressPct  = document.getElementById('progress-pct')
const resultBox    = document.getElementById('upload-result')
const previewWrap  = document.getElementById('preview-wrap')

if (!dropZone) throw new Error('Not on upload page')

// ── Expiry ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.expiry-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.expiry-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedExpiry = btn.dataset.value
  })
})

// ── Drop Zone ─────────────────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click())
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
dropZone.addEventListener('drop', e => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  handleFiles(Array.from(e.dataTransfer.files))
})
fileInput.setAttribute('multiple', true)
fileInput.addEventListener('change', () => handleFiles(Array.from(fileInput.files)))

// ── Handle Files ──────────────────────────────────────────────────────────────
function handleFiles(files) {
  const valid = files.filter(f => {
    if (f.size > 1024 * 1024 * 1024) {
      showToast(`"${f.name}" exceeds 1 GB limit`, 'error')
      return false
    }
    return true
  })
  if (!valid.length) return
  selectedFiles = valid
  renderPreviews()
  btnUpload.disabled = false
  uploadText.textContent = valid.length === 1
    ? `Upload "${valid[0].name}"`
    : `Upload ${valid.length} files`
}

function renderPreviews() {
  previewWrap.innerHTML = ''
  previewWrap.style.display = 'grid'
  selectedFiles.forEach(file => {
    const card = document.createElement('div')
    card.className = 'preview-card'
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img')
      img.src = URL.createObjectURL(file)
      img.className = 'preview-thumb'
      card.appendChild(img)
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement('video')
      video.src = URL.createObjectURL(file)
      video.className = 'preview-thumb'
      video.muted = true
      card.appendChild(video)
    } else {
      const ico = document.createElement('div')
      ico.className = 'preview-icon-box'
      ico.innerHTML = getIcon(file.type)
      card.appendChild(ico)
    }
    const info = document.createElement('div')
    info.className = 'preview-info'
    info.innerHTML = `
      <span class="preview-fname">${file.name.length > 22 ? file.name.slice(0,20)+'…' : file.name}</span>
      <span class="preview-fsize">${formatBytes(file.size)}</span>
    `
    card.appendChild(info)
    previewWrap.appendChild(card)
  })
}

// ── Upload ────────────────────────────────────────────────────────────────────
btnUpload.addEventListener('click', async () => {
  if (!selectedFiles.length) return
  setLoading(true)
  progressWrap.style.display = 'block'
  resultBox.style.display = 'none'

  const results = []
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i]
    try {
      const data = await uploadXHR(file, i, selectedFiles.length)
      results.push({ data, file })
      saveToHistory(data, file)
    } catch (err) {
      showToast(`Failed: ${file.name} — ${err.message}`, 'error')
    }
  }

  progressWrap.style.display = 'none'
  setLoading(false)
  if (results.length) showResults(results)
})

function uploadXHR(file, idx, total) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('expiry', selectedExpiry)

    const xhr = new XMLHttpRequest()
    let startTime = Date.now()

    xhr.upload.addEventListener('progress', e => {
      if (!e.lengthComputable) return
      const pct = ((idx + e.loaded / e.total) / total) * 100
      progressFill.style.width = pct + '%'
      progressPct.textContent = Math.round(pct) + '%'

      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      const speed = e.loaded / elapsed
      const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0
      progressText.textContent = `${formatBytes(speed)}/s · ${formatSeconds(remaining)} left · file ${idx+1}/${total}`
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const d = JSON.parse(xhr.responseText)
          d.success ? resolve(d) : reject(new Error(d.error || 'Upload failed'))
        } catch { reject(new Error('Invalid response')) }
      } else reject(new Error(`Server error ${xhr.status}`))
    })
    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.open('POST', '/api/upload')
    xhr.send(fd)
  })
}

// ── Results ───────────────────────────────────────────────────────────────────
function showResults(results) {
  resultBox.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'result-header'
  header.innerHTML = `
    <div class="result-check"><i class="fa-solid fa-circle-check"></i></div>
    <h2>${results.length === 1 ? 'File uploaded!' : `${results.length} files uploaded!`}</h2>
  `
  resultBox.appendChild(header)

  results.forEach(({ data, file }) => {
    const item = document.createElement('div')
    item.className = 'result-item'
    item.innerHTML = `
      <div class="result-file-info">
        <span class="result-fname">${file.name}</span>
        <span class="result-fmeta">${formatBytes(file.size)} · expires in ${data.expiraEm ? timeLeft(data.expiraEm) : '—'}</span>
      </div>
      <div class="result-link-row">
        <input type="text" value="${data.url}" readonly class="result-input" id="inp-${data.id}">
        <button onclick="copyId('${data.id}')" class="btn-copy-sm" id="copy-${data.id}" title="Copy link">
          <i class="fa-solid fa-copy"></i>
        </button>
        <a href="${data.url}" target="_blank" class="btn-view-sm" title="View file">
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
        </a>
      </div>
    `
    resultBox.appendChild(item)
  })

  // Auto-copy first link
  if (results.length === 1) {
    navigator.clipboard.writeText(results[0].data.url).then(() => {
      showToast('✓ Link copied to clipboard!', 'success')
    }).catch(() => {})
  } else {
    const allLinks = results.map(r => r.data.url).join('\n')
    navigator.clipboard.writeText(allLinks).then(() => {
      showToast(`✓ ${results.length} links copied!`, 'success')
    }).catch(() => {})
  }

  const actions = document.createElement('div')
  actions.className = 'result-actions'
  actions.innerHTML = `<button onclick="resetUpload()" class="btn-outline"><i class="fa-solid fa-plus"></i> New Upload</button>`
  resultBox.appendChild(actions)

  resultBox.style.display = 'block'
  resultBox.scrollIntoView({ behavior: 'smooth' })
}

function copyId(id) {
  const input = document.getElementById('inp-' + id)
  const btn = document.getElementById('copy-' + id)
  navigator.clipboard.writeText(input.value)
  btn.innerHTML = '<i class="fa-solid fa-check"></i>'
  setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-copy"></i>', 2000)
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetUpload() {
  selectedFiles = []
  fileInput.value = ''
  btnUpload.disabled = true
  uploadText.textContent = 'Select a file'
  previewWrap.innerHTML = ''
  previewWrap.style.display = 'none'
  resultBox.style.display = 'none'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── History (localStorage) ────────────────────────────────────────────────────
function saveToHistory(data, file) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    history.unshift({
      id: data.id,
      url: data.url,
      nome: file.name,
      tamanho: file.size,
      expiraEm: data.expiraEm,
      criadoEm: new Date().toISOString()
    })
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)))
    renderHistory()
  } catch {}
}

function renderHistory() {
  const container = document.getElementById('history-list')
  if (!container) return
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    const valid = history.filter(h => new Date(h.expiraEm) > new Date())
    if (!valid.length) {
      container.innerHTML = '<p class="history-empty">No recent uploads.</p>'
      return
    }
    container.innerHTML = valid.map(h => `
      <div class="history-item">
        <div class="history-info">
          <span class="history-name">${h.nome}</span>
          <span class="history-meta">${formatBytes(h.tamanho)} · <span class="history-timer" data-expires="${h.expiraEm}"></span></span>
        </div>
        <div class="history-actions">
          <button onclick="copyText('${h.url}')" class="btn-icon" title="Copy"><i class="fa-solid fa-copy"></i></button>
          <a href="${h.url}" target="_blank" class="btn-icon" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        </div>
      </div>
    `).join('')
    startTimers()
  } catch {}
}

function startTimers() {
  document.querySelectorAll('.history-timer').forEach(el => {
    const update = () => { el.textContent = timeLeft(el.dataset.expires) }
    update()
    const iv = setInterval(() => {
      if (!document.body.contains(el)) { clearInterval(iv); return }
      update()
    }, 1000)
  })
}

function copyText(url) {
  navigator.clipboard.writeText(url).then(() => showToast('✓ Copied!', 'success'))
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function setLoading(on) {
  btnUpload.disabled = on
  uploadIcon.style.display = on ? 'none' : 'inline-block'
  uploadLoader.style.display = on ? 'inline-block' : 'none'
  if (on) uploadText.textContent = 'Uploading...'
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024, s = ['B','KB','MB','GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + s[i]
}

function formatSeconds(s) {
  if (!isFinite(s) || s <= 0) return '0s'
  if (s < 60) return Math.round(s) + 's'
  return Math.floor(s/60) + 'm ' + Math.round(s%60) + 's'
}

function timeLeft(expiraEm) {
  const diff = new Date(expiraEm) - new Date()
  if (diff <= 0) return 'Expired'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function getIcon(type) {
  if (type.startsWith('video/')) return '<i class="fa-solid fa-video"></i>'
  if (type.startsWith('audio/')) return '<i class="fa-solid fa-music"></i>'
  if (type.includes('pdf')) return '<i class="fa-solid fa-file-pdf"></i>'
  if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '<i class="fa-solid fa-file-zipper"></i>'
  return '<i class="fa-solid fa-file"></i>'
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.textContent = msg
  document.body.appendChild(t)
  requestAnimationFrame(() => t.classList.add('toast-show'))
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300) }, 3000)
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderHistory()
