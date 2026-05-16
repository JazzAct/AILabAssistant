/**
 * Simple keyword-based datasheet search.
 * In production, you'd chunk the PDF and use embeddings.
 * For the hackathon, this extracts relevant paragraphs by keyword proximity.
 */
export function searchDatasheet(query, datasheetText) {
  if (!datasheetText) return 'No datasheet provided.';

  const keywords = query.toLowerCase().split(/\s+/);
  const paragraphs = datasheetText.split(/\n{2,}/);

  const scored = paragraphs.map((para) => {
    const lower = para.toLowerCase();
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    return { para, score };
  });

  const relevant = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ para }) => para.trim());

  if (relevant.length === 0) {
    return `No relevant sections found for query: "${query}"`;
  }

  return relevant.join('\n\n---\n\n');
}
