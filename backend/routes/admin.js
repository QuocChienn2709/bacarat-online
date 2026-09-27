const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { adminAuth } = require("../middleware/auth");
const eventBus = require("../utils/eventBus");

const router = express.Router();

// ============ ĐĂNG NHẬP ADMIN ============
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: "Sai tài khoản admin" });

  const token = jwt.sign(
    { username, role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  res.json({ token });
});

// ============ DANH SÁCH USER ============
router.get("/users", adminAuth, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users.map(u => ({
    id: u._id,
    username: u.username,
    plainPassword: u.plainPassword,
    avatar: u.avatar || "",
    balance: u.balance,
    streak: u.streak,
    roundsPlayed: u.roundsPlayed,
    totalBet: u.totalBet || 0,
    totalWin: u.totalWin || 0,
    totalNet: u.totalNet || 0,
    totalWins: u.totalWins || 0,
    bestStreak: u.bestStreak || 0,
    banned: u.banned,
    createdAt: u.createdAt
  })));
});

// ============ CỘNG TIỀN ============
router.post("/users/:id/add", adminAuth, async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });
  user.balance += Number(amount) || 0;
  await user.save();
  res.json({ balance: user.balance });
});

// ============ TRỪ TIỀN ============
router.post("/users/:id/subtract", adminAuth, async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });
  user.balance = Math.max(0, user.balance - (Number(amount) || 0));
  await user.save();
  res.json({ balance: user.balance });
});

// ============ ĐẶT SỐ DƯ ============
router.post("/users/:id/set", adminAuth, async (req, res) => {
  const { balance } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });
  user.balance = Math.max(0, Number(balance) || 0);
  await user.save();
  res.json({ balance: user.balance });
});

// ============ KHÓA / MỞ KHÓA ============
router.post("/users/:id/toggle-ban", adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });

  user.banned = !user.banned;
  await user.save();

  if (user.banned) {
    eventBus.emit("force-logout", user.username);
  }

  res.json({ banned: user.banned });
});

// ============ RESET PASSWORD ============
router.post("/users/:id/reset-password", adminAuth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: "Mật khẩu ≥ 4 ký tự" });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });

  user.password = await bcrypt.hash(newPassword, 10);
  user.plainPassword = newPassword;
  await user.save();
  res.json({ ok: true });
});

// ============ 🔥 RESET AVATAR ============
router.post("/users/:id/reset-avatar", adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });
  user.avatar = "";
  await user.save();

  // 🔥 Xóa khỏi cache engine + broadcast
  try {
    const engine = require("../game/engine");
    engine.updateAvatar(user.username, "");
    engine.broadcastLeaderboard();
  } catch(e) {}

  res.json({ ok: true });
});

// ============ XÓA USER ============
router.delete("/users/:id", adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    eventBus.emit("force-logout", user.username);
    await User.findByIdAndDelete(req.params.id);

    // 🔥 Xóa khỏi cache engine
    try {
      const engine = require("../game/engine");
      engine.updateAvatar(user.username, "");
    } catch(e) {}
  }
  res.json({ ok: true });
});

module.exports = router;
