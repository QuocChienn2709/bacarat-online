const mongoose = require("mongoose");

const codeUsageSchema = new mongoose.Schema({
  codeId: { type: mongoose.Schema.Types.ObjectId, ref: "Code", required: true },
  code: { type: String, required: true },
  username: { type: String, required: true },
  count: { type: Number, default: 0 },
  lastUsedAt: { type: Date, default: Date.now }
});

codeUsageSchema.index({ codeId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model("CodeUsage", codeUsageSchema);
