import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 🔐 Environment variables
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// 🧠 In-memory session (demo purpose)
const userSessions = {};

// 💰 Token reward logic
function calculateReward(fuel, quantity) {
  if (fuel === "CNG") {
    return quantity * 5; // 🔥 Higher reward for clean energy
  } else {
    return quantity * 2; // Standard reward
  }
}

// ===============================
// ✅ Webhook Verification
// ===============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ===============================
// 📩 Handle Messages
// ===============================
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body?.toLowerCase() || "";

      console.log("📩 Incoming:", text);

      if (!userSessions[from]) {
        userSessions[from] = { step: "menu" };
      }

      let responseText = "";

      switch (userSessions[from].step) {

        // 🏠 MAIN MENU
        case "menu":
          if (text === "1") {
            userSessions[from].step = "fuel_type";
            responseText = "⛽ Select fuel type:\n1. Petrol\n2. Diesel\n3. CNG (Clean Energy ♻️)";
          } else if (text === "2") {
            responseText =
              "📊 Current Prices:\nPetrol: ₦650/L\nDiesel: ₦900/L\nCNG: ₦200/KG";
          } else if (text === "3") {
            responseText =
              "📍 Nearest stations:\n- NNPC\n- Total Energies\n- Mobil\n- CNG Stations Available";
          } else {
            responseText =
              "👋 Welcome to Pay4Pump!\n\n1. Buy Fuel\n2. Check Price\n3. Find Station";
          }
          break;

        // ⛽ FUEL TYPE
        case "fuel_type":
          if (text === "1") {
            userSessions[from].fuel = "Petrol";
            userSessions[from].unit = "Litres";
            userSessions[from].step = "quantity";
            responseText = "How many litres of Petrol do you want?";
          } else if (text === "2") {
            userSessions[from].fuel = "Diesel";
            userSessions[from].unit = "Litres";
            userSessions[from].step = "quantity";
            responseText = "How many litres of Diesel do you want?";
          } else if (text === "3") {
            userSessions[from].fuel = "CNG";
            userSessions[from].unit = "KG";
            userSessions[from].step = "quantity";
            responseText =
              "🌱 CNG selected (Clean Energy Bonus Activated!)\n\nHow many KG do you want?";
          } else {
            responseText = "Please choose:\n1. Petrol\n2. Diesel\n3. CNG";
          }
          break;

        // 🔢 QUANTITY
        case "quantity":
          const qty = parseFloat(text);
          if (!isNaN(qty) && qty > 0) {
            userSessions[from].quantity = qty;
            userSessions[from].step = "confirm";

            const reward = calculateReward(userSessions[from].fuel, qty);

            responseText = `🧾 Confirm Order:\nFuel: ${userSessions[from].fuel}\nQuantity: ${qty} ${userSessions[from].unit}\n\n🎁 Reward: ${reward} Tokens\n\nReply YES to confirm or NO to cancel`;
          } else {
            responseText = "Please enter a valid quantity.";
          }
          break;

        // ✅ CONFIRM
        case "confirm":
          if (text === "yes") {
            const { fuel, quantity } = userSessions[from];
            const reward = calculateReward(fuel, quantity);

            responseText =
              `✅ Order Confirmed!\n\nFuel: ${fuel}\nQuantity: ${quantity}\n\n🎁 You earned ${reward} tokens!\n\n💳 Payment integration coming soon.`;

            userSessions[from].step = "menu";
          } else if (text === "no") {
            responseText = "❌ Order cancelled.\nReturning to menu.";
            userSessions[from].step = "menu";
          } else {
            responseText = "Please reply YES or NO.";
          }
          break;

        default:
          userSessions[from].step = "menu";
          responseText =
            "👋 Welcome to Pay4Pump!\n\n1. Buy Fuel\n2. Check Price\n3. Find Station";
      }

      // ===============================
      // 📤 Send Reply
      // ===============================
      await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: responseText },
        }),
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error:", error);
    res.sendStatus(500);
  }
});

// ===============================
// 🚀 Server
// ===============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
