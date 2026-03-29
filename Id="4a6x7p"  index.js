Javascript id="lq6n8w"
const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// In-memory database
let users = {};
let transactions = [];

app.post("/whatsapp", (req, res) => {
  const msg = req.body.Body.trim();
  const from = req.body.From;

  let response = "";

  // Register user
  if (msg.startsWith("REGISTER")) {
    const name = msg.split(" ")[1];
    users[from] = { name, points: 0 };
    response = `Welcome ${name}, you are registered for Pay4Pump!`;
  }

  // Simulate fuel transaction
  else if (msg.startsWith("STATION_")) {
    if (!users[from]) {
      response = "Please register first using REGISTER YourName";
    } else {
      const station = msg;
      users[from].points += 10;

      transactions.push({
        user: from,
        station,
        points: 10
      });

      response = `Fuel purchase recorded at ${station}. You earned 10 points!`;
    }
  }

  else {
    response = "Invalid command. Use REGISTER or STATION_123";
  }

  res.set("Content-Type", "text/xml");
  res.send(`<Response><Message>${response}</Message></Response>`);
});

app.listen(3000, () => console.log("Server running on port 3000"));
