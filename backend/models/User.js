const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  plainPassword: { type: String },
  avatar: { type: String, default: "" },   // base64 data URI
  balance: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },
  roundsPlayed: { type: Number, default: 0 },
  // 🔥 Thống kê tổng
  totalBet: { type: Number, default: 0 },     // tổng tiền đã cược
  totalWin: { type: Number, default: 0 },     // tổng tiền thắng (chỉ tính ván thắng)
  totalNet: { type: Number, default: 0 },     // tổng lãi/lỗ (có thể âm)
  totalWins: { type: Number, default: 0 },    // số ván thắng
  bestStreak: { type: Number, default: 0 },   // chuỗi thắng dài nhất
  banned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
