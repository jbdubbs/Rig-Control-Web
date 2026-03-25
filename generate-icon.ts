import { GoogleGenAI } from "@google/genai";
import fs from "fs";

async function generateIcon() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: 'A high-quality, modern, minimalist amateur radio remote control app icon. The design should feature stylized radio waves, an antenna, or a transceiver silhouette. Sleek, professional, blue and white color scheme. 1024x1024 resolution, centered, solid background.',
        },
      ],
    },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      const base64Data = part.inlineData.data;
      const buffer = Buffer.from(base64Data, 'base64');
      if (!fs.existsSync('assets')) {
        fs.mkdirSync('assets');
      }
      fs.writeFileSync('assets/icon.png', buffer);
      console.log('Icon saved to assets/icon.png');
    }
  }
}

generateIcon().catch(console.error);
