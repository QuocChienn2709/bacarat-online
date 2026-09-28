const mongoose = require("mongoose");

const codeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  value: { type: Number, required: true, min: 1 },
  maxUses: { type: Number, default: 0 },          // 0 = không giới hạn
  usedCount: { type: Number, default: 0 },
  maxUsesPerUser: { type: Number, default: 1 },   // số lần 1 user được nhập
  active: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Code", codeSchema);
