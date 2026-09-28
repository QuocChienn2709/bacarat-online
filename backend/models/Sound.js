const mongoose = require("mongoose");

const soundSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  mimetype: String,
  data: Buffer,
  filename: String,
  size: Number,
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Sound", soundSchema);
