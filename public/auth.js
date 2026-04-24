// Hillside FD — Shared Auth Module
// Included on every page. Manages login session, login modal, PIN change modal, nav slot.

const AUTH = (() => {
  const KEY = 'hfd_session'
  const API = '/.netlify/functions'
  let officersList = []
  let _loginCallback = null

  // ── Session helpers ──────────────────────────────────────────────────────────

  function getSession() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      const s = JSON.parse(raw)
      if (!s || !s.token || !s.expires_at) return null
      if (new Date(s.expires_at) <= new Date()) { localStorage.removeItem(KEY); return null }
      return s
    } catch { return null }
  }

  function isLoggedIn() { return !!getSession() }
  function isOfficer() { const s = getSession(); return !!(s && (s.role === 'officer' || s.role === 'admin')) }
  function isAdmin() { const s = getSession(); return !!(s && s.role === 'admin') }
  function getDisplayName() { return getSession()?.display_name || null }
  function getHeaders() {
    const s = getSession()
    return s ? { 'x-session-token': s.token } : {}
  }

  // ── Nav slot ─────────────────────────────────────────────────────────────────

  function updateNav() {
    const slot = document.getElementById('authSlot')
    if (!slot) return
    const s = getSession()
    if (s) {
      slot.innerHTML = `
        <span class="text-white text-xs font-semibold opacity-90 hidden sm:inline max-w-[140px] truncate">${s.display_name}</span>
        <button onclick="AUTH.logout()" style="min-height:32px" class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white text-xs font-bold px-3 py-1 rounded-lg transition">Log Out</button>
      `
    } else {
      slot.innerHTML = `
        <button onclick="AUTH.showLoginModal()" style="min-height:32px" class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white text-xs font-bold px-3 py-1 rounded-lg transition">Log In</button>
      `
    }
  }

  // ── Officers list ─────────────────────────────────────────────────────────────

  async function loadOfficers() {
    try {
      const res = await fetch(`${API}/get-officers`)
      if (res.ok) officersList = await res.json()
    } catch {}
  }

  function getActingOfficers() {
    return officersList.filter(o => o.is_temporary)
  }

  function buildOfficerOptions() {
    const regular = officersList.filter(o => !o.is_temporary)
    const acting  = officersList.filter(o => o.is_temporary)
    let html = '<option value="">Select your name...</option>'
    if (regular.length) {
      html += '<optgroup label="Officers">'
      for (const o of regular) html += `<option value="${o.name}">${o.display_name}</option>`
      html += '</optgroup>'
    }
    if (acting.length) {
      html += '<optgroup label="Acting Officers (today only)">'
      for (const o of acting) html += `<option value="${o.name}">${o.display_name}</option>`
      html += '</optgroup>'
    }
    return html
  }

  // ── Login modal ───────────────────────────────────────────────────────────────

  function showLoginModal(onSuccess) {
    _loginCallback = onSuccess || null
    const modal = document.getElementById('authModal')
    if (!modal) return
    modal.innerHTML = `
      <div class="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <h2 class="text-xl font-extrabold text-gray-800 mb-4">Officer Login</h2>
          <select id="loginName" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500" style="min-height:44px">
            ${buildOfficerOptions()}
          </select>
          <input id="loginPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="PIN"
            class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500"
            style="min-height:44px"
            onkeydown="if(event.key==='Enter') AUTH._doLogin()">
          <div id="loginError" class="text-red-600 text-sm text-center mb-2 hidden"></div>
          <button onclick="AUTH._doLogin()" class="w-full bg-red-700 hover:bg-red-800 text-white font-bold rounded-xl py-3 transition mb-2">Log In</button>
          <button onclick="AUTH.hideModal()" class="w-full text-gray-400 hover:text-gray-600 text-sm py-2">Cancel — view only</button>
        </div>
      </div>
    `
  }

  function hideModal() {
    const modal = document.getElementById('authModal')
    if (modal) modal.innerHTML = ''
    _loginCallback = null
  }

  async function _doLogin() {
    const nameEl = document.getElementById('loginName')
    const pinEl  = document.getElementById('loginPin')
    const errEl  = document.getElementById('loginError')
    const name = nameEl?.value || ''
    const pin  = pinEl?.value  || ''

    errEl.classList.add('hidden')
    if (!name) { errEl.textContent = 'Select your name.'; errEl.classList.remove('hidden'); return }
    if (!pin)  { errEl.textContent = 'Enter your PIN.';   errEl.classList.remove('hidden'); return }

    try {
      const res = await fetch(`${API}/officer-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin })
      })
      const data = await res.json()
      if (!res.ok) { errEl.textContent = data.error || 'Login failed.'; errEl.classList.remove('hidden'); return }

      localStorage.setItem(KEY, JSON.stringify(data))
      updateNav()

      if (data.must_change_pin) {
        showChangePinModal(true)
        return
      }

      hideModal()
      const cb = _loginCallback
      _loginCallback = null
      if (cb) cb(data)
    } catch (e) {
      errEl.textContent = 'Network error: ' + e.message
      errEl.classList.remove('hidden')
    }
  }

  // ── PIN change modal ──────────────────────────────────────────────────────────

  function showChangePinModal(forced) {
    const modal = document.getElementById('authModal')
    if (!modal) return
    modal.innerHTML = `
      <div class="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <h2 class="text-xl font-extrabold text-gray-800 mb-1">Change Your PIN</h2>
          ${forced ? '<p class="text-sm text-orange-600 font-semibold mb-4">First login — set a new PIN before continuing.</p>' : '<p class="text-sm text-gray-500 mb-4">Choose a new 4–6 digit PIN.</p>'}
          <input id="newPin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="New PIN (4–6 digits)"
            class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500" style="min-height:44px">
          <input id="newPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="Confirm new PIN"
            class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500" style="min-height:44px">
          <div id="pinErr" class="text-red-600 text-sm text-center mb-2 hidden"></div>
          <button onclick="AUTH._doChangePin(${!!forced})" class="w-full bg-red-700 hover:bg-red-800 text-white font-bold rounded-xl py-3 transition">Save PIN</button>
          ${!forced ? '<button onclick="AUTH.hideModal()" class="w-full text-gray-400 hover:text-gray-600 text-sm mt-2 py-2">Cancel</button>' : ''}
        </div>
      </div>
    `
  }

  async function _doChangePin(forced) {
    const p1 = document.getElementById('newPin1')?.value || ''
    const p2 = document.getElementById('newPin2')?.value || ''
    const errEl = document.getElementById('pinErr')
    errEl.classList.add('hidden')

    if (p1.length < 4) { errEl.textContent = 'PIN must be at least 4 digits.'; errEl.classList.remove('hidden'); return }
    if (p1 !== p2)     { errEl.textContent = 'PINs do not match.';             errEl.classList.remove('hidden'); return }

    const session = getSession()
    if (!session) { errEl.textContent = 'Session expired — please log in again.'; errEl.classList.remove('hidden'); return }

    try {
      const res = await fetch(`${API}/officer-change-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ new_pin: p1 })
      })
      const data = await res.json()
      if (!res.ok) { errEl.textContent = data.error || 'Error saving PIN.'; errEl.classList.remove('hidden'); return }

      // Clear must_change_pin in local session
      const s = getSession()
      if (s) { s.must_change_pin = false; localStorage.setItem(KEY, JSON.stringify(s)) }

      hideModal()
      const cb = _loginCallback
      _loginCallback = null
      if (cb) cb(getSession())
    } catch (e) {
      errEl.textContent = 'Network error: ' + e.message
      errEl.classList.remove('hidden')
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────────

  async function logout() {
    const s = getSession()
    if (s) {
      try {
        await fetch(`${API}/officer-logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getHeaders() }
        })
      } catch {}
    }
    localStorage.removeItem(KEY)
    updateNav()
    location.reload()
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    await loadOfficers()
    updateNav()
  }

  document.addEventListener('DOMContentLoaded', init)

  return {
    getSession, isLoggedIn, isOfficer, isAdmin, getDisplayName, getHeaders,
    showLoginModal, hideModal, showChangePinModal,
    logout, updateNav, loadOfficers, getActingOfficers,
    _doLogin, _doChangePin
  }
})()
