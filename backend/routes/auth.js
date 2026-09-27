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

router.post("/register", async (req, res) => {
  try {
    let { username, password } = req.body;
    username = String(username || "").trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ error: "Tên tài khoản không hợp lệ" });
    if (!password || password.length < 4)
      return res.status(400).json({ error: "Mật khẩu phải ≥ 4 ký tự" });

    if (await User.findOne({ username }))
      return res.status(400).json({ error: "Tên tài khoản đã tồn tại" });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username, password: hash, plainPassword: password, balance: 1000
    });

    res.json({
      token: makeToken(user),
      user: {
        username: user.username, balance: user.balance,
        streak: user.streak, roundsPlayed: user.roundsPlayed
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/login", async (req, res) => {
  try {
    let { username, password } = req.body;
    username = String(username || "").trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Tài khoản không tồn tại" });
    if (user.banned) return res.status(403).json({ error: "Tài khoản đã bị khóa" });

    if (!(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ error: "Mật khẩu không chính xác" });

    res.json({
      token: makeToken(user),
      user: {
        username: user.username, balance: user.balance,
        streak: user.streak, roundsPlayed: user.roundsPlayed
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy user" });
  res.json({
    username: user.username, balance: user.balance,
    streak: user.streak, roundsPlayed: user.roundsPlayed
  });
});

router.post("/change-password", auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: "Thiếu thông tin" });
    if (newPassword.length < 4)
      return res.status(400).json({ error: "Mật khẩu mới phải ≥ 4 ký tự" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Không tìm thấy user" });

    if (!(await bcrypt.compare(oldPassword, user.password)))
      return res.status(400).json({ error: "Mật khẩu cũ không đúng" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.plainPassword = newPassword;
    await user.save();

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;