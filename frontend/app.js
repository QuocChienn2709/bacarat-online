(function(){
"use strict";

const API = window.API_URL;
const SOCKET_URL = window.SOCKET_URL;

let token = localStorage.getItem("bac_token");
let currentUsername = localStorage.getItem("bac_username");
let balance = 1000, streak = 0, roundsPlayed = 0;

let phase = "betting";
let countdown = 0;
let player = [], banker = [];
let playerScore = 0, bankerScore = 0;
let historyList = [];
let leaderboard = [];
let onlineUsers = [];
let myBets = { player:0, banker:0, tie:0 };
let selectedChip = 25;
let socket = null;
let lastRoundId = 0;
let toastTimer = null;

const el = id => document.getElementById(id);

function escapeHTML(t){
  return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

async function api(path, options={}) {
  const headers = { "Content-Type":"application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(API + path, {
    ...options, headers: { ...headers, ...(options.headers||{}) }
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Lỗi máy chủ");
  return data;
}

// ============ SOCKET ============
function initSocket(){
  if (socket) return;
  socket = io(SOCKET_URL, { auth: { token } });

  socket.on("connect", () => el("onlineStatus").textContent = "🟢 Online");
  socket.on("disconnect", () => el("onlineStatus").textContent = "🔴 Mất kết nối");

  socket.on("online:count", ({ total, users }) => {
    onlineUsers = users || [];
    el("onlineCount").textContent = total;
    el("onlineStatus").textContent = `🟢 ${total} online`;
    renderLeaderboard();
  });

  socket.on("game:state", applyGameState);

  socket.on("game:leaderboard", data => {
    leaderboard = data.entries || [];
    renderLeaderboard();
  });

  socket.on("game:settled", ({ net, balance: newBal, won }) => {
    balance = newBal;
    updateBalanceUI();
  });

  socket.on("chat:history", list => renderChatList(list));
  socket.on("chat:new", msg => {
    const box = el("chatBox");
    if (box.querySelector(".chat-empty")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", chatItemHTML(msg));
    box.scrollTop = box.scrollHeight;
  });
}

// ============ GAME STATE ============
function applyGameState(state){
  if (state.roundId !== lastRoundId) {
    lastRoundId = state.roundId;
    myBets = { player:0, banker:0, tie:0 };
    if (state.phase === "betting") refreshMyBets();
  }

  phase = state.phase;
  countdown = state.countdown;
  playerScore = state.playerScore;
  bankerScore = state.bankerScore;
  player = state.player || [];
  banker = state.banker || [];

  if (state.leaderboard) {
    leaderboard = state.leaderboard;
    renderLeaderboard();
  }

  if (phase === "betting") el("phase").textContent = "ĐANG ĐẶT CƯỢC";
  else if (phase === "dealing") el("phase").textContent = "CHIA BÀI";
  else if (phase === "result") el("phase").textContent =
    state.result === "player" ? "PLAYER" :
    state.result === "banker" ? "BANKER" : "TIE";

  el("countdown").textContent = phase === "betting" ? countdown : "•••";

  renderHands();

  if (phase !== "betting") {
    document.querySelectorAll(".bet-option").forEach(b => b.classList.add("disabled"));
  } else {
    updateBetUI();
  }

  const ph = el("playerHand"), bh = el("bankerHand");
  ph.classList.remove("winner"); bh.classList.remove("winner");
  if (phase === "result") {
    if (state.result === "player") ph.classList.add("winner");
    if (state.result === "banker") bh.classList.add("winner");
    if (state.result === "tie") { ph.classList.add("winner"); bh.classList.add("winner"); }
  }

  if (state.history) {
    historyList = state.history;
    renderHistory();
  }
}

function renderHands(){
  drawCardsInto("playerCards", player);
  drawCardsInto("bankerCards", banker);
  el("playerScore").textContent = playerScore;
  el("bankerScore").textContent = bankerScore;
}

function drawCardsInto(containerId, hand){
  const container = el(containerId);
  const existing = container.querySelectorAll(".card").length;
  if (existing !== hand.length) {
    container.innerHTML = hand.map(cardSlotHTML).join("");
  }
  hand.forEach((card, i) => {
    const slot = container.querySelector(`.card[data-index="${i}"]`);
    if (!slot) return;
    if (card.revealed) slot.classList.add("flipped");
    else slot.classList.remove("flipped");
  });
}

function cardSlotHTML(card, index){
  const red = card.suit === "♥" || card.suit === "♦";
  return `
    <div class="card" data-index="${index}">
      <div class="flip-card-inner">
        <div class="flip-card-face flip-card-back">🂠</div>
        <div class="flip-card-face flip-card-front ${red?"red":""}">
          ${escapeHTML(card.rank)} ${escapeHTML(card.suit)}
        </div>
      </div>
    </div>`;
}

// ============ BET UI ============
function updateBetUI(){
  el("playerBet").textContent = (myBets.player||0).toLocaleString("vi-VN");
  el("bankerBet").textContent = (myBets.banker||0).toLocaleString("vi-VN");
  el("tieBet").textContent = (myBets.tie||0).toLocaleString("vi-VN");

  document.querySelectorAll(".bet-option").forEach(b => {
    const side = b.dataset.side;
    b.classList.toggle("active", (myBets[side]||0) > 0);
    b.classList.remove("locked","disabled");
  });

  if (myBets.player > 0) {
    const bb = document.querySelector('.bet-option[data-side="banker"]');
    if (bb) bb.classList.add("locked");
  }
  if (myBets.banker > 0) {
    const pb = document.querySelector('.bet-option[data-side="player"]');
    if (pb) pb.classList.add("locked");
  }
  if (phase !== "betting") {
    document.querySelectorAll(".bet-option").forEach(b => b.classList.add("disabled"));
  }
}

function updateBalanceUI(){
  el("balance").textContent = balance.toLocaleString("vi-VN");
  el("streak").textContent = streak;
  el("rounds").textContent = roundsPlayed;
  if (currentUsername && el("accountBalance"))
    el("accountBalance").textContent = balance.toLocaleString("vi-VN");
}

// ============ BET ============
async function placeBet(side){
  if (!currentUsername) {
    openAccountModal();
    showAuthMessage("Hãy đăng nhập để đặt cược.");
    return;
  }
  if (phase !== "betting") return;
  if (side === "player" && myBets.banker > 0) return;
  if (side === "banker" && myBets.player > 0) return;
  if (balance < selectedChip) { alert("Không đủ số dư."); return; }

  balance -= selectedChip;
  myBets[side] += selectedChip;
  updateBetUI();
  updateBalanceUI();

  try {
    const res = await api("/api/game/bet", {
      method: "POST",
      body: JSON.stringify({ side, amount: selectedChip })
    });
    myBets = res.bets;
    balance = res.balance;
    updateBetUI();
    updateBalanceUI();
  } catch(e){
    balance += selectedChip;
    myBets[side] -= selectedChip;
    updateBetUI();
    updateBalanceUI();
    alert(e.message);
  }
}

async function refreshMyBets(){
  if (!token) { myBets = {player:0,banker:0,tie:0}; updateBetUI(); return; }
  try {
    const res = await api("/api/game/my-bets");
    myBets = res.bets || {player:0,banker:0,tie:0};
    updateBetUI();
  } catch(e){}
}

// ============ LEADERBOARD ============
function renderLeaderboard(){
  const box = el("leaderboardList");
  el("leaderboardCount").textContent = leaderboard.length + " người cược";

  if (!leaderboard.length) {
    box.innerHTML = `<div class="chat-empty">Chưa có ai đặt cược</div>`;
    return;
  }

  box.innerHTML = leaderboard.map((entry, i) => {
    const isMe = currentUsername && entry.username === currentUsername;
    const isOnline = onlineUsers.includes(entry.username);
    const rank = i + 1;
    const rankCls = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";
    const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;

    return `
      <div class="leaderboard-item ${isMe ? "me" : ""}" data-user="${escapeHTML(entry.username)}">
        <div class="leaderboard-rank ${rankCls}">${rankIcon}</div>
        <div class="leaderboard-main">
          <strong>
            @${escapeHTML(entry.username)}
            ${isMe ? " (bạn)" : ""}
            ${isOnline ? `<span style="color:#37d67a;font-size:10px">●</span>` : ""}
          </strong>
          <small>
            ${entry.player > 0 ? `<span><i class="lb-dot p"></i>P: ${entry.player.toLocaleString("vi-VN")}</span>` : ""}
            ${entry.banker > 0 ? `<span><i class="lb-dot b"></i>B: ${entry.banker.toLocaleString("vi-VN")}</span>` : ""}
            ${entry.tie > 0 ? `<span><i class="lb-dot t"></i>T: ${entry.tie.toLocaleString("vi-VN")}</span>` : ""}
          </small>
        </div>
        <div class="leaderboard-total">
          ${entry.total.toLocaleString("vi-VN")}
          <small>tổng cược</small>
        </div>
      </div>
    `;
  }).join("");

  if (currentUsername) {
    const meEl = box.querySelector(".leaderboard-item.me");
    if (meEl) {
      meEl.classList.add("leaderboard-new");
      setTimeout(() => meEl.classList.remove("leaderboard-new"), 600);
    }
  }
}

// ============ HISTORY ============
function renderHistory(){
  const box = el("historyList");
  el("historyCount").textContent = historyList.length + " ván";
  if (!historyList.length) {
    box.innerHTML = `<div class="chat-empty">Chưa có lịch sử</div>`;
    return;
  }
  box.innerHTML = historyList.slice().reverse().map((item, i) => {
    const date = new Date(item.createdAt);
    const time = date.toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"});
    const cls = item.result==="player" ? "result-player"
              : item.result==="banker" ? "result-banker" : "result-tie";
    const letter = item.result==="player" ? "P" : item.result==="banker" ? "B" : "T";
    return `
      <div class="history-item" data-idx="${historyList.length-1-i}">
        <div class="result-ball ${cls}">${letter}</div>
        <div class="history-main">
          <strong>Ván #${item.roundId}</strong>
          <small>${time}</small>
        </div>
        <div class="history-score">${item.playerScore}-${item.bankerScore}</div>
      </div>`;
  }).join("");
}

function staticCardHTML(card){
  const red = card.suit === "♥" || card.suit === "♦";
  return `<div class="static-card ${red?"red":""}">${escapeHTML(card.rank)} ${escapeHTML(card.suit)}</div>`;
}
function renderStaticCards(id, cards){
  const c = el(id);
  if (!cards || !cards.length) {
    c.innerHTML = `<div class="chat-empty" style="min-height:70px;font-size:11px;">Không có dữ liệu</div>`;
    return;
  }
  c.innerHTML = cards.map(staticCardHTML).join("");
}
function resultName(r){
  return r==="player"?"PLAYER":r==="banker"?"BANKER":"TIE";
}
function openHistoryDetail(idx){
  const item = historyList[idx];
  if (!item) return;
  const date = new Date(item.createdAt);
  const time = date.toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"});
  el("historyTitle").textContent = `Ván #${item.roundId}`;
  el("historySub").textContent = `${resultName(item.result)} · ${time}`;
  el("historyResultIcon").textContent = item.result==="player"?"P":item.result==="banker"?"B":"T";
  el("historyPlayerScore").textContent = item.playerScore;
  el("historyBankerScore").textContent = item.bankerScore;
  renderStaticCards("historyPlayerCards", item.playerCards);
  renderStaticCards("historyBankerCards", item.bankerCards);
  el("historyOverlay").classList.add("show");
}
function closeHistoryDetail(){ el("historyOverlay").classList.remove("show"); }

// ============ CHAT ============
function chatItemHTML(item){
  const mine = currentUsername && item.username === currentUsername;
  const date = new Date(item.createdAt);
  const time = date.toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"});
  return `
    <div class="chat-message ${mine?"mine":""}">
      <div class="chat-avatar">${escapeHTML(item.username.charAt(0).toUpperCase())}</div>
      <div class="chat-content">
        <div class="chat-name">@${escapeHTML(item.username)}</div>
        <div class="chat-bubble">${escapeHTML(item.message)}</div>
        <span class="chat-time">${time}</span>
      </div>
    </div>`;
}
function renderChatList(list){
  const box = el("chatBox");
  if (!list.length) {
    box.innerHTML = `<div class="chat-empty">Chưa có tin nhắn nào</div>`;
    return;
  }
  box.innerHTML = list.map(chatItemHTML).join("");
  box.scrollTop = box.scrollHeight;
}
function sendChat(){
  if (!currentUsername) {
    openAccountModal();
    showAuthMessage("Bạn cần đăng nhập để chat.");
    return;
  }
  const input = el("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  if (socket && socket.connected) socket.emit("chat:send", msg);
  else api("/api/chat", {method:"POST", body: JSON.stringify({message:msg})}).catch(()=>{});
}

// ============ AUTH ============
function showAuthMessage(m, good=false){
  const box = el("authMessage");
  box.textContent = m;
  box.style.color = good ? "var(--good)" : "var(--bad)";
}
function updateAccountUI(){
  if (currentUsername) {
    el("usernameDisplay").textContent = "@" + currentUsername;
    el("accountBtn").textContent = "Tài khoản";
    el("authArea").style.display = "none";
    el("profileView").style.display = "block";
    el("profileView").innerHTML = `
      <div class="account-profile">
        <div class="account-avatar">${currentUsername.charAt(0).toUpperCase()}</div>
        <div class="account-info">
          <strong>@${escapeHTML(currentUsername)}</strong>
          <small>Số dư: <span id="accountBalance">${balance.toLocaleString("vi-VN")}</span></small>
        </div>
      </div>
      <button class="main-btn" id="showChangePassBtn" style="margin-bottom:8px">🔒 Đổi mật khẩu</button>
      <button class="logout-btn" id="logoutBtn">Đăng xuất</button>
    `;
    document.getElementById("showChangePassBtn").addEventListener("click", () => {
      el("profileView").style.display = "none";
      el("changePassArea").style.display = "block";
    });
    document.getElementById("logoutBtn").addEventListener("click", doLogout);
  } else {
    el("usernameDisplay").textContent = "Chưa đăng nhập";
    el("accountBtn").textContent = "Đăng nhập";
    el("authArea").style.display = "block";
    el("profileView").style.display = "none";
  }
}
function openAccountModal(){
  el("accountOverlay").classList.add("show");
  el("changePassArea").style.display = "none";
  updateAccountUI();
}
function closeAccountModal(){ el("accountOverlay").classList.remove("show"); }

async function loadMe(){
  if (!token || !currentUsername) { balance=1000; streak=0; roundsPlayed=0; return; }
  try {
    const me = await api("/api/auth/me");
    balance = me.balance;
    streak = me.streak;
    roundsPlayed = me.roundsPlayed;
    currentUsername = me.username;
    localStorage.setItem("bac_username", currentUsername);
  } catch(e){
    token = null; currentUsername = null;
    localStorage.removeItem("bac_token");
    localStorage.removeItem("bac_username");
  }
}

function doLogout(){
  token = null; currentUsername = null;
  localStorage.removeItem("bac_token"); localStorage.removeItem("bac_username");
  balance = 1000; streak = 0; roundsPlayed = 0;
  myBets = {player:0,banker:0,tie:0};
  leaderboard = [];
  renderLeaderboard();
  updateAccountUI(); updateBalanceUI(); updateBetUI();
  closeAccountModal();
  if (socket) { socket.disconnect(); socket = null; }
  initSocket();
}

// ============ EVENTS ============
el("accountBtn").addEventListener("click", openAccountModal);
el("closeAccountBtn").addEventListener("click", closeAccountModal);
el("accountOverlay").addEventListener("click", e => {
  if (e.target === el("accountOverlay")) closeAccountModal();
});

el("historyList").addEventListener("click", e => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  openHistoryDetail(Number(item.dataset.idx));
});
el("closeHistoryBtn").addEventListener("click", closeHistoryDetail);
el("historyOverlay").addEventListener("click", e => {
  if (e.target === el("historyOverlay")) closeHistoryDetail();
});

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(x=>x.classList.remove("active"));
    tab.classList.add("active");
    if (tab.dataset.auth === "login") el("loginForm").classList.add("active");
    else el("registerForm").classList.add("active");
    el("authMessage").textContent = "";
  });
});

el("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = el("loginUsername").value.trim().toLowerCase();
  const password = el("loginPassword").value;
  try {
    const res = await api("/api/auth/login", {
      method:"POST", body: JSON.stringify({username, password})
    });
    token = res.token;
    currentUsername = res.user.username;
    localStorage.setItem("bac_token", token);
    localStorage.setItem("bac_username", currentUsername);
    balance = res.user.balance; streak = res.user.streak; roundsPlayed = res.user.roundsPlayed;
    updateAccountUI(); updateBalanceUI();
    el("loginPassword").value = "";
    showAuthMessage("Đăng nhập thành công.", true);
    if (socket) socket.disconnect();
    socket = null;
    initSocket();
    refreshMyBets();
    setTimeout(closeAccountModal, 500);
  } catch(err){ showAuthMessage(err.message); }
});

el("registerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = el("registerUsername").value.trim().toLowerCase();
  const password = el("registerPassword").value;
  const password2 = el("registerPassword2").value;
  if (password !== password2) { showAuthMessage("Mật khẩu nhập lại không khớp."); return; }
  try {
    const res = await api("/api/auth/register", {
      method:"POST", body: JSON.stringify({username, password})
    });
    token = res.token;
    currentUsername = res.user.username;
    localStorage.setItem("bac_token", token);
    localStorage.setItem("bac_username", currentUsername);
    balance = res.user.balance; streak = res.user.streak; roundsPlayed = res.user.roundsPlayed;
    updateAccountUI(); updateBalanceUI();
    el("registerPassword").value = ""; el("registerPassword2").value = "";
    showAuthMessage("Tạo tài khoản thành công.", true);
    if (socket) socket.disconnect();
    socket = null;
    initSocket();
    setTimeout(closeAccountModal, 600);
  } catch(err){ showAuthMessage(err.message); }
});

el("backToProfile").addEventListener("click", () => {
  el("changePassArea").style.display = "none";
  el("profileView").style.display = "block";
});

el("changePassForm").addEventListener("submit", async e => {
  e.preventDefault();
  const oldP = el("oldPassword").value;
  const newP = el("newPassword").value;
  const newP2 = el("newPassword2").value;
  const msg = el("changePassMsg");
  if (newP !== newP2) {
    msg.textContent = "Mật khẩu mới nhập lại không khớp.";
    msg.style.color = "var(--bad)";
    return;
  }
  try {
    await api("/api/auth/change-password", {
      method:"POST", body: JSON.stringify({ oldPassword: oldP, newPassword: newP })
    });
    msg.textContent = "✅ Đổi mật khẩu thành công!";
    msg.style.color = "var(--good)";
    el("oldPassword").value = ""; el("newPassword").value = ""; el("newPassword2").value = "";
    setTimeout(() => {
      el("changePassArea").style.display = "none";
      el("profileView").style.display = "block";
    }, 1200);
  } catch(err){
    msg.textContent = err.message;
    msg.style.color = "var(--bad)";
  }
});

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    selectedChip = Number(chip.dataset.chip);
    document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));
    chip.classList.add("active");
  });
});

document.querySelectorAll(".bet-option").forEach(b => {
  b.addEventListener("click", () => placeBet(b.dataset.side));
});

el("clearBet").addEventListener("click", () => {
  if (myBets.player + myBets.banker + myBets.tie > 0) {
    alert("Không thể hủy cược sau khi đã đặt. Chờ ván sau.");
    return;
  }
  alert("Bạn chưa đặt cược ván này.");
});

el("chatSend").addEventListener("click", sendChat);
el("chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); sendChat(); }
});

el("themeBtn").addEventListener("click", function(){
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === "light" ? "dark" : "light";
  this.textContent = html.dataset.theme === "light" ? "☀️" : "🌙";
});

// ============ BOOT ============
(async function(){
  await loadMe();
  updateAccountUI();
  updateBalanceUI();
  updateBetUI();

  try {
    const res = await fetch(API + "/api/game/leaderboard");
    const data = await res.json();
    leaderboard = data.entries || [];
    renderLeaderboard();
  } catch(e){}

  try {
    const res = await fetch(API + "/api/game/state");
    const state = await res.json();
    applyGameState(state);
  } catch(e){}

  initSocket();
})();

})();