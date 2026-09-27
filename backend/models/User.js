const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },        // bcrypt hash
  plainPassword: { type: String },                    // admin xem
  balance: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },
  roundsPlayed: { type: Number, default: 0 },
  banned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);