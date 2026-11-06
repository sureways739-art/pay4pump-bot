import express from "express";
import fetch from "node-fetch";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

// Sureway WhatsApp Cloud API sender
async function sendWhatsAppMessage(to, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp API credentials are missing");
  }

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: message }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("WhatsApp API error:", result);
    throw new Error("WhatsApp message failed");
  }

  return result;
}

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

userType: {
  type: String,
  enum: [
    "motorist",
    "motorcyclist",
    "truck_driver",
    "fleet_operator",
    "station_operator"
  ],
  default: "motorist"
},

ninVerification: {
  status: {
    type: String,
    enum: ["not_submitted", "pending", "verified", "failed"],
    default: "not_submitted"
  },
  consentStatus: {
    type: String,
    enum: ["not_given", "granted", "withdrawn"],
    default: "not_given"
  },
  providerReference: { type: String, default: null },
  verifiedAt: { type: Date, default: null },
  consentAt: { type: Date, default: null },
  consentWithdrawnAt: { type: Date, default: null },
  consentVersion: { type: String, default: null }
},

wallet: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const stationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  licensed: { type: Boolean, default: false },
  location: String
});

userSchema.add({
  passwordHash: {
    type: String,
    default: null,
    select: false
  }
});
const User = mongoose.model("User", userSchema);
const Station = mongoose.model("Station", stationSchema);
// Pay4Pump multilingual conversation profile
const conversationProfileSchema = new mongoose.Schema({
  whatsappNumber: {
    type: String,
    required: true,
    unique: true
  },
  preferredLanguage: {
    type: String,
    enum: ["en", "ha", "yo", "ig", "pcm"],
    default: "en"
  },
  responseMode: {
    type: String,
    enum: ["text", "voice", "both"],
    default: "both"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const ConversationProfile = mongoose.model(
  "ConversationProfile",
  conversationProfileSchema
);
const app = express();
app.use(express.json());
// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required"
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found"
      });
    }

    req.user = user;
    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token"
    });
  }
};
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
// Pay4Pump customer language preference endpoint
app.post("/language/preference", async (req, res) => {
  try {
    const { whatsappNumber, preferredLanguage, responseMode } = req.body;

    const allowedLanguages = ["en", "ha", "yo", "ig", "pcm"];
    const allowedModes = ["text", "voice", "both"];

    if (!whatsappNumber || !allowedLanguages.includes(preferredLanguage)) {
      return res.status(400).json({
        success: false,
        message: "Valid WhatsApp number and language are required"
      });
    }

    const mode = responseMode || "both";

    if (!allowedModes.includes(mode)) {
      return res.status(400).json({
        success: false,
        message: "Response mode must be text, voice or both"
      });
    }

    const profile = await ConversationProfile.findOneAndUpdate(
      { whatsappNumber },
      {
        $set: {
          preferredLanguage,
          responseMode: mode
        }
      },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Language preference saved",
      profile: {
        preferredLanguage: profile.preferredLanguage,
        responseMode: profile.responseMode
      }
    });
  } catch (error) {
    console.error("Language preference error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to save language preference"
    });
  }
});
// WhatsApp incoming message receiver
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
console.log("========== WHATSAPP POST RECEIVED ==========");
console.log("Webhook object:", body?.object);

    if (body.object === "whatsapp_business_account") {
      const entries = body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          const value = change.value || {};
          const messages = value.messages || [];

          for (const message of messages) {
            if (message.type !== "text") continue;

            const incomingText = (message.text?.body || "")
              .trim()
              .toLowerCase();

            console.log("Incoming WhatsApp message:", {
              from: message.from,
              text: incomingText
            });

            let reply;

            switch (incomingText) {
              case "1":
                reply = "SMEs Connect AI – Market Access. We help businesses, buyers and suppliers connect. Please tell us whether you are a buyer or supplier.";
                break;
              case "2":
                reply = "CargoConnectAI – Logistics. We connect cargo owners with transport operators. Are you a cargo owner or transporter?";
                break;
              case "3":
                reply = "Smart Fuel Africa / Pay4Pump – Energy. We support digital fuel access and bookings. Are you a motorist, fleet operator or filling-station partner?";
                break;
              case "4":
                reply = "SureWay Support. Please describe how our team can assist you.";
                break;
              default:
                reply = "Welcome to SureWay Integrated Technology Solutions Ltd!\n\nPlease select a service:\n\n1. SMEs Connect AI – Market Access\n2. CargoConnectAI – Logistics\n3. Smart Fuel Africa / Pay4Pump – Energy\n4. Speak to SureWay Support\n\nReply with 1, 2, 3 or 4.";
            }

            await sendWhatsAppMessage(message.from, reply);
          }
        }
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return res.sendStatus(500);
  }
});

// NIN verification consent endpoint
app.post("/nin/consent", authenticateToken, async (req, res) => {
    try {
        const { consent } = req.body;

        if (typeof consent !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "A valid consent decision is required"
            });
        }

        const updates = consent
            ? {
                "ninVerification.consentStatus": "granted",
                "ninVerification.consentAt": new Date(),
                "ninVerification.consentWithdrawnAt": null
            }
            : {
                "ninVerification.consentStatus": "withdrawn",
                "ninVerification.consentWithdrawnAt": new Date()
            };

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: consent
                ? "NIN verification consent recorded"
                : "NIN verification consent withdrawn",
            consentStatus: user.ninVerification.consentStatus,
            ninVerificationStatus: user.ninVerification.status
        });

    } catch (error) {
        console.error("NIN consent error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to process NIN consent"
        });
    }
});

// USER REGISTRATION
app.post("/auth/register", async (req, res) => {
  try {
    const {
      whatsappNumber,
      password,
      driverLicense,
      vehiclePlate,
      userType
    } = req.body;

    if (
      !whatsappNumber ||
      !password ||
      !driverLicense ||
      !vehiclePlate ||
      !userType
    ) {
      return res.status(400).json({
        success: false,
        message: "All registration fields are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    const existingUser = await User.findOne({
      whatsappNumber
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "WhatsApp number already registered"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      whatsappNumber,
      driverLicense,
      vehiclePlate,
      userType,
      passwordHash
    });

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        id: user._id,
        whatsappNumber: user.whatsappNumber,
        userType: user.userType
      }
    });

  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
});


// USER LOGIN
app.post("/auth/login", async (req, res) => {
  try {
    const { whatsappNumber, password } = req.body;

    if (!whatsappNumber || !password) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp number and password are required"
      });
    }

    const user = await User.findOne({
      whatsappNumber
    }).select("+passwordHash");

    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid WhatsApp number or password"
      });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        whatsappNumber: user.whatsappNumber,
        userType: user.userType
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
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
