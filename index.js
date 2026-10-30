import express from "express";
import fetch from "node-fetch";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// Schemas
const userSchema = new mongoose.Schema({
  whatsappNumber: { type: String, required: true, unique: true },
  driverLicense: { type: String, required: true },
  vehiclePlate: { type: String, required: true },
  wallet: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const stationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  licensed: { type: Boolean, default: false },
  location: String
});

const User = mongoose.model("User", userSchema);
const Station = mongoose.model("Station", stationSchema);

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// Webhook verification (VERY IMPORTANT)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    process.env.VERIFY_TOKEN &&
    token === process.env.VERIFY_TOKEN
  ) {
    console.log("WhatsApp webhook verified.");
    return res.status(200).send(challenge);
  }

  console.warn("WhatsApp webhook verification rejected.");
  return res.sendStatus(403);
});
// API home route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Sureway Pay4Pump API is running",
    service: "Pay4Pump"
  });
});

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is healthy"
  });
});
   const PORT = process.env.PORT || 10000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
