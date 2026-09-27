const express = require("express");
const User = require("../models/User");
const Bet = require("../models/Bet");
const History = require("../models/History");
const engine = require("../game/engine");
const { auth } = require("../middleware/auth");

const router = express.Router();

router.get("/state", (req, res) => {
  res.json(engine.getPublicState());
});

router.get("/leaderboard", (req, res) => {
  res.json({
    roundId: engine.roundId,
    entries: engine.getLeaderboard()
  });
});

router.post("/bet", auth, async (req, res) => {
  try {
    const { side, amount } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Không tìm thấy user" });

    const result = await engine.placeBet(user.username, side, Number(amount), user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/history", async (req, res) => {
  const list = await History.find().sort({ createdAt: -1 }).limit(30);
  res.json(list.reverse());
});

router.get("/my-bets", auth, async (req, res) => {
  const bet = await Bet.findOne({
    roundId: engine.roundId,
    username: req.user.username
  });
  res.json(bet || { bets: { player: 0, banker: 0, tie: 0 } });
});

module.exports = router;