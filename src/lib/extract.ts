/** Extraction du texte d'un fichier — texte brut ou PDF. */

/** Le PDF est chargé à la demande : ~1 Mo de pdf.js hors du bundle principal. */
async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Le worker vit à côté ; Vite en fait une URL servie statiquement.
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const ligne = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (ligne) pages.push(ligne)
  }
  await doc.destroy()
  return pages.join('\n\n')
}

/** Vrai pour un fichier dont on sait tirer du texte (PDF compris). */
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export async function extractText(file: File): Promise<string> {
  return isPdf(file) ? extractPdf(file) : file.text()
}
