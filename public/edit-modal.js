// Hillside FD — Shared Record Edit Modal (Chief-level only)
// Included on pages with editable records (sick, recall, apparatus, vacation).
// Renders a small form from a field-definition list and PUTs to /edit-record.

const EDIT_MODAL = (() => {
  const API = '/.netlify/functions'

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // fields: [{ key, label, type: 'text'|'date'|'datetime-local'|'number'|'select'|'textarea', value, options?: [{value,label}] }]
  function open(table, id, fields, onSaved) {
    const modal = document.getElementById('editRecordModal')
    if (!modal) return

    const rowHtml = fields.map(f => {
      const val = f.value == null ? '' : f.value
      if (f.type === 'select') {
        const opts = (f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')
        return `<label class="block text-xs font-semibold text-gray-500 mb-1 mt-3">${esc(f.label)}</label>
          <select data-field="${f.key}" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm">${opts}</select>`
      }
      if (f.type === 'textarea') {
        return `<label class="block text-xs font-semibold text-gray-500 mb-1 mt-3">${esc(f.label)}</label>
          <textarea data-field="${f.key}" rows="2" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm">${esc(val)}</textarea>`
      }
      return `<label class="block text-xs font-semibold text-gray-500 mb-1 mt-3">${esc(f.label)}</label>
        <input data-field="${f.key}" type="${f.type || 'text'}" value="${esc(val)}"
          class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm">`
    }).join('')

    modal.innerHTML = `
      <div class="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-extrabold text-gray-800 mb-1">Edit Record</h2>
          <p class="text-xs text-gray-400 mb-2">Chief-level edit — changes are logged.</p>
          ${rowHtml}
          <div id="editModalErr" class="text-red-600 text-sm text-center mt-3 hidden"></div>
          <div class="flex gap-2 mt-4">
            <button onclick="EDIT_MODAL.close()" class="flex-1 text-gray-500 hover:text-gray-700 text-sm py-2">Cancel</button>
            <button onclick="EDIT_MODAL._save()" class="flex-1 bg-red-700 hover:bg-red-800 text-white font-bold rounded-xl py-2 text-sm transition">Save Changes</button>
          </div>
        </div>
      </div>`
    modal.dataset.table = table
    modal.dataset.id = id
    modal._onSaved = onSaved || null
  }

  function close() {
    const modal = document.getElementById('editRecordModal')
    if (modal) { modal.innerHTML = ''; modal._onSaved = null }
  }

  async function _save() {
    const modal = document.getElementById('editRecordModal')
    if (!modal) return
    const table = modal.dataset.table
    const id = modal.dataset.id
    const errEl = document.getElementById('editModalErr')
    const updates = {}
    modal.querySelectorAll('[data-field]').forEach(el => { updates[el.dataset.field] = el.value })

    try {
      const res = await fetch(`${API}/edit-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH.getHeaders() },
        body: JSON.stringify({ table, id, updates })
      })
      const data = await res.json()
      if (!res.ok) {
        if (errEl) { errEl.textContent = data.error || 'Error saving.'; errEl.classList.remove('hidden') }
        return
      }
      const cb = modal._onSaved
      close()
      if (cb) cb()
    } catch (e) {
      if (errEl) { errEl.textContent = 'Network error: ' + e.message; errEl.classList.remove('hidden') }
    }
  }

  return { open, close, _save }
})()
