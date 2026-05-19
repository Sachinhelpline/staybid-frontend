// Intent-based fallback bot. Runs when ANTHROPIC_API_KEY is not set
// (or when the real Claude call fails). Handles the common 30-50% of
// queries with canned-but-helpful responses in 5 languages.
//
// Design:
//   1. Lowercase the message
//   2. Match against intent patterns (regex, case-insensitive)
//   3. Return localized canned response + a confidence score
//   4. If no intent matches with high confidence → escalate
//
// This is NOT a replacement for real Claude — it's a graceful fallback
// so the system is functional even without an API key. Sachin should
// still set ANTHROPIC_API_KEY for full coverage.

import type { LocaleKey } from "./i18n";

type IntentKey =
  | "greeting"
  | "thanks"
  | "bid_help"
  | "booking_status"
  | "wallet"
  | "flash_deal"
  | "stay_points"
  | "hotel_info"
  | "counter_offer"
  | "checkin_checkout"
  | "cancel_booking"
  | "refund"
  | "payment_debit"   // v156 — added but forgot to update union → v157 build failed
  | "tech_issue"
  | "login_issue"
  | "general_help";

type Intent = {
  key: IntentKey;
  patterns: RegExp[];
  confidence: number;
  escalate: boolean;
  responses: Record<LocaleKey, string>;
};

const INTENTS: Intent[] = [
  // ── Greetings ─────────────────────────────────────────────
  {
    key: "greeting",
    patterns: [
      /\b(hi|hello|hey|hola|salut|namaste|hii+|helo)\b/i,
      /^(good\s)?(morning|afternoon|evening|night)\b/i,
      /\b(kaise\s?ho|kya\s?haal|hii)\b/i,
    ],
    confidence: 0.92,
    escalate: false,
    responses: {
      hi: "Namaste! 👋 Aap StayBid Support se baat kar rahe hain. Booking, bid, payment ya kuch bhi pucho — main madad ke liye yahan hoon.",
      en: "Hello! 👋 You're connected to StayBid Support. Ask anything about bookings, bids, or payments — I'm here to help.",
      es: "¡Hola! 👋 Estás conectado con Soporte StayBid. Pregunta sobre reservas, ofertas o pagos.",
      fr: "Bonjour ! 👋 Vous êtes connecté au Support StayBid. Posez vos questions.",
      ar: "مرحبًا! 👋 أنت متصل بدعم StayBid. اسأل عن أي شيء.",
    },
  },

  // ── Thanks ───────────────────────────────────────────────
  {
    key: "thanks",
    patterns: [
      /\b(thanks?|thank\s?you|thx|ty|shukriya|dhanyavad|gracias|merci|شكرا)\b/i,
    ],
    confidence: 0.9,
    escalate: false,
    responses: {
      hi: "Khushi se! ✨ Aur kuch chahiye toh batayein.",
      en: "Happy to help! ✨ Let me know if you need anything else.",
      es: "¡Con gusto! ✨ Avísame si necesitas algo más.",
      fr: "Avec plaisir ! ✨ Dites-moi si vous avez besoin d'autre chose.",
      ar: "بكل سرور! ✨ أخبرني إذا احتجت أي شيء آخر.",
    },
  },

  // ── How to bid / negotiate ───────────────────────────────
  {
    key: "bid_help",
    patterns: [
      /\b(bid|bidding|negotiat|offer|price|deal|bargain)\b/i,
      /\b(boli|kaise\s?lagaye|kaise\s?karein|kitne\s?mein)\b/i,
      /\b(how\s?to\s?(bid|negotiate))\b/i,
      /\b(reverse\s?auction)\b/i,
    ],
    confidence: 0.78,
    escalate: false,
    responses: {
      hi: "Bid lagane ke liye:\n1. Hotel page kholo (/hotels mein search karo)\n2. 'Negotiate' button dabao\n3. Apni price slide karke set karo\n4. AI button par instant confirm milta hai\n\nFloor price se neeche bid bhi bhej sakte ho — hotel partner counter offer dene lagega.",
      en: "To place a bid:\n1. Open a hotel page (search at /hotels)\n2. Tap 'Negotiate'\n3. Slide to your preferred price\n4. Above-floor bids auto-confirm; below-floor goes to hotel for counter\n\nYou can also 'Hold for 24h' to lock the price while you decide.",
      es: "Para hacer una oferta:\n1. Abre una página de hotel\n2. Toca 'Negotiate'\n3. Desliza al precio deseado\n4. Las ofertas por encima del precio mínimo se confirman al instante.",
      fr: "Pour faire une offre:\n1. Ouvrez une page d'hôtel\n2. Touchez 'Negotiate'\n3. Glissez vers votre prix\n4. Les offres au-dessus du minimum se confirment automatiquement.",
      ar: "لتقديم عرض:\n١. افتح صفحة فندق\n٢. اضغط 'Negotiate'\n٣. اسحب إلى السعر المطلوب",
    },
  },

  // ── v156 NEW: payment debit/failed — catches Hinglish "paisa kat gaya"
  {
    key: "payment_debit",
    patterns: [
      /\b(payment\s?(debit|deducted|cut|gone|stuck|failed|fail|issue|problem|nahi|nhi))\b/i,
      /\b(paisa\s?(kat|kata|gaya|cut|deduct))\b/i,
      /\b(amount\s?(deducted|debited|cut|kat|gaya))\b/i,
      /\b(razorpay|upi|debit\s?card|credit\s?card)\s?(failed|issue|problem|nahi|nhi)\b/i,
      /\b(transaction\s?(failed|fail|pending|stuck))\b/i,
      /\b(book\s?nahi|book\s?nhi|booking\s?confirm\s?nahi|booking\s?confirm\s?nhi)\b/i,
      /\b(money\s?(deducted|cut|gone))\b/i,
    ],
    confidence: 0.85,
    escalate: true,
    responses: {
      hi: "Yeh financial issue hai — paisa cut hua hai but booking confirm nahi mili. Turant team se connect kar raha hoon. Booking ID ya transaction ID (Razorpay payment ID like pay_xxx) share kijiye taki team 5 min mein resolve kar de. Agar refund chahiye toh 5-7 working days mein paisa wapas wallet/card mein aa jaata hai.",
      en: "Payment issue — money was deducted but booking didn't confirm. Connecting you to our team RIGHT NOW. Please share the transaction ID (pay_xxx from Razorpay receipt) OR booking ID so we can resolve in 5 min. Refunds typically take 5-7 business days to land back.",
      es: "Problema de pago — dinero deducido pero reserva no confirmada. Te conecto con el equipo. Comparte el ID de transacción (pay_xxx).",
      fr: "Problème de paiement — argent débité mais réservation non confirmée. Je vous connecte à l'équipe. Partagez l'ID (pay_xxx).",
      ar: "مشكلة دفع — تم خصم المال لكن الحجز لم يتأكد. أربطك بالفريق. شارك معرف المعاملة (pay_xxx).",
    },
  },

  // ── Booking status ───────────────────────────────────────
  {
    key: "booking_status",
    patterns: [
      /\b(booking\s?(status|details|confirm|confirmation|id)|my\s?booking|reservation)\b/i,
      /\b(booking\s?(kahan|kab|confirm|mili|milega|milegi|milegw))\b/i,
      /\b(status\s?(of\s?my)?\s?(booking|stay))\b/i,
      /\b(reservation\s?(kab|confirm|mili|status))\b/i,
    ],
    confidence: 0.82,
    escalate: false,
    responses: {
      hi: "Aapki saari bookings /bookings page par milengi — confirmed, upcoming, past sab dikhega. Specific booking ke baare mein details chahiye toh booking ID share kijiye (BK_xxxx).",
      en: "All your bookings live on /bookings — confirmed, upcoming, and past. For details on a specific booking, share the booking ID (BK_xxxx) and I can dig in.",
      es: "Todas tus reservas están en /bookings. Comparte el ID de reserva (BK_xxxx) para más detalles.",
      fr: "Toutes vos réservations sont sur /bookings. Partagez l'ID (BK_xxxx) pour plus de détails.",
      ar: "جميع حجوزاتك على /bookings. شارك رقم الحجز (BK_xxxx) للتفاصيل.",
    },
  },

  // ── Wallet ───────────────────────────────────────────────
  {
    key: "wallet",
    patterns: [
      /\b(wallet|balance|credit|funds?|paisa|paise|amount)\b/i,
      /\b(stay\s?credit|wallet\s?credit)\b/i,
    ],
    confidence: 0.85,
    escalate: false,
    responses: {
      hi: "Wallet balance dekhne ke liye /wallet par jaiye. Saare credits, debits, aur StayCredit transactions wahaan dikhenge. Refunds bhi 5-7 din mein wallet mein wapas aate hain.",
      en: "Your wallet lives at /wallet — you'll see all credits, debits, and StayCredit transactions there. Refunds typically take 5-7 business days to land back.",
      es: "Tu billetera está en /wallet. Los reembolsos tardan 5-7 días.",
      fr: "Votre portefeuille est à /wallet. Les remboursements prennent 5-7 jours.",
      ar: "محفظتك على /wallet. تستغرق الاستردادات ٥-٧ أيام.",
    },
  },

  // ── Flash deals ──────────────────────────────────────────
  {
    key: "flash_deal",
    patterns: [
      /\b(flash\s?deal|flash\s?sale|hot\s?deal|today\s?deal|discount|offer)\b/i,
      /\b(sasta|sasti|kam\s?mein|cheap)\b/i,
    ],
    confidence: 0.8,
    escalate: false,
    responses: {
      hi: "Aaj ke flash deals /flash-deals par live hain — 25% se 60% tak discount available hai. Timer running hota hai, jaldi book karna padega. ⚡",
      en: "Live flash deals are at /flash-deals — discounts run from 25% to 60% off. They're time-limited, so book fast. ⚡",
      es: "Las ofertas flash están en /flash-deals — 25%-60% de descuento. ⚡",
      fr: "Les offres flash sont sur /flash-deals — 25-60% de réduction. ⚡",
      ar: "العروض السريعة على /flash-deals — خصم ٢٥-٦٠٪. ⚡",
    },
  },

  // ── StayPoints ───────────────────────────────────────────
  {
    key: "stay_points",
    patterns: [
      /\b(stay\s?points?|points?|loyalty|reward)\b/i,
      /\b(point\s?kaise|points?\s?milega)\b/i,
    ],
    confidence: 0.82,
    escalate: false,
    responses: {
      hi: "StayPoints earn karne ke 3 tareeke:\n• Har ₹100 spend par 5 points\n• Reviews likhne par bonus\n• Referral codes share karne par\n\nPoints /points par dikhte hain. Redeem karne ke liye /points/redeem — coupons, wallet credit, hotel amenities sab milte hain.",
      en: "Earn StayPoints 3 ways:\n• 5 points per ₹100 spent\n• Bonus points for reviews\n• Refer friends with your code\n\nSee balance at /points. Redeem at /points/redeem for coupons, wallet credit, or hotel perks.",
      es: "Gana StayPoints: 5 por ₹100 gastados. Ver en /points, canjear en /points/redeem.",
      fr: "Gagnez des StayPoints : 5 par ₹100 dépensés. Voir sur /points, échanger sur /points/redeem.",
      ar: "اكسب StayPoints: ٥ مقابل كل ١٠٠ روبية. شاهد على /points.",
    },
  },

  // ── Counter offer ────────────────────────────────────────
  {
    key: "counter_offer",
    patterns: [
      /\b(counter|counter\s?offer|counter\s?bid)\b/i,
      /\b(hotel\s?ne\s?counter|hotel\s?has\s?countered)\b/i,
    ],
    confidence: 0.85,
    escalate: false,
    responses: {
      hi: "Hotel ne counter offer diya hai toh /my-bids par jaake accept ya reject kar sakte ho. Counter usually 5-15% upar hotel deta hai. Accept karne ke baad 15 min ka window milega payment ke liye.",
      en: "If a hotel sent a counter offer, head to /my-bids to accept or reject. Counters are typically 5-15% above your bid. After accepting, you have a 15-minute window to pay.",
      es: "Para contraofertas, ve a /my-bids. Tienes 15 min para pagar tras aceptar.",
      fr: "Pour les contre-offres, allez sur /my-bids. 15 min pour payer après acceptation.",
      ar: "للعروض المضادة، انتقل إلى /my-bids. لديك ١٥ دقيقة للدفع بعد القبول.",
    },
  },

  // ── Check-in / Check-out ─────────────────────────────────
  {
    key: "checkin_checkout",
    patterns: [
      /\b(check\s?in|check\s?out|early\s?check|late\s?check)\b/i,
      /\b(arrive|arriving|departure)\b/i,
      /\b(jaldi\s?aana|der\s?se)\b/i,
    ],
    confidence: 0.75,
    escalate: true, // Hotel-specific, agent should coordinate
    responses: {
      hi: "Early check-in ya late check-out ke liye hotel ko direct request karein. /bookings par jaake hotel chat kholo — main aapko ek agent se connect kar raha hoon jo arrangement karwa de.",
      en: "Early check-in / late check-out depends on the hotel's availability. Open /bookings → tap your booking → message the hotel. I'll connect you to an agent who can coordinate.",
      es: "Para check-in temprano / check-out tarde, abre /bookings y mensajea al hotel. Te conecto con un agente.",
      fr: "Pour un check-in tôt / check-out tard, ouvrez /bookings et contactez l'hôtel. Je vous connecte à un agent.",
      ar: "لتسجيل الوصول المبكر/المغادرة المتأخرة، افتح /bookings. أربطك بوكيل.",
    },
  },

  // ── Cancel booking — ALWAYS escalate ─────────────────────
  {
    key: "cancel_booking",
    patterns: [
      /\b(cancel|cancellation|cancell?ation)\b/i,
      /\b(booking\s?cancel|cancel\s?karna)\b/i,
    ],
    confidence: 0.88,
    escalate: true,
    responses: {
      hi: "Booking cancellation ke liye humein hotel partner se confirm karna padega. Aapki booking ID share kijiye — main aapko ek team member se connect kar raha hoon jo within 30 min update denge.",
      en: "Cancellations need hotel-partner confirmation. Share your booking ID and I'll connect you to a team member who'll update you within 30 minutes.",
      es: "Las cancelaciones requieren confirmación. Comparte el ID y te conecto con un agente.",
      fr: "Les annulations nécessitent une confirmation. Partagez l'ID, un agent vous contactera.",
      ar: "تتطلب الإلغاءات تأكيدًا. شارك رقم الحجز وسأربطك بوكيل.",
    },
  },

  // ── Refund — ALWAYS escalate ─────────────────────────────
  {
    key: "refund",
    patterns: [
      /\b(refund|chargeback|money\s?back|wapas|paise\s?wapas)\b/i,
    ],
    confidence: 0.95,
    escalate: true,
    responses: {
      hi: "Refund request ke liye main aapko turant ek team member se connect kar raha hoon. Razorpay refund 5-7 business days mein process hota hai, aur SMS + email confirmation aata hai.",
      en: "Refunds require team review. I'm connecting you to a team member now. Razorpay refunds typically take 5-7 business days, with SMS + email confirmation when they complete.",
      es: "Los reembolsos requieren revisión. Te conecto con un agente. Tardan 5-7 días.",
      fr: "Les remboursements nécessitent une revue. Je vous connecte à un agent. 5-7 jours.",
      ar: "تتطلب الاستردادات مراجعة. أربطك بوكيل. تستغرق ٥-٧ أيام.",
    },
  },

  // ── Tech / app issue — escalate ──────────────────────────
  {
    key: "tech_issue",
    patterns: [
      /\b(bug|crash|broken|not\s?working|error|stuck|loading|fail)\b/i,
      /\b(app\s?(slow|hang|crash)|website\s?down)\b/i,
      /\b(chal\s?nahi|kaam\s?nahi)\b/i,
    ],
    confidence: 0.75,
    escalate: true,
    responses: {
      hi: "Lagta hai aapko technical issue aa rahi hai. Main ek tech-support agent se connect kar raha hoon. Tab tak ek baar app refresh karke try kar lijiye — kabhi cache issue hota hai.",
      en: "Sounds like a technical hiccup. I'm connecting you to a tech-support agent. Meanwhile, try a hard refresh (Ctrl+Shift+R or close + reopen the app) — sometimes cached files cause this.",
      es: "Parece un problema técnico. Te conecto con un agente. Mientras, intenta un refresco completo.",
      fr: "Problème technique. Je vous connecte à un agent. Essayez un rafraîchissement complet.",
      ar: "مشكلة تقنية. أربطك بوكيل. حاول تحديثًا كاملًا.",
    },
  },

  // ── Login issue — escalate ───────────────────────────────
  {
    key: "login_issue",
    patterns: [
      /\b(login|sign\s?in|otp|password|reset|locked\s?out|can't\s?log)\b/i,
      /\b(account\s?(blocked|locked))\b/i,
    ],
    confidence: 0.85,
    escalate: true,
    responses: {
      hi: "Login mein dikkat aa rahi hai? Main ek team member se connect kar raha hoon. Tab tak check kijiye OTP WhatsApp pe aaya hai ya nahi (sometimes SMS pe bhi aata hai).",
      en: "Login trouble? I'm connecting you to a team member. Meanwhile, check WhatsApp for the OTP (sometimes it arrives via SMS instead).",
      es: "¿Problema de inicio? Te conecto con un agente. Revisa WhatsApp para el OTP.",
      fr: "Problème de connexion ? Je vous connecte à un agent. Vérifiez WhatsApp.",
      ar: "مشكلة تسجيل الدخول؟ أربطك بوكيل. تحقق من WhatsApp للرمز.",
    },
  },

  // ── Hotel info ──────────────────────────────────────────
  {
    key: "hotel_info",
    patterns: [
      /\b(hotel\s?(info|details|amenities|review|rating|photo|gallery))\b/i,
      /\b(room\s?(info|type|amenities|photo))\b/i,
    ],
    confidence: 0.7,
    escalate: false,
    responses: {
      hi: "Hotel ke baare mein puri info uske page par milegi — photos, reviews, amenities, room types, sab kuch. Hotel ka naam share kijiye, main aapko link bhej deta hoon ya khud /hotels par search kijiye.",
      en: "Full hotel info — photos, reviews, amenities, room types — lives on the hotel's page. Share the hotel name and I'll point you to it, or search at /hotels.",
      es: "La info del hotel está en su página. Comparte el nombre o busca en /hotels.",
      fr: "Toutes les infos sur la page de l'hôtel. Partagez le nom ou cherchez sur /hotels.",
      ar: "معلومات الفندق على صفحته. شارك الاسم أو ابحث في /hotels.",
    },
  },
];

export type FallbackResult = {
  matched: boolean;
  intent: IntentKey | "unknown";
  reply: string;
  confidence: number;
  shouldEscalate: boolean;
};

export function fallbackBotReply(message: string, locale: LocaleKey = "hi"): FallbackResult {
  const text = (message || "").toLowerCase().trim();
  if (!text) {
    return {
      matched: false,
      intent: "unknown",
      reply: "",
      confidence: 0,
      shouldEscalate: false,
    };
  }

  // Find best matching intent
  let best: { intent: Intent; matchScore: number } | null = null;
  for (const intent of INTENTS) {
    let hits = 0;
    for (const pat of intent.patterns) {
      if (pat.test(text)) hits += 1;
    }
    if (hits > 0) {
      const score = intent.confidence + Math.min(hits - 1, 2) * 0.02;
      if (!best || score > best.matchScore) {
        best = { intent, matchScore: score };
      }
    }
  }

  if (!best) {
    return {
      matched: false,
      intent: "unknown",
      reply: "",
      confidence: 0.3,
      shouldEscalate: true, // unknown intent → human
    };
  }

  const reply = best.intent.responses[locale] || best.intent.responses.hi;
  return {
    matched: true,
    intent: best.intent.key,
    reply,
    confidence: best.matchScore,
    shouldEscalate: best.intent.escalate,
  };
}
