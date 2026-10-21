import express from "express";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from beside server.js, regardless of the folder the app is started from.
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const modePrompts = {
    general: "You are Smart AI, a friendly and helpful personal assistant. Give clear, accurate and concise answers.",
    creative: "You are Smart AI in Writing & Ideas mode. Help with creative writing, brainstorming and polished wording.",
    study: "You are Smart AI in Study helper mode. Explain concepts step by step with simple examples, like a patient tutor.",
    fitness: "You are Smart AI in Fitness coach mode. Give safe, general fitness and nutrition guidance suited to the user's level. Remind the user this is not medical advice and to consult a professional for injuries or health conditions."
};

function systemInstruction(mode, profile) {
    let text = modePrompts[mode] || modePrompts.general;

    if (mode === "fitness" && profile && typeof profile === "object") {
        const details = Object.entries(profile)
            .filter(([, value]) => value)
            .map(([key, value]) => `${key}: ${String(value).slice(0, 100)}`)
            .join(", ");
        if (details) text += ` User preferences: ${details}.`;
    }

    return text;
}

// Convert the browser's history ({role: "user"|"assistant", content}) into Gemini's format.
function toGeminiContents(history, message) {
    const contents = [];

    if (Array.isArray(history)) {
        for (const item of history.slice(-20)) {
            if (!item || typeof item.content !== "string" || !item.content.trim()) continue;
            const role = item.role === "user" ? "user" : "model";
            const last = contents[contents.length - 1];
            // Gemini expects user/model turns to alternate; merge consecutive turns from the same role.
            if (last && last.role === role) {
                last.parts[0].text += "\n\n" + item.content;
            } else {
                contents.push({ role, parts: [{ text: item.content }] });
            }
        }
    }

    // The conversation must start with a user turn.
    while (contents.length && contents[0].role !== "user") contents.shift();

    const last = contents[contents.length - 1];
    if (last && last.role === "user") {
        last.parts[0].text += "\n\n" + message;
    } else {
        contents.push({ role: "user", parts: [{ text: message }] });
    }

    return contents;
}

function explainError(error) {
    const status = error?.status;
    const text = String(error?.message || "");

    if (/API_KEY_INVALID|API key not valid/i.test(text)) {
        return { status: 401, error: "Your Gemini API key is invalid. Check GEMINI_API_KEY in your .env file." };
    }
    if (status === 403 || /PERMISSION_DENIED/i.test(text)) {
        return { status: 403, error: "Your Gemini API key does not have access to this model or the Generative Language API." };
    }
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(text)) {
        return { status: 429, error: "Gemini quota or rate limit reached. Wait a minute and try again, or check your plan in Google AI Studio." };
    }
    if (status === 503 || /UNAVAILABLE|overloaded|high demand/i.test(text)) {
        return { status: 502, error: "Gemini is experiencing high demand right now. Please try again in a moment." };
    }
    if (status === 404 || /NOT_FOUND/i.test(text)) {
        return { status: 404, error: "The configured Gemini model was not found. Check GEMINI_MODEL in your .env file." };
    }
    return { status: 500, error: "Unable to get an AI response. Check your internet connection and Gemini API key." };
}

// When Gemini is temporarily overloaded (503), retry once, using the fallback model if one is given.
async function generate(request, fallbackModel) {
    try {
        return await ai.models.generateContent(request);
    } catch (error) {
        if (error?.status !== 503) throw error;
        console.warn(`${request.model} is overloaded; retrying${fallbackModel ? ` with ${fallbackModel}` : ""}.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return ai.models.generateContent(fallbackModel ? { ...request, model: fallbackModel } : request);
    }
}

function requireKey(res) {
    if (ai) return true;
    res.status(503).json({
        code: "not_configured",
        error: "AI is not configured. Add GEMINI_API_KEY to the .env file beside server.js, then restart the server."
    });
    return false;
}

app.get("/api/health", (req, res) => {
    res.json({ ok: true, configured: Boolean(ai), model: CHAT_MODEL });
});

app.post("/api/chat", async (req, res) => {
    const { message, history, mode, profile } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "Please enter a message." });
    }
    if (!requireKey(res)) return;

    try {
        const response = await generate({
            model: CHAT_MODEL,
            contents: toGeminiContents(history, message.slice(0, 8000)),
            config: { systemInstruction: systemInstruction(mode, profile) }
        }, FALLBACK_MODEL !== CHAT_MODEL ? FALLBACK_MODEL : undefined);

        res.json({ reply: response.text || "Sorry, I could not generate a response. Please try rephrasing." });
    } catch (error) {
        console.error("Gemini chat error:", error.message);
        const { status, error: msg } = explainError(error);
        res.status(status).json({ error: msg });
    }
});

app.post("/api/image", async (req, res) => {
    const { prompt, aspectRatio } = req.body || {};

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ error: "Please describe the image first." });
    }
    if (!requireKey(res)) return;

    try {
        const response = await generate({
            model: IMAGE_MODEL,
            contents: prompt.slice(0, 2000),
            config: IMAGE_RATIOS.includes(aspectRatio) ? { imageConfig: { aspectRatio } } : undefined
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(part => part.inlineData?.data);

        if (!imagePart) {
            return res.status(502).json({ error: "Gemini did not return an image. Try a different description." });
        }

        const { mimeType = "image/png", data } = imagePart.inlineData;
        res.json({ image: `data:${mimeType};base64,${data}` });
    } catch (error) {
        console.error("Gemini image error:", error.message);
        const { status, error: msg } = explainError(error);
        res.status(status).json({
            error: status === 429
                ? "Image generation quota reached. Gemini image models may need a paid (billing-enabled) API key."
                : msg
        });
    }
});

app.listen(PORT, () => {
    console.log(`Smart AI Chatbot running at http://localhost:${PORT}`);
    if (!ai) console.warn("Warning: GEMINI_API_KEY is not set. Add it to .env to enable AI replies.");
});
