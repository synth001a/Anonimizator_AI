import { GoogleGenAI, SchemaType } from "@google/generative-ai";
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
  const apiKey = process.env.API_KEY;

  if (!apiKey || apiKey === "UNDEFINED" || apiKey === "") {
    throw new Error("Klucz API Gemini nie jest skonfigurowany.");
  }

  // 1. Inicjalizacja klienta (Stabilne SDK)
  const genAI = new GoogleGenAI(apiKey);
  
  // 2. Wybór modelu (Używamy stabilnego 1.5 Flash lub 2.0 Flash Experimental)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash", // Zmiana z nieistniejącego gemini-3
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            text: { type: SchemaType.STRING },
            category: { type: SchemaType.STRING },
            box_2d: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
            }
          },
          required: ["text", "category", "box_2d"]
        }
      }
    }
  });

  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Dodatkowo oznacz te konkretne frazy: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Jesteś ekspertem ds. ochrony danych (RODO). Znajdź i oznacz dane osobowe na obrazku.
  Kategorie: ${categoryList}.${keywordsText}
  Zwróć wynik jako JSON (tablica obiektów z polami: text, category, box_2d: [ymin, xmin, ymax, xmax]).
  Współrzędne box_2d w skali 0-1000.`;

  // 3. Czyszczenie Base64 (usunięcie nagłówka data:image/..., jeśli istnieje)
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

  try {
    const result = await model.generateContent([
      { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
      { text: prompt }
    ]);

    // 4. Pobranie tekstu (w tym SDK to funkcja text())
    const resultText = result.response.text();
    
    if (!resultText) return [];

    try {
      const parsed = JSON.parse(resultText);
      
      return (Array.isArray(parsed) ? parsed : []).map((item: any) => ({
        text: String(item.text || ''),
        category: (item.category || 'OTHER') as PiiCategory,
        // Walidacja współrzędnych
        box_2d: Array.isArray(item.box_2d) && item.box_2d.length === 4 
          ? [Number(item.box_2d[0]), Number(item.box_2d[1]), Number(item.box_2d[2]), Number(item.box_2d[3])]
          : [0, 0, 0, 0]
      })) as DetectionResult[];

    } catch (e) {
      console.error("Błąd parsowania JSON z AI:", resultText);
      return [];
    }
  } catch (error: any) {
    console.error("Błąd Gemini:", error);
    if (error.message?.includes("API key")) {
      throw new Error("Klucz API jest nieprawidłowy.");
    }
    throw new Error("AI nie mogło przeanalizować strony: " + (error.message || "Błąd nieznany."));
  }
};
