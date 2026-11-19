import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;


// WhatsApp voice-note transcription
async function transcribeWhatsAppAudio(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!token || !openai) {
    throw new Error("WhatsApp or OpenAI credentials are missing");
  }

  const mediaResponse = await fetch(
    `https://graph.facebook.com/v25.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!mediaResponse.ok) {
    throw new Error("Unable to retrieve WhatsApp audio");
  }

  const mediaData = await mediaResponse.json();

  if (!mediaData.url) {
    throw new Error("WhatsApp audio URL is missing");
  }

  const audioResponse = await fetch(mediaData.url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!audioResponse.ok) {
    throw new Error("Unable to download WhatsApp audio");
  }

  const audioBuffer = Buffer.from(
    await audioResponse.arrayBuffer()
  );

  const audioFile = new File(
    [audioBuffer],
    "voice-note.ogg",
    { type: mediaData.mime_type || "audio/ogg" }
  );

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "gpt-transcribe"
  });

  return transcription.text.trim();
}

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
            if (message.type !== "text" && message.type !== "audio") continue;

            let incomingText;

            if (message.type === "audio") {
                const audioId = message.audio?.id;

                if (!audioId) continue;

                try {
                    incomingText = await transcribeWhatsAppAudio(audioId);
                } catch (error) {
                    console.error("WhatsApp audio transcription error:", error);
                    await sendWhatsAppMessage(
                        message.from,
                        "Sorry, I couldn't understand that voice note. Please try again or send your message as text."
                    );
                    continue;
                }
            } else {
                incomingText = message.text?.body || "";
            }

            incomingText = (incomingText || "").trim().toLowerCase();

            if (!incomingText) continue;

            console.log("Incoming WhatsApp message:", {
              from: message.from,
              text: incomingText
            });

            let reply;

        try {
          if (!openai) {
            throw new Error("OpenAI API key is not configured");
          }

          const aiResponse = await openai.responses.create({
            model: process.env.OPENAI_MODEL || "gpt-5.5",
            instructions: `You are the Sureway Pay4Pump WhatsApp AI assistant.

You represent Sureway Integrated Technology Solutions Limited.

Help users with:
1. Pay4Pump and Smart Fuel Africa: digital fuel access, bookings and rewards.
2. CargoConnectAI: cargo owners and transport operators.
3. SureWay Market Access AI: buyers, suppliers and SMEs.
4. SureWay customer support.

Communicate naturally, politely and concisely.
Use simple English and respond in the user's language where possible.

Ask relevant follow-up questions to understand the user's needs.
Never invent fuel prices, station availability, bookings, payments,
wallet balances or token transactions.
Never claim a transaction has been completed unless the system confirms it.
Do not request passwords, API keys, PINs or sensitive payment credentials.
For issues requiring human intervention, direct the user to SureWay Support.`,
            input: incomingText,
            max_output_tokens: 250
          });

          reply = (aiResponse.output_text || "").trim();

          if (!reply) {
            throw new Error("OpenAI returned an empty response");
          }
        } catch (error) {
          console.error("OpenAI conversation error:", error);
          reply = "Sorry, I'm having difficulty responding right now. Please try again shortly or contact SureWay Support.";
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
