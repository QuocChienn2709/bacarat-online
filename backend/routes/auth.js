const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

const router = express.Router();

function makeToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: "user" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function publicUser(user) {
  return {
    username: user.username,
    avatar: user.avatar || "",
    balance: user.balance,
    streak: user.streak,
    roundsPlayed: user.roundsPlayed,
    totalBet: user.totalBet || 0,
    totalWin: user.totalWin || 0,
    totalNet: user.totalNet || 0,
    totalWins: user.totalWins || 0,
    bestStreak: user.bestStreak || 0
  };
}

// ============ ĐĂNG KÝ ============
router.post("/register", async (req, res) => {
  try {
    let { username, password } = req.body;
    username = String(username || "").trim().toLowerCase();

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: "Tên tài khoản không hợp lệ (3-30 ký tự, chỉ chữ/số/_)" });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: "Mật khẩu phải ≥ 4 ký tự" });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: "Tên tài khoản đã tồn tại" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hash,
      plainPassword: password,
      avatar: "",
      balance: 1000,
      streak: 0,
      roundsPlayed: 0,
      totalBet: 0,
      totalWin: 0,
      totalNet: 0,
      totalWins: 0,
      bestStreak: 0,
      banned: false
    });

    res.json({
      token: makeToken(user),
      user: publicUser(user)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ ĐĂNG NHẬP ============
router.post("/login", async (req, res) => {
  try {
    let { username, password } = req.body;
    username = String(username || "").trim().toLowerCase();

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "Tài khoản không tồn tại" });
    }
    if (user.banned) {
      return res.status(403).json({ error: "Tài khoản đã bị khóa" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({ error: "Mật khẩu không chính xác" });
    }

    res.json({
      token: makeToken(user),
      user: publicUser(user)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ ME ============
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user" });
    }
    res.json(publicUser(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ PROFILE ============
router.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user" });
    }
    res.json(publicUser(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 🔥 ĐỔI AVATAR ============
router.post("/update-avatar", auth, async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar || typeof avatar !== "string") {
      return res.status(400).json({ error: "Thiếu dữ liệu ảnh" });
    }
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(avatar)) {
      return res.status(400).json({ error: "Định dạng ảnh không hợp lệ (chỉ PNG/JPG/WEBP)" });
    }
    if (avatar.length > 200000) {
      return res.status(400).json({ error: "Ảnh quá lớn (tối đa ~150KB)" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user" });
    }

    user.avatar = avatar;
    await user.save();

    // 🔥 Cập nhật avatar cache trong engine + broadcast leaderboard
    try {
      const engine = require("../game/engine");
      engine.updateAvatar(user.username, avatar);
      engine.broadcastLeaderboard();
    } catch(e) {}

    res.json({ ok: true, avatar: user.avatar });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 🔥 XÓA AVATAR ============
router.post("/remove-avatar", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user" });
    }

    user.avatar = "";
    await user.save();

    // 🔥 Xóa khỏi cache + broadcast
    try {
      const engine = require("../game/engine");
      engine.updateAvatar(user.username, "");
      engine.broadcastLeaderboard();
    } catch(e) {}

    res.json({ ok: true, avatar: "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ ĐỔI MẬT KHẨU ============
router.post("/change-password", auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Thiếu thông tin" });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: "Mật khẩu mới phải ≥ 4 ký tự" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user" });
    }

    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) {
      return res.status(400).json({ error: "Mật khẩu cũ không đúng" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.plainPassword = newPassword;
    await user.save();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
