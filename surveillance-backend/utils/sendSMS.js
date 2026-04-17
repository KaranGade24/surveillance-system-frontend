const { Twilio } = require("twilio");

// Twilio credentials (store in .env)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = new Twilio(accountSid, authToken);

// Function to send message
exports.sendSMS = async (to, message) => {
  try {
    const response = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER, // Twilio number
      to: to, // recipient number (+91XXXXXXXXXX)
    });

    console.log("Message sent:", response.sid);
    return response;
  } catch (error) {
    console.error("Error sending SMS:", error.message);
    throw error;
  }
};
