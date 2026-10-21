import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.post("/api/chat", async (req, res) => {
    try {
        const message = req.body.message;

        if (!message || typeof message !== "string") {
            return res.status(400).json({
                error: "Please enter a message."
            });
        }

        const response = await openai.responses.create({
            model: "gpt-4.1-mini",
            input: message
        });

        res.json({
            reply: response.output_text
        });

    } catch (error) {
        console.error("API Error:", error.message);

        res.status(500).json({
            error: "Unable to get an AI response. Check your API key and billing."
        });
    }
});

app.listen(3000, () => {
    console.log("Smart AI Chatbot running at http://localhost:3000");
});