app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object) {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages) {
      const from = messages[0].from;

      // Your reply message
      const response = {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: "👋 Welcome to Pay4Pump!\n\n1. Buy Fuel\n2. Check Price\n3. Find Station"
        }
      };

      // Send message back
      await fetch(
        `https://graph.facebook.com/v18.0/${value.metadata.phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`
            "Content-Type": "application/json"
          },
          body: JSON.stringify(response)
        }
      );
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});
