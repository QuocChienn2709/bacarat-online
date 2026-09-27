require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const authRoutes = require("./routes/auth");
const gameRoutes = require("./routes/game");
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");
const Chat = require("./models/Chat");
const engine = require("./game/engine");

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);
app.get("/", (req, res) => res.json({ ok: true, service: "baccarat v2" }));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try { socket.user = jwt.verify(token, process.env.JWT_SECRET); } catch(e){}
  }
  next();
});

let onlineCount = 0;
let onlineUsers = new Map(); // username -> socketId

function broadcastOnline() {
  io.emit("online:count", {
    total: onlineUsers.size,
    sockets: onlineCount,
    users: Array.from(onlineUsers.keys())
  });
}

io.on("connection", socket => {
  onlineCount++;
  if (socket.user) onlineUsers.set(socket.user.username, socket.id);

  broadcastOnline();
  socket.emit("game:state", engine.getPublicState());
  socket.emit("game:leaderboard", {
    roundId: engine.roundId,
    entries: engine.getLeaderboard()
  });

  Chat.find().sort({ createdAt: -1 }).limit(50).then(list => {
    socket.emit("chat:history", list.reverse());
  });

  socket.on("chat:send", async msg => {
    if (!socket.user) return;
    if (!msg || !msg.trim()) return;
    const chat = await Chat.create({
      username: socket.user.username,
      message: String(msg).slice(0, 200)
    });
    io.emit("chat:new", chat);
  });

  socket.on("disconnect", () => {
    onlineCount--;
    if (socket.user) {
      if (onlineUsers.get(socket.user.username) === socket.id) {
        onlineUsers.delete(socket.user.username);
      }
    }
    broadcastOnline();
  });
});

engine.on("state", state => {
  io.emit("game:state", state);
});

engine.on("leaderboard", data => {
  io.emit("game:leaderboard", data);
});

engine.on("settled", ({ roundId, result, settlements }) => {
  for (const s of settlements) {
    for (const [id, sock] of io.sockets.sockets) {
      if (sock.user && sock.user.username === s.username) {
        sock.emit("game:settled", {
          roundId, result, net: s.net, balance: s.balance, won: s.won
        });
      }
    }
  }
  io.emit("game:result", { roundId, result });
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    engine.start();
    console.log("🎰 Game engine started");
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`🚀 Server @ ${PORT}`));
  })
  .catch(err => {
    console.error("❌ MongoDB lỗi:", err.message);
    process.exit(1);
  });