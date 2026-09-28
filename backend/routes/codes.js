const express = require("express");
const User = require("../models/User");
const Code = require("../models/Code");
const CodeUsage = require("../models/CodeUsage");
const { auth } = require("../middleware/auth");

const router = express.Router();

// ============ NHẬP CODE ============
router.post("/redeem", auth, async (req, res) => {
  try {
    let { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Vui lòng nhập code" });
    }
    code = code.trim().toUpperCase();

    // Tìm code
    const codeDoc = await Code.findOne({ code });
    if (!codeDoc) {
      return res.status(404).json({ error: "Code không tồn tại" });
    }
    if (!codeDoc.active) {
      return res.status(400).json({ error: "Code đã bị vô hiệu hóa" });
    }
    if (codeDoc.expiresAt && codeDoc.expiresAt < new Date()) {
      return res.status(400).json({ error: "Code đã hết hạn" });
    }

    // Check số lần user đã dùng
    const usage = await CodeUsage.findOne({
      codeId: codeDoc._id,
      username: req.user.username
    });
    const userUsedCount = usage ? usage.count : 0;
    if (userUsedCount >= codeDoc.maxUsesPerUser) {
      return res.status(400).json({
        error: `Bạn đã sử dụng code này ${userUsedCount}/${codeDoc.maxUsesPerUser} lần`
      });
    }

    // Atomic update — check maxUses
    const filter = { _id: codeDoc._id, active: true };
    if (codeDoc.maxUses > 0) {
      filter.usedCount = { $lt: codeDoc.maxUses };
    }

    const updated = await Code.findOneAndUpdate(
      filter,
      { $inc: { usedCount: 1 } },
      { new: true }
    );

    if (!updated) {
      return res.status(400).json({ error: "Code đã hết lượt sử dụng" });
    }

    // Update CodeUsage
    await CodeUsage.findOneAndUpdate(
      { codeId: codeDoc._id, username: req.user.username },
      {
        $inc: { count: 1 },
        $set: { lastUsedAt: new Date(), code: codeDoc.code }
      },
      { upsert: true }
    );

    // Cộng tiền
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Không tìm thấy user" });

    user.balance += codeDoc.value;
    await user.save();

    res.json({
      success: true,
      value: codeDoc.value,
      newBalance: user.balance,
      userUsedCount: userUsedCount + 1,
      maxUsesPerUser: codeDoc.maxUsesPerUser
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ LỊCH SỬ CODE CỦA USER ============
router.get("/history", auth, async (req, res) => {
  try {
    const list = await CodeUsage.find({ username: req.user.username })
      .sort({ lastUsedAt: -1 })
      .limit(30);
    res.json(list.map(u => ({
      code: u.code,
      count: u.count,
      lastUsedAt: u.lastUsedAt
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
