const EventEmitter = require("events");
const History = require("../models/History");
const Bet = require("../models/Bet");
const User = require("../models/User");

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const DECKS = 8;

const BET_SECONDS = 10;
const DEAL_PAUSE = 1500;
const FLIP_DELAY = 600;
const BETWEEN_PHASE = 1500;
const RESULT_SECONDS = 5000;

function buildShoe() {
  const shoe = [];
  for (let d = 0; d < DECKS; d++)
    for (const s of SUITS)
      for (const r of RANKS)
        shoe.push({ suit: s, rank: r });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function cardValue(c) {
  if (["10","J","Q","K"].includes(c.rank)) return 0;
  if (c.rank === "A") return 1;
  return Number(c.rank);
}

function handScore(hand) {
  return hand.reduce((s, c) => s + cardValue(c), 0) % 10;
}

function bankerShouldDraw(bs, pThird) {
  if (pThird === null) return bs <= 5;
  const v = cardValue(pThird);
  if (bs <= 2) return true;
  if (bs === 3) return v !== 8;
  if (bs === 4) return v >= 2 && v <= 7;
  if (bs === 5) return v >= 4 && v <= 7;
  if (bs === 6) return v === 6 || v === 7;
  return false;
}

class GameEngine extends EventEmitter {
  constructor() {
    super();
    this.shoe = buildShoe();
    this.roundId = 0;
    this.phase = "betting";
    this.countdown = BET_SECONDS;
    this.player = [];
    this.banker = [];
    this.playerScore = 0;
    this.bankerScore = 0;
    this.result = null;
    this.currentBets = new Map();
    this.timer = null;
    this.history = [];
    this._loadHistory();
  }

  async _loadHistory() {
    try {
      const list = await History.find().sort({ createdAt: -1 }).limit(30);
      this.history = list.reverse();
      const last = await History.findOne().sort({ roundId: -1 });
      if (last) this.roundId = last.roundId;
    } catch (e) {
      console.error("Load history error:", e.message);
    }
  }

  drawCard() {
    if (this.shoe.length < 20) this.shoe = buildShoe();
    return this.shoe.pop();
  }

  getLeaderboard() {
    const list = [];
    for (const [username, bets] of this.currentBets) {
      const total = bets.player + bets.banker + bets.tie;
      if (total <= 0) continue;
      list.push({
        username,
        player: bets.player,
        banker: bets.banker,
        tie: bets.tie,
        total
      });
    }
    list.sort((a, b) => b.total - a.total);
    return list;
  }

  getPublicState() {
    return {
      roundId: this.roundId,
      phase: this.phase,
      countdown: this.countdown,
      player: this.player,
      banker: this.banker,
      playerScore: this.playerScore,
      bankerScore: this.bankerScore,
      result: this.result,
      history: this.history.slice(-30),
      leaderboard: this.getLeaderboard()
    };
  }

  broadcastState() {
    this.emit("state", this.getPublicState());
  }

  broadcastLeaderboard() {
    this.emit("leaderboard", {
      roundId: this.roundId,
      entries: this.getLeaderboard()
    });
  }

  start() {
    this._startBettingPhase();
  }

  _startBettingPhase() {
    clearInterval(this.timer);
    this.phase = "betting";
    this.countdown = BET_SECONDS;
    this.player = [];
    this.banker = [];
    this.playerScore = 0;
    this.bankerScore = 0;
    this.result = null;
    this.currentBets.clear();
    this.broadcastState();
    this.broadcastLeaderboard();

    this.timer = setInterval(() => {
      this.countdown--;
      this.broadcastState();
      if (this.countdown <= 0) {
        clearInterval(this.timer);
        this._dealRound();
      }
    }, 1000);
  }

  async placeBet(username, side, amount, user) {
    if (this.phase !== "betting")
      throw new Error("Không trong thời gian đặt cược");
    if (!["player","banker","tie"].includes(side))
      throw new Error("Cửa cược không hợp lệ");
    if (amount <= 0)
      throw new Error("Số tiền không hợp lệ");

    const cur = this.currentBets.get(username) || { player:0, banker:0, tie:0 };

    if (side === "player" && cur.banker > 0) throw new Error("Đã cược Banker");
    if (side === "banker" && cur.player > 0) throw new Error("Đã cược Player");

    if (user.balance < amount)
      throw new Error("Không đủ số dư");

    user.balance -= amount;
    await user.save();

    cur[side] += amount;
    this.currentBets.set(username, cur);

    await Bet.findOneAndUpdate(
      { roundId: this.roundId, username },
      { $inc: { [`bets.${side}`]: amount } },
      { upsert: true }
    );

    this.broadcastLeaderboard();

    return { ok: true, balance: user.balance, bets: cur };
  }

  async _dealRound() {
    this.roundId++;
    this.phase = "dealing";
    this.broadcastState();

    const p1 = this.drawCard(), b1 = this.drawCard();
    const p2 = this.drawCard(), b2 = this.drawCard();
    const ps = handScore([p1, p2]);
    const bs = handScore([b1, b2]);
    let p3 = null, b3 = null;

    if (ps < 8 && bs < 8) {
      if (ps <= 5) {
        p3 = this.drawCard();
        if (bankerShouldDraw(bs, p3)) b3 = this.drawCard();
      } else {
        if (bankerShouldDraw(bs, null)) b3 = this.drawCard();
      }
    }

    this.player = [p1, p2, ...(p3 ? [p3] : [])].map(c => ({ ...c, revealed: false }));
    this.banker = [b1, b2, ...(b3 ? [b3] : [])].map(c => ({ ...c, revealed: false }));
    this.broadcastState();

    await this._sleep(DEAL_PAUSE);

    this.player[0].revealed = true;
    this.playerScore = handScore([this.player[0]]);
    this.broadcastState();
    await this._sleep(FLIP_DELAY);

    this.banker[0].revealed = true;
    this.bankerScore = handScore([this.banker[0]]);
    this.broadcastState();
    await this._sleep(BETWEEN_PHASE);

    this.player[1].revealed = true;
    this.playerScore = handScore(this.player.filter(c=>c.revealed));
    this.broadcastState();
    await this._sleep(FLIP_DELAY);

    this.banker[1].revealed = true;
    this.bankerScore = handScore(this.banker.filter(c=>c.revealed));
    this.broadcastState();

    if (ps >= 8 || bs >= 8) {
      await this._sleep(BETWEEN_PHASE);
      return this._finishRound();
    }

    if (p3) {
      await this._sleep(BETWEEN_PHASE);
      this.player[2].revealed = true;
      this.playerScore = handScore(this.player.filter(c=>c.revealed));
      this.broadcastState();
    } else {
      await this._sleep(BETWEEN_PHASE);
    }

    if (b3) {
      await this._sleep(BETWEEN_PHASE);
      this.banker[2].revealed = true;
      this.bankerScore = handScore(this.banker.filter(c=>c.revealed));
      this.broadcastState();
    } else {
      await this._sleep(BETWEEN_PHASE);
    }

    this._finishRound();
  }

  async _finishRound() {
    const ps = handScore(this.player);
    const bs = handScore(this.banker);
    this.playerScore = ps;
    this.bankerScore = bs;
    const result = ps > bs ? "player" : bs > ps ? "banker" : "tie";
    this.result = result;
    this.phase = "result";
    this.broadcastState();

    const settlements = [];
    for (const [username, bets] of this.currentBets) {
      let winReturn = 0, won = false;
      if (result === "player" && bets.player > 0) { winReturn += bets.player * 2; won = true; }
      if (result === "banker" && bets.banker > 0) { winReturn += bets.banker * 2; won = true; }
      if (result === "tie") {
        if (bets.tie > 0) { winReturn += bets.tie * 9; won = true; }
        winReturn += bets.player + bets.banker;
      }
      const stake = bets.player + bets.banker + bets.tie;
      const net = winReturn - stake;

      try {
        const user = await User.findOne({ username });
        if (user) {
          user.balance += winReturn;
          user.streak = won ? user.streak + 1 : 0;
          user.roundsPlayed += 1;

          // 🔥 Cập nhật thống kê tổng
          user.totalBet = (user.totalBet || 0) + stake;
          if (won) {
            user.totalWin = (user.totalWin || 0) + winReturn;
            user.totalWins = (user.totalWins || 0) + 1;
            if (user.streak > (user.bestStreak || 0)) {
              user.bestStreak = user.streak;
            }
          }
          user.totalNet = (user.totalNet || 0) + net;

          await user.save();
          settlements.push({ username, balance: user.balance, net, won });
        }
        await Bet.updateOne(
          { roundId: this.roundId, username },
          { settled: true, net }
        );
      } catch (e) {
        console.error("Settle error", username, e.message);
      }
    }

    const record = await History.create({
      roundId: this.roundId,
      result,
      playerScore: ps,
      bankerScore: bs,
      playerCards: this.player.map(c => ({ rank: c.rank, suit: c.suit })),
      bankerCards: this.banker.map(c => ({ rank: c.rank, suit: c.suit }))
    });

    this.history.push(record.toObject());
    if (this.history.length > 30) this.history.shift();

    this.emit("settled", { roundId: this.roundId, result, settlements });

    setTimeout(() => {
      this._startBettingPhase();
    }, RESULT_SECONDS);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = new GameEngine();
