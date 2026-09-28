const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Code = require("../models/Code");
const CodeUsage = require("../models/CodeUsage");
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

// ============ RESET AVATAR ============
router.post("/users/:id/reset-avatar", adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy" });
  user.avatar = "";
  await user.save();

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

    try {
      const engine = require("../game/engine");
      engine.updateAvatar(user.username, "");
    } catch(e) {}
  }
  res.json({ ok: true });
});

// ======================================================
// 🎁 QUẢN LÝ CODE
// ======================================================

// Danh sách code
router.get("/codes", adminAuth, async (req, res) => {
  try {
    const codes = await Code.find().sort({ createdAt: -1 });

    // Aggregate usage stats
    const codeIds = codes.map(c => c._id);
    const usages = await CodeUsage.aggregate([
      { $match: { codeId: { $in: codeIds } } },
      {
        $group: {
          _id: "$codeId",
          uniqueUsers: { $sum: 1 },
          totalUses: { $sum: "$count" }
        }
      }
    ]);
    const usageMap = {};
    usages.forEach(u => { usageMap[u._id.toString()] = u; });

    res.json(codes.map(c => {
      const stat = usageMap[c._id.toString()] || { uniqueUsers: 0, totalUses: 0 };
      return {
        id: c._id,
        code: c.code,
        value: c.value,
        maxUses: c.maxUses,
        usedCount: c.usedCount,
        maxUsesPerUser: c.maxUsesPerUser,
        active: c.active,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        createdBy: c.createdBy,
        uniqueUsers: stat.uniqueUsers,
        totalUses: stat.totalUses
      };
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tạo code
router.post("/codes", adminAuth, async (req, res) => {
  try {
    let { code, value, maxUses, maxUsesPerUser, expiresAt } = req.body;

    if (!code || value === undefined || value === null) {
      return res.status(400).json({ error: "Thiếu thông tin code hoặc giá trị" });
    }

    code = String(code).trim().toUpperCase();
    value = Math.floor(Number(value));
    maxUses = Math.floor(Number(maxUses)) || 0;
    maxUsesPerUser = Math.floor(Number(maxUsesPerUser)) || 1;

    if (value < 1) return res.status(400).json({ error: "Giá trị phải ≥ 1" });
    if (!/^[A-Z0-9]{4,20}$/.test(code)) {
      return res.status(400).json({ error: "Code chỉ gồm chữ IN HOA và số, 4-20 ký tự" });
    }
    if (maxUses < 0) return res.status(400).json({ error: "Số người tối đa phải ≥ 0" });
    if (maxUsesPerUser < 1) return res.status(400).json({ error: "Số lần/user phải ≥ 1" });

    const existing = await Code.findOne({ code });
    if (existing) return res.status(400).json({ error: "Code đã tồn tại" });

    const codeDoc = await Code.create({
      code,
      value,
      maxUses,
      maxUsesPerUser,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: req.admin.username
    });

    res.json({ success: true, code: codeDoc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bật/tắt code
router.post("/codes/:id/toggle", adminAuth, async (req, res) => {
  const code = await Code.findById(req.params.id);
  if (!code) return res.status(404).json({ error: "Không tìm thấy" });
  code.active = !code.active;
  await code.save();
  res.json({ active: code.active });
});

// Reset code (xóa hết usage + reset usedCount)
router.post("/codes/:id/reset", adminAuth, async (req, res) => {
  try {
    await CodeUsage.deleteMany({ codeId: req.params.id });
    await Code.findByIdAndUpdate(req.params.id, { usedCount: 0 });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Xóa code
router.delete("/codes/:id", adminAuth, async (req, res) => {
  try {
    await Code.findByIdAndDelete(req.params.id);
    await CodeUsage.deleteMany({ codeId: req.params.id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
