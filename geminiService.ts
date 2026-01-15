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
    throw new Error("Brak klucza API. Upewnij się, że dodałeś API_KEY w Settings -> Environment Variables na Vercel.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3-flash-preview';
  
  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Dodatkowo oznacz te konkretne frazy: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Jesteś ekspertem ochrony danych osobowych (RODO). Twoim zadaniem jest znalezienie i oznaczenie danych wrażliwych na tym dokumencie.
  Wyszukaj następujące kategorie: ${categoryList}.${keywordsText}
  Zwróć wynik wyłącznie w formacie JSON jako tablicę obiektów:
  { "text": "wykryty tekst", "category": "NAZWA_KATEGORII", "box_2d": [ymin, xmin, ymax, xmax] }
  Współrzędne box_2d muszą być w skali 0-1000.`;

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
    console.error("Gemini Technical Error:", error);
    // Przekazujemy konkretny błąd dalej
    if (error.message?.includes("API_KEY_INVALID")) {
      throw new Error("Twój klucz API jest nieprawidłowy.");
    }
    if (error.message?.includes("quota")) {
      throw new Error("Przekroczono limit zapytań API (Quota exceeded).");
    }
    throw new Error(error.message || "Błąd komunikacji z modelem AI.");
  }
};
