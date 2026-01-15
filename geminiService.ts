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
  
  if (!apiKey || apiKey === "UNDEFINED") {
    throw new Error("Klucz API nie jest skonfigurowany.");
  }

  // Tworzymy instancję bezpośrednio przed użyciem, aby mieć pewność co do klucza
  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3-flash-preview';
  
  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Dodatkowo oznacz te konkretne frazy: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Jesteś ekspertem ochrony danych osobowych (RODO). Znajdź i oznacz dane wrażliwe.
  Kategorie: ${categoryList}.${keywordsText}
  Zwróć wynik jako JSON (tablica obiektów {text, category, box_2d: [ymin, xmin, ymax, xmax]}).
  Współrzędne 0-1000.`;

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
    if (error.message?.includes("entity was not found")) {
      throw new Error("RE-AUTH: Wybrany projekt nie ma aktywnego API lub płatności. Wybierz klucz ponownie.");
    }
    throw new Error(error.message || "Błąd komunikacji z AI.");
  }
};
