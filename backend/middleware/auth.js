const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // 🔥 QUAN TRỌNG: Query DB mỗi lần để check banned
    const user = await User.findById(payload.id);
    if (!user)
      return res.status(401).json({ error: "Tài khoản không tồn tại" });
    if (user.banned)
      return res.status(403).json({ error: "Tài khoản đã bị khóa" });

    req.user = { ...payload, user };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

async function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin")
      return res.status(403).json({ error: "Không có quyền" });
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

module.exports = { auth, adminAuth };
