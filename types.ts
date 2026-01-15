
export enum PiiCategory {
  NAME = 'NAME',
  SURNAME = 'SURNAME',
  PESEL = 'PESEL',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  ADDRESS = 'ADDRESS',
  OTHER = 'OTHER'
}

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface RedactionMark {
  id: string;
  category: PiiCategory;
  text: string;
  box: BoundingBox;
  pageNumber: number;
  confidence: number;
}

export interface PDFPageData {
  pageNumber: number;
  imageUrl: string;
  width: number;
  height: number;
}

export interface RedactionSettings {
  categories: PiiCategory[];
  customKeywords: string[];
}
