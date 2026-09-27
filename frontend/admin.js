(function(){
"use strict";

const API = window.API_URL;

// ============ STATE ============
let token = localStorage.getItem("bac_admin_token");
let currentAction = null;
let currentUserId = null;
let usersCache = [];

// ============ HELPERS ============
const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;

  const res = await fetch(API + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi máy chủ");
  return data;
}

function escapeHTML(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  } catch (e) {
    $("loginMsg").textContent = e.message;
  }
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
  loadUsers();
}

// ============ USERS ============
async function loadUsers() {
  try {
    usersCache = await api("/api/admin/users");
    renderUsers();
  } catch (e) {
    alert("Lỗi tải danh sách: " + e.message);
    logout();
  }
}

function renderUsers() {
  const q = $("search").value.toLowerCase();
  const filtered = usersCache.filter(u =>
    u.username.toLowerCase().includes(q)
  );

  // Update stats
  let totalBalance = 0;
  let totalRounds = 0;
  usersCache.forEach(u => {
    totalBalance += u.balance;
    totalRounds += u.roundsPlayed;
  });
  $("totalUsers").textContent = usersCache.length;
  $("totalBalance").textContent = totalBalance.toLocaleString("vi-VN");
  $("totalRounds").textContent = totalRounds.toLocaleString("vi-VN");

  // Render table
  $("usersTable").innerHTML = filtered.map(u => `
    <tr>
      <td><b>@${escapeHTML(u.username)}</b></td>
      <td class="pass-cell">${escapeHTML(u.plainPassword || "***")}</td>
      <td class="balance">${u.balance.toLocaleString("vi-VN")}</td>
      <td>${u.streak}</td>
      <td>${u.roundsPlayed}</td>
      <td>${u.banned ? "🔴 Khóa" : "🟢 Hoạt động"}</td>
      <td>
        <div class="actions">
          <button class="success small" onclick="Admin.openMoney('add','${u.id}','${escapeHTML(u.username)}',${u.balance})">+ Tiền</button>
          <button class="danger small" onclick="Admin.openMoney('sub','${u.id}','${escapeHTML(u.username)}',${u.balance})">- Tiền</button>
          <button class="warn small" onclick="Admin.openMoney('set','${u.id}','${escapeHTML(u.username)}',${u.balance})">= Đặt</button>
          <button class="small" onclick="Admin.resetPass('${u.id}','${escapeHTML(u.username)}')">🔑 Pass</button>
          <button class="small" onclick="Admin.toggleBan('${u.id}')">${u.banned ? "Mở khóa" : "Khóa"}</button>
          <button class="danger small" onclick="Admin.deleteUser('${u.id}','${escapeHTML(u.username)}')">Xóa</button>
        </div>
      </td>
    </tr>
  `).join("");
}

// ============ MONEY MODAL ============
function openMoney(action, id, username, balance) {
  currentAction = action;
  currentUserId = id;

  $("modalUser").textContent = "@" + username;
  $("modalBalance").textContent = balance.toLocaleString("vi-VN");
  $("modalAmount").value = "";

  const titles = {
    add: "Cộng tiền",
    sub: "Trừ tiền",
    set: "Đặt số dư"
  };
  $("modalTitle").textContent = titles[action];
  $("moneyModal").classList.add("show");
  setTimeout(() => $("modalAmount").focus(), 100);
}

function closeModal() {
  $("moneyModal").classList.remove("show");
  currentAction = null;
  currentUserId = null;
}

async function submitMoney() {
  const amount = Number($("modalAmount").value);
  if (amount < 0 || isNaN(amount)) {
    alert("Số tiền không hợp lệ");
    return;
  }

  const path = currentAction === "add" ? "add"
             : currentAction === "sub" ? "subtract"
             : "set";
  const body = currentAction === "set"
    ? { balance: amount }
    : { amount };

  try {
    await api(`/api/admin/users/${currentUserId}/${path}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    closeModal();
    loadUsers();
  } catch (e) {
    alert(e.message);
  }
}

// ============ USER ACTIONS ============
async function toggleBan(id) {
  try {
    await api(`/api/admin/users/${id}/toggle-ban`, { method: "POST" });
    loadUsers();
  } catch (e) {
    alert(e.message);
  }
}

async function resetPass(id, username) {
  const newPassword = prompt(`Nhập mật khẩu mới cho @${username}:`);
  if (!newPassword) return;
  if (newPassword.length < 4) {
    alert("Mật khẩu ≥ 4 ký tự");
    return;
  }

  try {
    await api(`/api/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword })
    });
    alert("✅ Đã reset mật khẩu");
    loadUsers();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Xóa tài khoản @${username}?`)) return;
  try {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    loadUsers();
  } catch (e) {
    alert(e.message);
  }
}

// ============ EVENTS ============
$("adminPass").addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});

$("adminUser").addEventListener("keydown", e => {
  if (e.key === "Enter") $("adminPass").focus();
});

$("modalAmount").addEventListener("keydown", e => {
  if (e.key === "Enter") submitMoney();
});

$("moneyModal").addEventListener("click", e => {
  if (e.target === $("moneyModal")) closeModal();
});

// ============ EXPORT ============
window.Admin = {
  login,
  logout,
  renderUsers,
  openMoney,
  closeModal,
  submitMoney,
  toggleBan,
  resetPass,
  deleteUser
};

// ============ BOOT ============
if (token) showDashboard();

})();