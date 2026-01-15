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
  
  if (!apiKey || apiKey === "UNDEFINED" || apiKey === "") {
    throw new Error("Klucz API nie został wybrany. Kliknij przycisk 'Konfiguruj Klucz API' u góry ekranu.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-3-flash-preview';
  
  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Dodatkowo oznacz te konkretne frazy: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Jesteś ekspertem RODO. Znajdź i oznacz dane osobowe na obrazku.
  Kategorie: ${categoryList}.${keywordsText}
  Zwróć wynik jako JSON (tablica obiektów z polami: text, category, box_2d: [ymin, xmin, ymax, xmax]).
  Współrzędne box_2d w skali 0-1000. Tylko JSON, bez komentarzy.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
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
                items: { type: Type.NUMBER },
                minItems: 4,
                maxItems: 4
              }
            },
            required: ["text", "category", "box_2d"]
          }
        }
      },
    });

    const text = response.text;
    if (!text) return [];
    
    try {
      const parsed = JSON.parse(text.trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("JSON Error:", text);
      return [];
    }
  } catch (error: any) {
    if (error.message?.includes("429")) {
      throw new Error("Darmowy limit AI został wyczerpany. Spróbuj za minutę.");
    }
    throw new Error("Błąd AI: " + (error.message || "Błąd połączenia."));
  }
};
