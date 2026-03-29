const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// Test route
app.get("/", (req, res) => {
  res.send("Pay4Pump WhatsApp Bot is Live 🚀");
});

// Webhook route
app.post("/webhook", (req, res) => {
  console.log("Incoming message:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
