const express = require("express");
const Chat = require("../models/Chat");
const { auth } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  const list = await Chat.find().sort({ createdAt: -1 }).limit(100);
  res.json(list.reverse());
});

router.post("/", auth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim())
    return res.status(400).json({ error: "Tin nhắn rỗng" });
  const chat = await Chat.create({
    username: req.user.username,
    message: String(message).slice(0, 200)
  });
  res.json(chat);
});

module.exports = router;