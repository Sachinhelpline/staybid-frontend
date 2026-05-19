// Message-content-based language detection — script + word heuristic.
// Used to override the conversation's stored locale when the user's
// CURRENT message is clearly in a different language. The AI prompt
// then sees an EXPLICIT instruction to reply in that language.
//
// Goes beyond navigator.language because users often write in
// romanized Hindi (Hinglish) on English-default keyboards. Detecting
// "Mera refund kab tak aayega" as Hinglish-Latin (not English) is what
// makes AI reply naturally in Hinglish.

export type DetectedLang =
  | "hi"          // Devanagari script
  | "hi-roman"    // Romanized Hindi / Hinglish (Latin chars + Hindi words)
  | "en"          // English
  | "es"          // Spanish
  | "fr"          // French
  | "ar"          // Arabic
  | "unknown";

// Common Hinglish words written in Latin script. If 2+ of these
// appear, we treat the message as Hinglish, not English. Cast a wide
// net — false positives are safer than false negatives (Hinglish reply
// is readable to English speakers; English reply confuses Hindi
// speakers).
const HINGLISH_WORDS = new Set([
  "mera", "meri", "tera", "teri", "uska", "uski", "humara", "tumhara",
  "kya", "kyun", "kyon", "kab", "tak", "kahaan", "kaise", "kaisi", "kaiha", "kaihe",
  "hai", "hain", "tha", "thi", "the", "hoga", "hogi", "ho", "hua", "hui",
  "kar", "karo", "karna", "karne", "kiya", "kiye", "kr", "krna", "krne", "krke",
  "raha", "rahi", "rahe", "milega", "milegi", "milegw", "mile", "mili",
  "aayega", "aayegi", "aayenge", "ja", "jaa", "jaye", "jaayega", "jaayegi",
  "le", "lo", "liya", "liye", "de", "do", "diya", "diye",
  "samjha", "samjhi", "samjha", "samajh", "samjhao",
  "chahiye", "chahta", "chahti", "chaiye",
  "abhi", "abh", "ab", "tak", "phir", "fir",
  "nahi", "nhi", "naa", "na", "haan", "haa", "han", "yes",
  "tum", "tu", "aap", "main", "hum", "hume", "humein",
  "isko", "uska", "iska", "wala", "wali", "wale",
  "paisa", "paise", "rupaya", "rupaye", "lakin", "lekin",
  "booking", "kab", "kara", "kara", "krwana", "krana",
  "refund", "wapas", "vapas",
  "rha", "rhi", "rhe", "hua", "hui",
  "ek", "do", "tin", "char", "panch",
  "yaar", "bhai", "boss", "bhaiya",
  "achha", "accha", "thik", "theek", "okay",
]);

// Quick Spanish/French marker words (just sanity checks)
const SPANISH_WORDS = new Set([
  "que", "para", "por", "donde", "cuando", "como", "porque",
  "gracias", "hola", "buenos", "noches", "hoy", "mañana",
  "necesito", "quiero", "tengo", "estoy",
]);

const FRENCH_WORDS = new Set([
  "que", "pour", "pourquoi", "comment", "quand",
  "merci", "bonjour", "bonsoir", "aujourdhui",
  "je", "tu", "nous", "vous", "est", "sont",
]);

export function detectMessageLang(text: string): DetectedLang {
  if (!text || !text.trim()) return "unknown";

  // 1. Script-based detection (deterministic)
  // Devanagari range U+0900 - U+097F
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  // Arabic range U+0600 - U+06FF
  if (/[؀-ۿ]/.test(text)) return "ar";

  // 2. Word-based detection for Latin scripts
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "unknown";

  let hinglishHits = 0;
  let spanishHits = 0;
  let frenchHits = 0;

  for (const w of words) {
    if (HINGLISH_WORDS.has(w)) hinglishHits += 1;
    if (SPANISH_WORDS.has(w)) spanishHits += 1;
    if (FRENCH_WORDS.has(w)) frenchHits += 1;
  }

  // Lower threshold for short messages (1-3 words). User typing "kab
  // milega" should be Hinglish even though only 2 words match.
  const threshold = words.length <= 3 ? 1 : 2;

  if (hinglishHits >= threshold && hinglishHits >= spanishHits && hinglishHits >= frenchHits) {
    return "hi-roman";
  }
  if (spanishHits >= threshold && spanishHits > frenchHits) return "es";
  if (frenchHits >= threshold) return "fr";

  return "en";
}

// Human-readable instruction the AI prompt can use to know which
// language to reply in.
export function langInstructionForAI(lang: DetectedLang): string {
  switch (lang) {
    case "hi":
      return "The user wrote in Hindi (Devanagari script). YOU MUST reply in Hindi using Devanagari script. Example: \"आपका रिफंड 5-7 दिनों में वापस आ जाएगा।\"";
    case "hi-roman":
      return "The user wrote in romanized Hindi / Hinglish (Hindi words in Latin script). YOU MUST reply in romanized Hindi / Hinglish using Latin characters. Example: \"Aapka refund 5-7 din mein wapas aayega. Booking ID share kijiye taki team check kar paaye.\"";
    case "ar":
      return "The user wrote in Arabic. YOU MUST reply in Arabic.";
    case "es":
      return "The user wrote in Spanish. YOU MUST reply in Spanish.";
    case "fr":
      return "The user wrote in French. YOU MUST reply in French.";
    case "en":
    default:
      return "The user wrote in English. Reply in English.";
  }
}
