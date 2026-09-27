const mongoose = require("mongoose");

const betSchema = new mongoose.Schema({
  roundId: Number,
  username: String,
  bets: {
    player: { type: Number, default: 0 },
    banker: { type: Number, default: 0 },
    tie:    { type: Number, default: 0 }
  },
  settled: { type: Boolean, default: false },
  net:     { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

betSchema.index({ roundId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model("Bet", betSchema);