(function(){
"use strict";

const API = window.API_URL;
const SOCKET_URL = window.SOCKET_URL;

let token = localStorage.getItem("bac_token");
let currentUsername = localStorage.getItem("bac_username");
let currentAvatar = localStorage.getItem("bac_avatar") || "";
let balance = 1000, streak = 0, roundsPlayed = 0;

let phase = "betting";
let countdown = 0;
let player = [], banker = [];
let playerScore = 0, bankerScore = 0;
let historyList = [];
let leaderboard = [];
let topPlayers = [];
let topType = "win";
let onlineUsers = [];
let myBets = { player:0, banker:0, tie:0 };
let selectedChip = 25;
let customBet = 0;
let socket = null;
let lastRoundId = 0;
let toastTimer = null;
let chatOpen = false;
let chatUnread = 0;
let pendingAvatar = "";
let _chatCache = [];

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

// ============ COLLAPSIBLES ============
function setupCollapsibles(){
  document.querySelectorAll(".section-title.clickable").forEach(title => {
    title.addEventListener("click", () => {
      const targetId = title.dataset.target;
      const wrap = document.getElementById(targetId);
      if (!wrap) return;
      const isCollapsed = wrap.classList.toggle("collapsed");
      title.classList.toggle("collapsed", isCollapsed);
      const key = "bac_collapse_" + targetId;
      localStorage.setItem(key, isCollapsed ? "1" : "0");
    });
    const targetId = title.dataset.target;
    const key = "bac_collapse_" + targetId;
    if (localStorage.getItem(key) === "1") {
      const wrap = document.getElementById(targetId);
      if (wrap) wrap.classList.add("collapsed");
      title.classList.add("collapsed");
    }
  });
}

// ============ CHAT PANEL ============
function setupChatPanel(){
  const fab = el("chatFab");
  const closeBtn = el("chatCloseBtn");

  fab.addEventListener("click", () => {
    if (chatOpen) closeChat();
    else openChat();
  });
  closeBtn.addEventListener("click", closeChat);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && chatOpen) closeChat();
  });

  setupChatDrag();
}

function openChat(){
  chatOpen = true;
  el("chatFloat").classList.add("show");
  chatUnread = 0;
  el("chatFab").classList.remove("has-unread");
  setTimeout(() => el("chatInput").focus(), 250);
}
function closeChat(){
  chatOpen = false;
  el("chatFloat").classList.remove("show");
}

function setupChatDrag(){
  const panel = el("chatFloat");
  const handle = el("chatDragHandle");
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function onStart(e){
    if (e.target.closest(".chat-float-close")) return;
    if (e.target.closest("input")) return;
    const touch = e.touches ? e.touches[0] : e;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    panel.style.left = rect.left + "px";
    panel.style.top = rect.top + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    startX = touch.clientX;
    startY = touch.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panel.classList.add("dragging");
    e.preventDefault();
  }
  function onMove(e){
    if (!dragging) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const rect = panel.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;
    let newX = Math.max(0, Math.min(startLeft + dx, maxX));
    let newY = Math.max(0, Math.min(startTop + dy, maxY));
    panel.style.left = newX + "px";
    panel.style.top = newY + "px";
    e.preventDefault();
  }
  function onEnd(){
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");
  }

  handle.addEventListener("mousedown", onStart);
  handle.addEventListener("touchstart", onStart, { passive: false });
  document.addEventListener("mousemove", onMove);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("mouseup", onEnd);
  document.addEventListener("touchend", onEnd);
}

// ============ AVATAR EDITOR ============
function setupAvatarEditor(){
  const input = el("avatarInput");
  const chooseBtn = el("chooseAvatarBtn");
  const backBtn = el("backFromAvatar");

  chooseBtn.addEventListener("click", () => input.click());

  input.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      el("avatarMsg").textContent = "Vui lòng chọn file ảnh";
      el("avatarMsg").style.color = "var(--bad)";
      return;
    }
    try {
      el("avatarMsg").textContent = "Đang xử lý...";
      el("avatarMsg").style.color = "var(--text-2)";
      const resized = await resizeImage(file, 128, 0.85);
      pendingAvatar = resized;
      updateAvatarPreview();

      const res = await api("/api/auth/update-avatar", {
        method: "POST",
        body: JSON.stringify({ avatar: resized })
      });
      currentAvatar = res.avatar;
      localStorage.setItem("bac_avatar", currentAvatar);
      pendingAvatar = "";

      el("avatarMsg").textContent = "✅ Đổi avatar thành công!";
      el("avatarMsg").style.color = "var(--good)";

      updateAccountUI();
      updateChatAvatars();
      renderTopPlayers();
      renderLeaderboard();

      setTimeout(() => {
        el("avatarEditor").style.display = "none";
        el("profileView").style.display = "block";
        el("avatarMsg").textContent = "";
      }, 1200);
    } catch(err) {
      el("avatarMsg").textContent = err.message || "Lỗi xử lý ảnh";
      el("avatarMsg").style.color = "var(--bad)";
      pendingAvatar = "";
      updateAvatarPreview();
    }
  });

  backBtn.addEventListener("click", () => {
    pendingAvatar = "";
    el("avatarEditor").style.display = "none";
    el("profileView").style.display = "block";
  });
}

function updateAvatarPreview(){
  const box = el("avatarPreview");
  if (pendingAvatar) {
    box.innerHTML = `<img src="${pendingAvatar}" alt="preview">`;
  } else if (currentAvatar) {
    box.innerHTML = `<img src="${currentAvatar}" alt="current">`;
  } else {
    box.innerHTML = currentUsername
      ? currentUsername.charAt(0).toUpperCase() : "?";
  }
}

function resizeImage(file, maxSize = 128, quality = 0.85){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        const side = Math.min(width, height);
        const sx = (width - side) / 2;
        const sy = (height - side) / 2;
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============ CUSTOM BET + ALL-IN ============
function setupCustomBet(){
  const customBtn = el("customChipBtn");
  const customRow = el("customBetRow");
  const customInput = el("customBetInput");
  const customOk = el("customBetOk");
  const customCancel = el("customBetCancel");
  const allInBtn = el("allInBtn");

  customBtn.addEventListener("click", () => {
    if (customBet > 0) {
      customBet = 0;
      customBtn.classList.remove("active");
      customBtn.textContent = "✏️";
      customRow.style.display = "none";
      return;
    }
    customRow.style.display = "flex";
    customInput.value = customBet || "";
    setTimeout(() => customInput.focus(), 100);
  });

  function applyCustom(){
    const val = Math.floor(Number(customInput.value));
    if (!val || val < 1) {
      alert("Số tiền không hợp lệ (tối thiểu 1)");
      return;
    }
    if (val > balance) {
      alert("Số tiền vượt quá số dư!");
      return;
    }
    customBet = val;
    selectedChip = val;
    customBtn.classList.add("active");
    customBtn.textContent = val >= 1000 ? Math.floor(val/1000) + "K" : val;
    customRow.style.display = "none";
    document.querySelectorAll(".chip").forEach(x => {
      if (x !== customBtn) x.classList.remove("active");
    });
  }

  customOk.addEventListener("click", applyCustom);
  customInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); applyCustom(); }
    if (e.key === "Escape") customRow.style.display = "none";
  });

  customCancel.addEventListener("click", () => {
    customRow.style.display = "none";
  });

  allInBtn.addEventListener("click", () => {
    if (!currentUsername) {
      openAccountModal();
      showAuthMessage("Hãy đăng nhập để đặt cược.");
      return;
    }
    if (phase !== "betting") {
      alert("Chỉ có thể All-In trong thời gian đặt cược!");
      return;
    }
    if (balance <= 0) {
      alert("Bạn không còn tiền để All-In!");
      return;
    }
    const amount = balance;
    if (!confirm(`🔥 ALL-IN ${amount.toLocaleString("vi-VN")}?\n\nSau khi bấm OK, chọn cửa PLAYER/BANKER/TIE để đặt toàn bộ số dư.`)) {
      return;
    }
    customBet = amount;
    selectedChip = amount;
    customBtn.classList.add("active");
    customBtn.textContent = amount >= 1000 ? Math.floor(amount/1000) + "K" : amount;
    document.querySelectorAll(".chip").forEach(x => {
      if (x !== customBtn) x.classList.remove("active");
    });
  });
}

// ============ TOP PLAYERS ============
function setupTopTabs(){
  document.querySelectorAll(".top-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      topType = tab.dataset.top;
      document.querySelectorAll(".top-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      loadTopPlayers();
    });
  });
}

async function loadTopPlayers(){
  try {
    const list = await api(`/api/game/top?type=${topType}&limit=10`);
    topPlayers = list;
    renderTopPlayers();
    renderChatList(_chatCache);
  } catch(e) {
    el("topList").innerHTML =
      `<div class="chat-empty" style="height:auto;padding:20px;">Lỗi: ${e.message}</div>`;
  }
}

function renderTopPlayers(){
  const box = el("topList");
  el("topCount").textContent = topPlayers.length + " người";
  if (!topPlayers.length) {
    box.innerHTML = `<div class="chat-empty" style="height:auto;padding:20px;">Chưa có ai chơi</div>`;
    return;
  }
  const labels = {
    win:    { field: "totalWin",   name: "tổng thắng", fmt: v => v.toLocaleString("vi-VN") },
    bet:    { field: "totalBet",   name: "tổng cược",  fmt: v => v.toLocaleString("vi-VN") },
    net:    { field: "totalNet",   name: "lãi ròng",   fmt: v => (v >= 0 ? "+" : "") + v.toLocaleString("vi-VN") },
    streak: { field: "bestStreak", name: "chuỗi dài",  fmt: v => v + " ván" }
  };
  const lbl = labels[topType] || labels.win;

  box.innerHTML = topPlayers.map((u, i) => {
    const isMe = currentUsername && u.username === currentUsername;
    const rank = i + 1;
    const rankCls = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";
    const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const value = u[lbl.field] || 0;
    const avatarHTML = u.avatar
      ? `<img src="${u.avatar}" alt="">`
      : u.username.charAt(0).toUpperCase();
    return `
      <div class="top-item ${isMe ? "me" : ""}">
        <div class="top-rank ${rankCls}">${rankIcon}</div>
        <div class="top-avatar">${avatarHTML}</div>
        <div class="top-main">
          <strong>@${escapeHTML(u.username)}${isMe ? " (bạn)" : ""}</strong>
          <small>${u.roundsPlayed} ván · ${u.totalWins || 0} thắng</small>
        </div>
        <div class="top-value">
          ${lbl.fmt(value)}
          <small>${lbl.name}</small>
        </div>
      </div>
    `;
  }).join("");
}

// ============ SOCKET ============
function initSocket(){
  if (socket) return;
  socket = io(SOCKET_URL, { auth: { token } });

  socket.on("connect", () => {});

  socket.on("force-logout", ({ reason }) => {
    alert("🚫 " + (reason || "Tài khoản đã bị khóa. Vui lòng đăng nhập lại."));
    doLogout();
  });

  socket.on("online:count", ({ total, users }) => {
    onlineUsers = users || [];
    el("onlineCount").textContent = total;
    el("chatOnline").textContent = total + " online";
    renderLeaderboard();
  });

  socket.on("game:state", applyGameState);

  socket.on("game:leaderboard", data => {
    leaderboard = data.entries || [];
    renderLeaderboard();
  });

  socket.on("game:settled", ({ net, balance: newBal }) => {
    balance = newBal;
    updateBalanceUI();
    if (net > 0) showResultFlash(net, 1, null);
    else if (net < 0) showResultFlash(net, 1, null);
    else showResultFlash(0, 0, "tie");
  });

  socket.on("chat:history", list => renderChatList(list));
  socket.on("chat:new", msg => {
    const box = el("chatBox");
    if (box.querySelector(".chat-empty")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", chatItemHTML(msg));
    box.scrollTop = box.scrollHeight;
    _chatCache.push(msg);
    if (!chatOpen) {
      const mine = currentUsername && msg.username === currentUsername;
      if (!mine) {
        chatUnread++;
        el("chatFab").classList.add("has-unread");
      }
    }
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

  // 🔥 Nếu đang ở chế độ All-In, cập nhật lại text chip
  if (customBet > 0 && customBet === balance) {
    const customBtn = el("customChipBtn");
    if (customBtn) {
      customBtn.textContent = balance >= 1000
        ? Math.floor(balance/1000) + "K"
        : balance;
    }
  }
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

  // 🔥 Xác định số tiền: All-In = balance, custom = customBet, ngược lại = selectedChip
  let amount = selectedChip;
  if (customBet > 0 && customBet === balance) {
    amount = balance;
  } else if (customBet > 0) {
    amount = customBet;
  }

  if (amount <= 0) return;
  if (balance < amount) {
    alert("Không đủ số dư.");
    return;
  }

  balance -= amount;
  myBets[side] += amount;
  updateBetUI();
  updateBalanceUI();

  try {
    const res = await api("/api/game/bet", {
      method: "POST",
      body: JSON.stringify({ side, amount })
    });
    myBets = res.bets;
    balance = res.balance;
    updateBetUI();
    updateBalanceUI();
  } catch(e){
    balance += amount;
    myBets[side] -= amount;
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
    box.innerHTML = `<div class="chat-empty" style="height:auto;padding:20px;">Chưa có ai đặt cược</div>`;
    return;
  }

  box.innerHTML = leaderboard.map((entry, i) => {
    const isMe = currentUsername && entry.username === currentUsername;
    const isOnline = onlineUsers.includes(entry.username);
    const rank = i + 1;
    const rankCls = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";
    const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;

    let avatarSrc = entry.avatar || "";
    if (isMe && !avatarSrc && currentAvatar) avatarSrc = currentAvatar;

    const avatarHTML = avatarSrc
      ? `<img src="${avatarSrc}" alt="">`
      : escapeHTML(entry.username.charAt(0).toUpperCase());

    return `
      <div class="leaderboard-item ${isMe ? "me" : ""}">
        <div class="leaderboard-rank ${rankCls}">${rankIcon}</div>
        <div class="leaderboard-avatar">${avatarHTML}</div>
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
    box.innerHTML = `<div class="chat-empty" style="height:auto;padding:20px;">Chưa có lịch sử</div>`;
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

// ============ RESULT FLASH ============
function showResultFlash(net, stake, result){
  const flash = el("resultFlash");
  const icon = el("flashIcon");
  const title = el("flashTitle");
  const amount = el("flashAmount");
  flash.className = "result-flash";

  if (stake <= 0) {
    icon.textContent = "🎲";
    title.textContent = resultName(result);
    amount.textContent = "Kết quả ván";
    flash.classList.add("show", "push");
  } else if (net > 0) {
    icon.textContent = "🎉";
    title.textContent = "THẮNG";
    amount.textContent = "+" + net.toLocaleString("vi-VN");
    flash.classList.add("show", "win");
  } else if (net < 0) {
    icon.textContent = "😔";
    title.textContent = "THUA";
    amount.textContent = net.toLocaleString("vi-VN");
    flash.classList.add("show", "lose");
  } else {
    icon.textContent = "🤝";
    title.textContent = "HÒA VỐN";
    amount.textContent = resultName(result);
    flash.classList.add("show", "push");
  }
  const content = flash.querySelector(".result-flash-content");
  content.style.animation = "none";
  void content.offsetWidth;
  content.style.animation = "";
  clearTimeout(flash._timer);
  flash._timer = setTimeout(() => {
    flash.classList.remove("show");
  }, 2700);
}

// ============ CHAT ============
function chatItemHTML(item){
  const mine = currentUsername && item.username === currentUsername;
  const date = new Date(item.createdAt);
  const time = date.toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"});
  let avatarHTML = escapeHTML(item.username.charAt(0).toUpperCase());
  if (mine && currentAvatar) {
    avatarHTML = `<img src="${currentAvatar}" alt="">`;
  } else {
    const u = topPlayers.find(p => p.username === item.username);
    if (u && u.avatar) avatarHTML = `<img src="${u.avatar}" alt="">`;
  }
  return `
    <div class="chat-message ${mine?"mine":""}">
      <div class="chat-avatar">${avatarHTML}</div>
      <div class="chat-content">
        <div class="chat-name">@${escapeHTML(item.username)}</div>
        <div class="chat-bubble">${escapeHTML(item.message)}</div>
        <span class="chat-time">${time}</span>
      </div>
    </div>`;
}
function renderChatList(list){
  _chatCache = list;
  const box = el("chatBox");
  if (!list.length) {
    box.innerHTML = `<div class="chat-empty">Chưa có tin nhắn nào</div>`;
    return;
  }
  box.innerHTML = list.map(chatItemHTML).join("");
  box.scrollTop = box.scrollHeight;
}
function updateChatAvatars(){
  renderChatList(_chatCache);
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
    el("avatarEditor").style.display = "none";

    const avatarHTML = currentAvatar
      ? `<img src="${currentAvatar}" alt="avatar">`
      : currentUsername.charAt(0).toUpperCase();

    el("profileView").innerHTML = `
      <div class="account-profile">
        <div class="account-avatar">${avatarHTML}</div>
        <div class="account-info">
          <strong>@${escapeHTML(currentUsername)}</strong>
          <small>Số dư: <span id="accountBalance">${balance.toLocaleString("vi-VN")}</span></small>
        </div>
      </div>
      <button class="main-btn" id="showChangeAvatarBtn" style="margin-bottom:8px">📷 Đổi avatar</button>
      <button class="main-btn" id="showChangePassBtn" style="margin-bottom:8px;background:rgba(255,255,255,.08)">🔒 Đổi mật khẩu</button>
      <button class="logout-btn" id="logoutBtn">Đăng xuất</button>
    `;
    document.getElementById("showChangeAvatarBtn").addEventListener("click", () => {
      el("profileView").style.display = "none";
      el("avatarEditor").style.display = "block";
      updateAvatarPreview();
    });
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
    el("avatarEditor").style.display = "none";
  }
}
function openAccountModal(){
  el("accountOverlay").classList.add("show");
  el("changePassArea").style.display = "none";
  el("avatarEditor").style.display = "none";
  pendingAvatar = "";
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
    currentAvatar = me.avatar || "";
    localStorage.setItem("bac_username", currentUsername);
    localStorage.setItem("bac_avatar", currentAvatar);
  } catch(e){
    token = null; currentUsername = null; currentAvatar = "";
    localStorage.removeItem("bac_token");
    localStorage.removeItem("bac_username");
    localStorage.removeItem("bac_avatar");
  }
}

function doLogout(){
  token = null; currentUsername = null; currentAvatar = "";
  localStorage.removeItem("bac_token");
  localStorage.removeItem("bac_username");
  localStorage.removeItem("bac_avatar");
  balance = 1000; streak = 0; roundsPlayed = 0;
  myBets = {player:0,banker:0,tie:0};
  customBet = 0;
  const cbtn = el("customChipBtn");
  if (cbtn) {
    cbtn.textContent = "✏️";
    cbtn.classList.remove("active");
  }
  const crow = el("customBetRow");
  if (crow) crow.style.display = "none";
  // Reset chip mặc định
  document.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
  const defaultChip = document.querySelector('.chip[data-chip="25"]');
  if (defaultChip) defaultChip.classList.add("active");
  selectedChip = 25;

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
    currentAvatar = res.user.avatar || "";
    localStorage.setItem("bac_token", token);
    localStorage.setItem("bac_username", currentUsername);
    localStorage.setItem("bac_avatar", currentAvatar);
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
    currentAvatar = res.user.avatar || "";
    localStorage.setItem("bac_token", token);
    localStorage.setItem("bac_username", currentUsername);
    localStorage.setItem("bac_avatar", currentAvatar);
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

// Chips mặc định (bỏ qua custom + allin)
document.querySelectorAll(".chip").forEach(chip => {
  if (chip.id === "customChipBtn" || chip.id === "allInBtn") return;

  chip.addEventListener("click", () => {
    selectedChip = Number(chip.dataset.chip);
    customBet = 0;
    const cbtn = el("customChipBtn");
    if (cbtn) cbtn.textContent = "✏️";
    document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));
    chip.classList.add("active");
    el("customBetRow").style.display = "none";
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

  setupCollapsibles();
  setupChatPanel();
  setupAvatarEditor();
  setupTopTabs();
  setupCustomBet();

  loadTopPlayers();

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
