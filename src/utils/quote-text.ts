export const normalizeQuoteText = (text: string): string => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
