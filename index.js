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

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Incoming messages
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    if (!body.object) return res.sendStatus(404);

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const msgBody = message.text?.body?.toLowerCase() || "";

    // Check if user exists
    let user = await User.findOne({ whatsappNumber: from });

    // User registration
    if (!user) {
      const parts = msgBody.split(",");
      if (parts.length < 2) {
        await sendWhatsAppMessage(from, "Please send your Driver License and Vehicle Plate in this format: LICENSE,PLATE");
        return res.sendStatus(200);
      }

      const [driverLicense, vehiclePlate] = parts.map(p => p.trim());

      user = new User({ whatsappNumber: from, driverLicense, vehiclePlate });
      await user.save();

      await sendWhatsAppMessage(from, "✅ Registration complete! Now you can buy fuel and earn tokens.\nPlease provide: FUEL_TYPE,STATION_NAME");
      return res.sendStatus(200);
    }

    // Fuel purchase flow
    const parts = msgBody.split(",");
    if (parts.length < 2) {
      await sendWhatsAppMessage(from, "Please provide both FUEL_TYPE and STATION_NAME, e.g., Diesel,Shell Ikeja");
      return res.sendStatus(200);
    }

    const [fuelType, stationName] = parts.map(p => p.trim());
    const station = await Station.findOne({ name: new RegExp(stationName, "i"), licensed: true });

    if (!station) {
      await sendWhatsAppMessage(from, `❌ Station "${stationName}" is not recognized or licensed. Please choose a valid licensed station.`);
      return res.sendStatus(200);
    }

    // Token rewards
    let reward = 0;
    if (fuelType === "diesel") reward = 10;
    else if (fuelType === "petrol") reward = 10;
    else if (fuelType === "cng") reward = 20;

    if (reward > 0) {
      user.wallet += reward;
      await user.save();
      await sendWhatsAppMessage(from, `💰 You've earned ${reward} tokens for purchasing ${fuelType.toUpperCase()} at ${station.name}.\nYour wallet balance: ${user.wallet} tokens.`);
    } else {
      await sendWhatsAppMessage(from, "Invalid fuel type. Please choose Diesel, Petrol, or CNG.");
    }

    res.sendStatus(200);

  } catch (error) {
    console.error("Error:", error);
    res.sendStatus(500);
  }
});

// WhatsApp API helper
async function sendWhatsAppMessage(to, text) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      })
    });
  } catch (err) {
    console.error("❌ WhatsApp send error:", err);
  }
}

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
