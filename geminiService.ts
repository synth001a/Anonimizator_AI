import { GoogleGenAI, Type } from "@google/genai";
import { PiiCategory } from "./types";

export interface DetectionResult {
  text: string;
  category: PiiCategory;
  box_2d: [number, number, number, number];
}

/**
 * Wykrywa dane osobowe (PII) na obrazku przy użyciu modelu Gemini Vision.
 */
export const detectPiiInImage = async (
  base64Image: string,
  targetCategories: PiiCategory[],
  customKeywords: string[]
): Promise<DetectionResult[]> => {
  // Pobieramy klucz bezpośrednio z process.env.API_KEY (zgodnie z wytycznymi)
  const apiKey = process.env.API_KEY;
  
  if (!apiKey || apiKey === "UNDEFINED" || apiKey === "") {
    throw new Error("Klucz API Gemini nie jest skonfigurowany. Upewnij się, że dodałeś API_KEY w ustawieniach Vercel (Environment Variables).");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-3-flash-preview';
  
  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Dodatkowo oznacz te konkretne frazy: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Jesteś ekspertem ds. ochrony danych (RODO). Znajdź i oznacz dane osobowe na obrazku.
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

    const resultText = response.text;
    if (!resultText) return [];
    
    try {
      const parsed = JSON.parse(resultText.trim());
      // Rygorystyczne rzutowanie na string, aby uniknąć błędów Reacta (Error #31)
      return (Array.isArray(parsed) ? parsed : []).map((item: any) => ({
        text: String(item.text || ''),
        category: (item.category || 'OTHER') as PiiCategory,
        box_2d: Array.isArray(item.box_2d) && item.box_2d.length === 4 
          ? [Number(item.box_2d[0]), Number(item.box_2d[1]), Number(item.box_2d[2]), Number(item.box_2d[3])]
          : [0, 0, 0, 0]
      })) as DetectionResult[];
    } catch (e) {
      console.error("Błąd formatu odpowiedzi AI:", resultText);
      return [];
    }
  } catch (error: any) {
    console.error("Błąd Gemini:", error);
    if (error.message?.includes("not found") || error.message?.includes("key")) {
      throw new Error("Klucz API jest nieprawidłowy lub wygasł. Sprawdź ustawienia w panelu Vercel.");
    }
    throw new Error("AI nie mogło przeanalizować strony: " + (error.message || "Błąd połączenia."));
  }
};
