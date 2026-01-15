import { GoogleGenAI, Type } from "@google/genai";
import { PiiCategory } from "./types";

export interface DetectionResult {
  text: string;
  category: PiiCategory;
  box_2d: [number, number, number, number];
}

export const detectPiiInImage = async (
  base64Image: string,
  targetCategories: PiiCategory[],
  customKeywords: string[]
): Promise<DetectionResult[]> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey || apiKey === "UNDEFINED" || apiKey.length < 10) {
    throw new Error("Klucz API nie został skonfigurowany. Dodaj API_KEY w ustawieniach Vercel (Environment Variables).");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3-flash-preview';
  
  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Dodatkowo oznacz te konkretne frazy: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Jesteś ekspertem RODO. Znajdź i oznacz dane wrażliwe na obrazie dokumentu.
  Kategorie do wykrycia: ${categoryList}.${keywordsText}
  Zwróć JSON jako tablicę obiektów {text, category, box_2d: [ymin, xmin, ymax, xmax] (skala 0-1000)}.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              category: { type: Type.STRING },
              box_2d: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER }
              }
            },
            required: ["text", "category", "box_2d"]
          }
        }
      },
    });

    if (!response.text) return [];
    return JSON.parse(response.text.trim());
  } catch (error: any) {
    console.error("Gemini Error:", error);
    throw new Error("Błąd podczas analizy strony przez AI. Spróbuj ponownie za chwilę.");
  }
};
