const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const pdfFiles = [
  { id: "pallet", file: "pdfs/pallet.pdf" },
  { id: "endcap", file: "pdfs/endcap.pdf" },
];

function normalizeUpc(raw) {
  return raw.replace(/^0+/, "");
}

function extractDimensionsFromText(text) {
  const lines = text.split(/\r?\n/);
  const dimensions = {};
  const conflicts = [];

  for (const line of lines) {
    if (!line.includes(" in")) continue;

    const upcMatch = line.match(/\b\d{11,14}\b/);
    if (!upcMatch) continue;

    const sizeMatches = [...line.matchAll(/(\d+(?:\.\d+)?)\s+in\b/g)];
    if (sizeMatches.length < 2) continue;

    const upc = normalizeUpc(upcMatch[0]);
    const heightIn = parseFloat(sizeMatches[sizeMatches.length - 2][1]);
    const widthIn = parseFloat(sizeMatches[sizeMatches.length - 1][1]);

    if (Number.isNaN(heightIn) || Number.isNaN(widthIn)) continue;

    if (dimensions[upc]) {
      const existing = dimensions[upc];
      if (
        Math.abs(existing.heightIn - heightIn) > 0.01 ||
        Math.abs(existing.widthIn - widthIn) > 0.01
      ) {
        conflicts.push({ upc, existing, next: { heightIn, widthIn }, line });
      }
      continue;
    }

    dimensions[upc] = { heightIn, widthIn };
  }

  return { dimensions, conflicts };
}

function extractRemovedProducts(text) {
  const lines = text.split(/\r?\n/);
  const removed = {};
  let inRemoved = false;

  for (const line of lines) {
    if (line.includes("Products Removed From Planogram")) {
      inRemoved = true;
      continue;
    }

    if (inRemoved) {
      if (
        line.includes("Products Added") ||
        line.includes("Products Changed") ||
        line.startsWith("Page:") ||
        line.startsWith("--")
      ) {
        inRemoved = false;
        continue;
      }

      if (!line.trim() || line.startsWith("UPC Product")) continue;

      const match = line.match(/^\s*\d+\s+(\d{11,14})\s+(.+)$/);
      if (!match) continue;

      const upc = normalizeUpc(match[1]);
      const name = match[2].trim();
      if (!removed[upc]) {
        removed[upc] = { upc, name };
      }
    }
  }

  return Object.values(removed);
}

async function run() {
  const combined = {};
  const removedByPlanogram = {};
  const allConflicts = [];

  for (const pdf of pdfFiles) {
    const filePath = path.resolve(__dirname, "..", pdf.file);
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse(new Uint8Array(buffer));
    const parsed = await parser.getText();
    const text = parsed.text || parsed;
    const { dimensions, conflicts } = extractDimensionsFromText(text);
    const removedProducts = extractRemovedProducts(text);

    Object.assign(combined, dimensions);
    removedByPlanogram[pdf.id] = removedProducts;
    allConflicts.push(...conflicts);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    dimensions: combined,
  };

  const outPath = path.resolve(__dirname, "..", "data", "dimensions.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const removedPath = path.resolve(__dirname, "..", "data", "removed-products.json");
  fs.writeFileSync(removedPath, JSON.stringify(removedByPlanogram, null, 2));

  if (allConflicts.length) {
    console.warn(`Dimension conflicts found: ${allConflicts.length}`);
  }
  console.log(`Saved ${Object.keys(combined).length} dimensions to ${outPath}`);
  console.log(`Saved removed items to ${removedPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
