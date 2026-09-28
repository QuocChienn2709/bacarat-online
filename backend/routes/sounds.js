const express = require("express");
const Sound = require("../models/Sound");
const router = express.Router();

// Danh sách metadata âm thanh (không trả về data)
router.get("/", async (req, res) => {
  try {
    const list = await Sound.find().select("key mimetype size filename updatedAt");
    res.json(list.map(s => ({
      key: s.key,
      mimetype: s.mimetype,
      size: s.size,
      filename: s.filename,
      updatedAt: s.updatedAt
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trả file âm thanh raw
router.get("/:key/audio", async (req, res) => {
  try {
    const sound = await Sound.findOne({ key: req.params.key });
    if (!sound || !sound.data) return res.status(404).end();
    res.set("Content-Type", sound.mimetype || "audio/mpeg");
    res.set("Cache-Control", "public, max-age=3600");
    res.set("Content-Length", sound.data.length);
    res.send(sound.data);
  } catch (e) {
    res.status(500).end();
  }
});

module.exports = router;
