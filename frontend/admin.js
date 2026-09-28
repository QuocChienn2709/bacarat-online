(function(){
"use strict";

const API = window.API_URL;

let token = localStorage.getItem("bac_admin_token");
let currentAction = null;
let currentUserId = null;
let usersCache = [];
let codesCache = [];
let soundsCache = {};

const $ = id => document.getElementById(id);

const SOUND_KEYS = ["betWarning", "betStop", "deal", "win", "lose", "click", "dealer"];
const SOUND_META = {
 betWarning: { icon: "⏰", name: "Cảnh báo 10s", desc: "Phát khi còn 10 giây đặt cược" },
    betStop:    { icon: "🛑", name: "Dừng đặt cược", desc: "Phát khi hết thời gian đặt cược" },
    deal:       { icon: "🎴", name: "Lật bài", desc: "Phát khi lật mỗi lá bài" },
    win:        { icon: "🎉", name: "Thắng", desc: "Phát khi người chơi thắng" },
    lose:       { icon: "😔", name: "Thua", desc: "Phát khi người chơi thua" },
    click:      { icon: "🖱️", name: "Click", desc: "Phát khi bấm nút" },
    dealer:     { icon: "🎩", name: "Dealer nói", desc: "Phát khi dealer gửi tin" }
};

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(API + path, {
    ...options, headers: { ...headers, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi máy chủ");
  return data;
}

function escapeHTML(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ============ AUTH ============
async function login() {
  const username = $("adminUser").value.trim();
  const password = $("adminPass").value;
  try {
    const res = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    token = res.token;
    localStorage.setItem("bac_admin_token", token);
    $("loginMsg").textContent = "";
    showDashboard();
  } catch (e) { $("loginMsg").textContent = e.message; }
}

function logout() {
  token = null;
  localStorage.removeItem("bac_admin_token");
  $("loginBox").classList.remove("hidden");
  $("dashboard").classList.add("hidden");
}

function showDashboard() {
  $("loginBox").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  loadAll();
}

function loadAll() {
  loadUsers();
  loadCodes();
  loadSounds();
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add("active");
  $(`tab${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.remove("hidden");
}

// ============ USERS ============
async function loadUsers() {
  try {
    usersCache = await api("/api/admin/users");
    renderUsers();
  } catch (e) { alert("Lỗi tải users: " + e.message); logout(); }
}

function renderUsers() {
  const q = ($("search").value || "").toLowerCase();
  const filtered = usersCache.filter(u => u.username.toLowerCase().includes(q));

  let totalBalance = 0, totalRounds = 0;
  usersCache.forEach(u => { totalBalance += u.balance; totalRounds += u.roundsPlayed; });
  $("totalUsers").textContent = usersCache.length;
  $("totalBalance").textContent = totalBalance.toLocaleString("vi-VN");
  $("totalRounds").textContent = totalRounds.toLocaleString("vi-VN");

  $("usersTable").innerHTML = filtered.map(u => {
    const avatarHTML = u.avatar ? `<img src="${u.avatar}" alt="">`
                                : escapeHTML(u.username.charAt(0).toUpperCase());
    return `
    <tr>
      <td><div class="admin-avatar">${avatarHTML}</div></td>
      <td><b>@${escapeHTML(u.username)}</b></td>
      <td class="pass-cell">${escapeHTML(u.plainPassword || "***")}</td>
      <td class="balance">${u.balance.toLocaleString("vi-VN")}</td>
      <td>${u.streak}</td>
      <td>${u.roundsPlayed}</td>
      <td>${(u.totalBet || 0).toLocaleString("vi-VN")}</td>
      <td>${(u.totalWin || 0).toLocaleString("vi-VN")}</td>
      <td>${u.banned ? "🔴 Khóa" : "🟢 Hoạt động"}</td>
      <td>
        <div class="actions">
          <button class="success small" onclick="Admin.openMoney('add','${u.id}','${escapeHTML(u.username)}',${u.balance})">+Tiền</button>
          <button class="danger small" onclick="Admin.openMoney('sub','${u.id}','${escapeHTML(u.username)}',${u.balance})">-Tiền</button>
          <button class="warn small" onclick="Admin.openMoney('set','${u.id}','${escapeHTML(u.username)}',${u.balance})">=Đặt</button>
          <button class="small" onclick="Admin.resetPass('${u.id}','${escapeHTML(u.username)}')">🔑Pass</button>
          <button class="small" onclick="Admin.resetAvatar('${u.id}','${escapeHTML(u.username)}')">📷Avatar</button>
          <button class="small" onclick="Admin.toggleBan('${u.id}','${escapeHTML(u.username)}')">${u.banned ? "Mở khóa" : "Khóa"}</button>
          <button class="danger small" onclick="Admin.deleteUser('${u.id}','${escapeHTML(u.username)}')">Xóa</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function openMoney(action, id, username, balance) {
  currentAction = action; currentUserId = id;
  $("modalUser").textContent = "@" + username;
  $("modalBalance").textContent = balance.toLocaleString("vi-VN");
  $("modalAmount").value = "";
  const titles = { add: "Cộng tiền", sub: "Trừ tiền", set: "Đặt số dư" };
  $("modalTitle").textContent = titles[action];
  $("moneyModal").classList.add("show");
  setTimeout(() => $("modalAmount").focus(), 100);
}

function closeModal() {
  $("moneyModal").classList.remove("show");
  currentAction = null; currentUserId = null;
}

async function submitMoney() {
  const amount = Number($("modalAmount").value);
  if (amount < 0 || isNaN(amount)) { alert("Số tiền không hợp lệ"); return; }
  const path = currentAction === "add" ? "add"
             : currentAction === "sub" ? "subtract" : "set";
  const body = currentAction === "set" ? { balance: amount } : { amount };
  try {
    await api(`/api/admin/users/${currentUserId}/${path}`, {
      method: "POST", body: JSON.stringify(body)
    });
    closeModal(); loadUsers();
  } catch (e) { alert(e.message); }
}

async function toggleBan(id, username) {
  try {
    await api(`/api/admin/users/${id}/toggle-ban`, { method: "POST" });
    loadUsers();
  } catch (e) { alert(e.message); }
}

async function resetPass(id, username) {
  const newPassword = prompt(`Nhập mật khẩu mới cho @${username}:`);
  if (!newPassword) return;
  if (newPassword.length < 4) { alert("Mật khẩu ≥ 4 ký tự"); return; }
  try {
    await api(`/api/admin/users/${id}/reset-password`, {
      method: "POST", body: JSON.stringify({ newPassword })
    });
    alert("✅ Đã reset mật khẩu"); loadUsers();
  } catch (e) { alert(e.message); }
}

async function resetAvatar(id, username) {
  if (!confirm(`Xóa avatar của @${username}?`)) return;
  try {
    await api(`/api/admin/users/${id}/reset-avatar`, { method: "POST" });
    alert("✅ Đã xóa avatar"); loadUsers();
  } catch (e) { alert(e.message); }
}

async function deleteUser(id, username) {
  if (!confirm(`Xóa tài khoản @${username}?`)) return;
  try {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    loadUsers();
  } catch (e) { alert(e.message); }
}

// ============ CODES ============
async function loadCodes() {
  try {
    codesCache = await api("/api/admin/codes");
    renderCodes();
  } catch (e) { console.error("Lỗi tải code:", e); }
}

function renderCodes() {
  const q = ($("codeSearch").value || "").toUpperCase();
  const filtered = codesCache.filter(c => c.code.toUpperCase().includes(q));

  let totalValue = 0, activeCount = 0;
  codesCache.forEach(c => { totalValue += c.value * c.usedCount; if (c.active) activeCount++; });
  $("totalCodes").textContent = codesCache.length;
  $("activeCodes").textContent = activeCount;
  $("totalValue").textContent = totalValue.toLocaleString("vi-VN");

  $("codesTable").innerHTML = filtered.map(c => {
    const maxLabel = c.maxUses === 0 ? "∞" : c.maxUses.toLocaleString("vi-VN");
    const expires = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("vi-VN") : "—";
    const isExpired = c.expiresAt && new Date(c.expiresAt) < new Date();
    let statusBadge;
    if (!c.active) statusBadge = `<span class="code-badge inactive">Đã tắt</span>`;
    else if (isExpired) statusBadge = `<span class="code-badge inactive">Hết hạn</span>`;
    else if (c.maxUses > 0 && c.usedCount >= c.maxUses) statusBadge = `<span class="code-badge inactive">Hết lượt</span>`;
    else statusBadge = `<span class="code-badge active">Hoạt động</span>`;

    return `
    <tr>
      <td class="code-cell">${escapeHTML(c.code)}</td>
      <td class="code-value">${c.value.toLocaleString("vi-VN")}</td>
      <td class="code-stat"><b>${c.usedCount}</b></td>
      <td class="code-stat"><small>${maxLabel}</small></td>
      <td class="code-stat"><small>${c.maxUsesPerUser} lần</small></td>
      <td class="code-stat"><small>${c.uniqueUsers} người</small></td>
      <td class="code-stat ${isExpired ? 'code-expired' : ''}"><small>${expires}</small></td>
      <td>${statusBadge}</td>
      <td>
        <div class="actions">
          <button class="small" onclick="Admin.toggleCode('${c.id}')">${c.active ? "Tắt" : "Bật"}</button>
          <button class="warn small" onclick="Admin.resetCode('${c.id}','${escapeHTML(c.code)}')">Reset</button>
          <button class="danger small" onclick="Admin.deleteCode('${c.id}','${escapeHTML(c.code)}')">Xóa</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function openCreateCode() {
  $("newCodeInput").value = "";
  $("newCodeValue").value = "";
  $("newCodeMaxUses").value = "0";
  $("newCodeMaxPerUser").value = "1";
  $("newCodeExpires").value = "";
  $("codeFormMsg").textContent = "";
  $("codeModal").classList.add("show");
  setTimeout(() => $("newCodeInput").focus(), 100);
  randomCode();
}

function closeCodeModal() { $("codeModal").classList.remove("show"); }

function randomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  $("newCodeInput").value = code;
}

async function submitCode() {
  const code = $("newCodeInput").value.trim().toUpperCase();
  const value = Number($("newCodeValue").value);
  const maxUses = Number($("newCodeMaxUses").value);
  const maxUsesPerUser = Number($("newCodeMaxPerUser").value);
  const expiresInput = $("newCodeExpires").value;
  const msg = $("codeFormMsg");
  msg.textContent = "";

  if (!code) { msg.textContent = "Vui lòng nhập mã code"; return; }
  if (!/^[A-Z0-9]{4,20}$/.test(code)) { msg.textContent = "Code chỉ gồm chữ IN HOA và số, 4-20 ký tự"; return; }
  if (!value || value < 1) { msg.textContent = "Giá trị phải ≥ 1"; return; }
  if (maxUses < 0) { msg.textContent = "Số người tối đa phải ≥ 0"; return; }
  if (maxUsesPerUser < 1) { msg.textContent = "Số lần/user phải ≥ 1"; return; }

  try {
    await api("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({
        code, value, maxUses, maxUsesPerUser,
        expiresAt: expiresInput ? new Date(expiresInput).toISOString() : null
      })
    });
    closeCodeModal();
    alert(`✅ Đã tạo code ${code}`);
    loadCodes();
  } catch (e) { msg.textContent = e.message; }
}

async function toggleCode(id) {
  try {
    await api(`/api/admin/codes/${id}/toggle`, { method: "POST" });
    loadCodes();
  } catch (e) { alert(e.message); }
}

async function resetCode(id, code) {
  if (!confirm(`Reset code ${code}?\n\nSẽ xóa toàn bộ lịch sử dùng code và đưa usedCount về 0.`)) return;
  try {
    await api(`/api/admin/codes/${id}/reset`, { method: "POST" });
    alert(`✅ Đã reset code ${code}`);
    loadCodes();
  } catch (e) { alert(e.message); }
}

async function deleteCode(id, code) {
  if (!confirm(`Xóa code ${code}?\n\nToàn bộ lịch sử dùng code cũng sẽ bị xóa.`)) return;
  try {
    await api(`/api/admin/codes/${id}`, { method: "DELETE" });
    alert(`✅ Đã xóa code ${code}`);
    loadCodes();
  } catch (e) { alert(e.message); }
}

// ============ 🔊 SOUNDS ============
async function loadSounds() {
  try {
    const list = await api("/api/admin/sounds");
    soundsCache = {};
    list.forEach(s => { soundsCache[s.key] = s; });
    renderSounds();
  } catch (e) { console.error("Lỗi tải sounds:", e); }
}

function renderSounds() {
  const grid = $("soundAdminGrid");
  if (!grid) return;

  let totalSize = 0;
  let count = 0;
  SOUND_KEYS.forEach(key => {
    if (soundsCache[key]) {
      totalSize += soundsCache[key].size || 0;
      count++;
    }
  });
  $("totalSounds").textContent = count + " / " + SOUND_KEYS.length;
  $("totalSoundSize").textContent = (totalSize / 1024).toFixed(1) + " KB";

  grid.innerHTML = SOUND_KEYS.map(key => {
    const meta = SOUND_META[key];
    const s = soundsCache[key];
    const has = !!s;
    const infoHTML = has
      ? `<strong>${escapeHTML(s.filename || "")}</strong><br>${(s.size/1024).toFixed(1)} KB · ${escapeHTML(s.mimetype || "")}`
      : `<em style="color:#6b7390">Chưa có âm thanh</em>`;

    return `
      <div class="sound-admin-card ${has ? "has-sound" : ""}">
        <div class="sound-admin-header">
          <div class="sound-admin-icon">${meta.icon}</div>
          <div class="sound-admin-title">
            <strong>${meta.name}</strong>
            <small>${meta.desc}</small>
          </div>
        </div>
        <div class="sound-admin-info">${infoHTML}</div>
        <input type="file" accept="audio/*" class="sound-admin-file"
            data-key="${key}" style="display:none">
        <button class="sound-admin-upload" data-key="${key}">
          ${has ? "🔄 Thay âm thanh" : "📁 Upload âm thanh"}
        </button>
        <div class="sound-admin-actions">
          <button class="btn-play" data-key="${key}" ${has ? "" : "disabled"}>▶️ Nghe thử</button>
          <button class="btn-del" data-key="${key}" ${has ? "" : "disabled"}>🗑️ Xóa</button>
        </div>
      </div>
    `;
  }).join("");

  // Bind upload
  grid.querySelectorAll(".sound-admin-upload").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const input = grid.querySelector(`.sound-admin-file[data-key="${key}"]`);
      input.click();
    });
  });

  grid.querySelectorAll(".sound-admin-file").forEach(input => {
    input.addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      const key = input.dataset.key;

      if (!file.type.startsWith("audio/")) {
        alert("Vui lòng chọn file âm thanh (.mp3, .wav, .ogg)");
        input.value = "";
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert("File quá lớn! Tối đa 8MB");
        input.value = "";
        return;
      }

      const btn = grid.querySelector(`.sound-admin-upload[data-key="${key}"]`);
      const oldText = btn.textContent;
      btn.textContent = "⏳ Đang upload...";
      btn.classList.add("busy");

      try {
        const base64 = await fileToBase64(file);
        await api(`/api/admin/sounds/${key}`, {
          method: "POST",
          body: JSON.stringify({ data: base64, filename: file.name })
        });
        alert(`✅ Đã upload âm thanh "${SOUND_META[key].name}"`);
        loadSounds();
      } catch(err) {
        alert("Lỗi: " + err.message);
        btn.textContent = oldText;
        btn.classList.remove("busy");
      }
      input.value = "";
    });
  });

  // Bind test
  grid.querySelectorAll(".btn-play").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      if (!soundsCache[key]) return;
      const a = new Audio(`${API}/api/sounds/${key}/audio`);
      a.volume = 0.8;
      a.play().catch(() => alert("Không phát được âm thanh này"));
    });
  });

  // Bind delete
  grid.querySelectorAll(".btn-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.key;
      if (!soundsCache[key]) return;
      if (!confirm(`Xóa âm thanh "${SOUND_META[key].name}"?`)) return;
      try {
        await api(`/api/admin/sounds/${key}`, { method: "DELETE" });
        alert("✅ Đã xóa");
        loadSounds();
      } catch(e) { alert(e.message); }
    });
  });
}

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============ EVENTS ============
$("adminPass").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("adminUser").addEventListener("keydown", e => { if (e.key === "Enter") $("adminPass").focus(); });
$("modalAmount").addEventListener("keydown", e => { if (e.key === "Enter") submitMoney(); });
$("moneyModal").addEventListener("click", e => { if (e.target === $("moneyModal")) closeModal(); });
$("codeModal").addEventListener("click", e => { if (e.target === $("codeModal")) closeCodeModal(); });
$("newCodeInput").addEventListener("keydown", e => { if (e.key === "Enter") $("newCodeValue").focus(); });

// ============ EXPORT ============
window.Admin = {
  login, logout, loadAll, switchTab,
  loadUsers, renderUsers, openMoney, closeModal, submitMoney,
  toggleBan, resetPass, resetAvatar, deleteUser,
  loadCodes, renderCodes, openCreateCode, closeCodeModal, randomCode,
  submitCode, toggleCode, resetCode, deleteCode,
  loadSounds, renderSounds
};

if (token) showDashboard();

})();
