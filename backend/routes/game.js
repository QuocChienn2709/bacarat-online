const express = require("express");
const User = require("../models/User");
const Bet = require("../models/Bet");
const History = require("../models/History");
const engine = require("../game/engine");
const { auth } = require("../middleware/auth");

const router = express.Router();

// Trạng thái hiện tại (REST fallback)
router.get("/state", (req, res) => {
  res.json(engine.getPublicState());
});

// Leaderboard ván hiện tại
router.get("/leaderboard", (req, res) => {
  res.json({
    roundId: engine.roundId,
    entries: engine.getLeaderboard()
  });
});

// Đặt cược
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

// Lịch sử ván (30 gần nhất)
router.get("/history", async (req, res) => {
  const list = await History.find().sort({ createdAt: -1 }).limit(30);
  res.json(list.reverse());
});

// Cược của user hiện tại
router.get("/my-bets", auth, async (req, res) => {
  const bet = await Bet.findOne({
    roundId: engine.roundId,
    username: req.user.username
  });
  res.json(bet || { bets: { player: 0, banker: 0, tie: 0 } });
});

// 🏆 Top người chơi all-time
// Query: ?type=bet|win|net|balance|streak&limit=10
router.get("/top", async (req, res) => {
  try {
    const type = req.query.type || "win";
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    let sortField;
    switch (type) {
      case "bet":     sortField = { totalBet: -1 };   break;
      case "win":     sortField = { totalWin: -1 };   break;
      case "net":     sortField = { totalNet: -1 };   break;
      case "balance": sortField = { balance: -1 };    break;
      case "streak":  sortField = { bestStreak: -1 }; break;
      default:        sortField = { totalWin: -1 };
    }

    const list = await User.find({
      banned: false,
      roundsPlayed: { $gt: 0 }
    })
      .sort(sortField)
      .limit(limit)
      .select("username avatar balance totalBet totalWin totalNet totalWins bestStreak streak roundsPlayed");

    res.json(list.map(u => ({
      username: u.username,
      avatar: u.avatar || "",
      balance: u.balance,
      totalBet: u.totalBet || 0,
      totalWin: u.totalWin || 0,
      totalNet: u.totalNet || 0,
      totalWins: u.totalWins || 0,
      bestStreak: u.bestStreak || 0,
      streak: u.streak || 0,
      roundsPlayed: u.roundsPlayed || 0
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
