export interface PdfReadSection {
  heading: string;
  text: string;
}

export interface PdfReadResult {
  filePath: string;
  text: string;
  sections: PdfReadSection[];
}

export function buildPdfReadResult(input: PdfReadResult): PdfReadResult {
  return input;
}