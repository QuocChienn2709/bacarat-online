const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  roundId: Number,
  result: String,          // "player" | "banker" | "tie"
  playerScore: Number,
  bankerScore: Number,
  playerCards: Array,
  bankerCards: Array,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("History", historySchema);