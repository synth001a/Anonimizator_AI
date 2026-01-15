
import { GoogleGenAI, Type } from "@google/genai";
import { PiiCategory, BoundingBox } from "./types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

export interface DetectionResult {
  text: string;
  category: PiiCategory;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
}

export const detectPiiInImage = async (
  base64Image: string,
  targetCategories: PiiCategory[],
  customKeywords: string[]
): Promise<DetectionResult[]> => {
  const model = 'gemini-3-flash-preview';
  
  const categoryList = targetCategories.join(', ');
  const keywordsText = customKeywords.length > 0 
    ? ` Additionally, specifically look for these keywords: ${customKeywords.join(', ')}.`
    : '';

  const prompt = `Analyze this document image for Personal Identifiable Information (PII). 
  Identify the following categories: ${categoryList}.${keywordsText}
  
  For each detected PII, provide the exact text, the category, and a precise bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000.
  Ensure the bounding boxes strictly cover only the sensitive text.
  
  Return the results as a JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
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
                description: "[ymin, xmin, ymax, xmax] coordinates"
              }
            },
            required: ["text", "category", "box_2d"]
          }
        }
      },
    });

    const results = JSON.parse(response.text || '[]') as DetectionResult[];
    return results;
  } catch (error) {
    console.error("Gemini Detection Error:", error);
    return [];
  }
};
