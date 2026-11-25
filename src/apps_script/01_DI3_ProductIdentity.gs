/** Pure product normalization and stable identity functions. */
function di3NormalizeText_(value) {
  var text = String(value == null ? "" : value);
  if (typeof text.normalize === "function") text = text.normalize("NFKC");
  return text.trim().replace(/\s+/g, " ");
}

function di3NormalizeIdentityPart_(value) {
  return di3NormalizeText_(value).toLowerCase();
}

function di3IsDateLikeDiameter_(value, displayValue) {
  if (value instanceof Date && !isNaN(value.getTime())) return true;
  // A date accidentally entered into a numeric-formatted diameter cell can be
  // stored/displayed as a Google Sheets serial (for example, 46148). Such a
  // value is not a plausible diameter in this catalogue and must be corrected.
  var numericCandidates = [value, displayValue];
  for (var i = 0; i < numericCandidates.length; i++) {
    var candidate = numericCandidates[i];
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 30000 && candidate <= 80000) return true;
  }
  var text = di3NormalizeText_(displayValue !== undefined && displayValue !== null && displayValue !== ""
    ? displayValue : value);
  if (!text) return false;
  var serialText = text.replace(/\s+/g, "");
  if (/^\d{5}$/.test(serialText) && Number(serialText) >= 30000 && Number(serialText) <= 80000) return true;
  return (
    /\b(?:mon|tue|wed|thu|fri|sat|sun)\b.*\b\d{4}\b/i.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*\b\d{4}\b/i.test(text) ||
    /\b(?:янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\b.*\b\d{4}\b/i.test(text) ||
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\b|$)/.test(text) ||
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(text)
  );
}

/** Returns canonical diameter text and whether the source looked like a date. */
function di3NormalizeDiameter_(value, displayValue) {
  if (di3IsDateLikeDiameter_(value, displayValue)) {
    return { value: "", invalidDate: true };
  }
  var source = displayValue !== undefined && displayValue !== null && displayValue !== ""
    ? displayValue : value;
  var text = di3NormalizeText_(source);
  if (!text) return { value: "", invalidDate: false };
  var numericText = text.replace(/\s*мм\s*$/i, "").replace(/\s+/g, "").replace(/,/g, ".");
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numericText)) {
    var numeric = Number(numericText);
    if (Number.isFinite(numeric)) {
      return { value: String(Number(numeric.toFixed(4))), invalidDate: false };
    }
  }
  return { value: di3NormalizeIdentityPart_(text.replace(/\s*мм\s*$/i, "")), invalidDate: false };
}

function di3BuildIdentityKey_(brand, model, diameter) {
  var brandPart = di3NormalizeIdentityPart_(brand);
  var modelPart = di3NormalizeIdentityPart_(model);
  var diameterPart = di3NormalizeDiameter_(diameter, diameter).value;
  // Brand is mandatory. Model may be blank for collaboration / brand-only products.
  // An empty model remains an explicit part of identity and is not a wildcard.
  if (!brandPart) {
    throw new Error('Для идентификации товара обязателен бренд. Название модели может отсутствовать.');
  }
  return JSON.stringify([brandPart, modelPart, diameterPart]);
}

function di3CreateProductLabel_(brand, model, diameter) {
  var parts = [];
  var brandText = di3NormalizeText_(brand);
  var modelText = di3NormalizeText_(model);
  if (brandText) parts.push(brandText);
  if (modelText) parts.push(modelText);
  var base = parts.join(" ");
  var normalizedDiameter = di3NormalizeDiameter_(diameter, diameter);
  if (normalizedDiameter.invalidDate || !normalizedDiameter.value) return base;
  return base + ", " + String(normalizedDiameter.value).replace(".", ",") + " мм";
}

