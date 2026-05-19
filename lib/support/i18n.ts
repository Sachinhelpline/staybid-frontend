// Locale-aware system messages for the support widget.
//
// The AI bot already auto-detects the user's language and replies in
// kind (see knowledge.ts system prompt). This helper only localizes the
// HARDCODED system messages (welcome, escalation ack, auto-resolve close).
//
// Detection priority:
//   1. Explicit `locale` arg (from navigator.language sent by widget)
//   2. Fallback: Hinglish (the default StayBid voice)
//
// Languages supported (system messages only — AI handles every language):
//   - hi / hinglish (default)
//   - en
//   - es
//   - fr
//   - ar
//
// Adding a new language: extend the STRINGS table below. Each key must
// map to all 5 message types or the lookup falls back to Hinglish.

export type LocaleKey = "hi" | "en" | "es" | "fr" | "ar";

type Messages = {
  welcomeAI: string;
  welcomeQueue: string;
  escalationAck: string;
  shortCircuitFinancial: string;
  shortCircuitUser: string;
  aiDisabledAck: string;
  aiFailureAck: string;
  autoResolved: string;
};

const STRINGS: Record<LocaleKey, Messages> = {
  hi: {
    welcomeAI:
      "👋 Aap StayBid Support se baat kar rahe hain. Booking, bid, payment — kuch bhi pucho. Agar human team chahiye, neeche \"Talk to human\" button hai.",
    welcomeQueue:
      "👋 Aap StayBid Support se baat kar rahe hain. Apna sawaal likhein — team kuch hi minutes mein reply karegi.",
    escalationAck:
      "Bilkul — human team se connect kar rahe hain. Kuch hi minutes mein wapas message aayega. 🤝",
    shortCircuitFinancial:
      "Yeh ek financial / specific request hai — team aapse turant baat karegi. 🤝",
    shortCircuitUser:
      "Bilkul — human team se connect kar rahe hain. Kuch hi minutes mein wapas message aayega. 🤝",
    aiDisabledAck:
      "Aapka message support team tak pahunch gaya hai. Hum jaldi reply karenge — usually 5-10 minutes.",
    aiFailureAck: "Ek minute — team aapse direct baat karegi.",
    autoResolved:
      "Yeh chat 48h se idle thi — automatically resolve kar diya hai. Agar koi naya issue ho, naya chat shuru kar dijiye. ✨",
  },
  en: {
    welcomeAI:
      "👋 You're connected to StayBid Support. Ask anything about bookings, bids, or payments. Need a human? Use the \"Talk to human\" button below.",
    welcomeQueue:
      "👋 You're connected to StayBid Support. Send your message — our team usually replies within a few minutes.",
    escalationAck:
      "Connecting you to a human agent now. They'll reply shortly. 🤝",
    shortCircuitFinancial:
      "This is a financial request — our team will reach out to you right away. 🤝",
    shortCircuitUser:
      "Connecting you to a human agent now. They'll reply shortly. 🤝",
    aiDisabledAck:
      "Your message has reached our support team. We typically reply within 5-10 minutes.",
    aiFailureAck: "One moment — a team member will respond directly.",
    autoResolved:
      "This chat was idle for 48 hours and has been auto-resolved. Start a new chat anytime you need help. ✨",
  },
  es: {
    welcomeAI:
      "👋 Estás conectado con Soporte StayBid. Pregunta sobre reservas, ofertas o pagos. Para un humano, usa el botón \"Hablar con humano\" más abajo.",
    welcomeQueue:
      "👋 Estás conectado con Soporte StayBid. Envía tu mensaje — el equipo responde en minutos.",
    escalationAck:
      "Te estamos conectando con un agente humano. Responderá en breve. 🤝",
    shortCircuitFinancial:
      "Esto es una solicitud financiera — el equipo te contactará de inmediato. 🤝",
    shortCircuitUser:
      "Te estamos conectando con un agente humano. Responderá en breve. 🤝",
    aiDisabledAck:
      "Tu mensaje ha llegado al equipo de soporte. Normalmente respondemos en 5-10 minutos.",
    aiFailureAck: "Un momento — un miembro del equipo responderá directamente.",
    autoResolved:
      "Este chat estuvo inactivo durante 48 horas y se cerró automáticamente. Inicia un nuevo chat cuando necesites ayuda. ✨",
  },
  fr: {
    welcomeAI:
      "👋 Vous êtes connecté au Support StayBid. Posez vos questions sur les réservations, enchères ou paiements. Pour un humain, utilisez le bouton \"Parler à un humain\" ci-dessous.",
    welcomeQueue:
      "👋 Vous êtes connecté au Support StayBid. Envoyez votre message — l'équipe répond en quelques minutes.",
    escalationAck:
      "Nous vous mettons en relation avec un agent humain. Il répondra sous peu. 🤝",
    shortCircuitFinancial:
      "Il s'agit d'une demande financière — l'équipe vous contactera immédiatement. 🤝",
    shortCircuitUser:
      "Nous vous mettons en relation avec un agent humain. Il répondra sous peu. 🤝",
    aiDisabledAck:
      "Votre message est arrivé à l'équipe de support. Nous répondons généralement sous 5-10 minutes.",
    aiFailureAck: "Un instant — un membre de l'équipe répondra directement.",
    autoResolved:
      "Cette conversation est restée inactive 48 heures et a été clôturée automatiquement. Démarrez une nouvelle conversation à tout moment. ✨",
  },
  ar: {
    welcomeAI:
      "👋 أنت متصل بدعم StayBid. اسأل عن الحجوزات أو العروض أو المدفوعات. للتحدث مع شخص، استخدم زر \"التحدث إلى إنسان\" أدناه.",
    welcomeQueue:
      "👋 أنت متصل بدعم StayBid. أرسل رسالتك — يرد الفريق عادة خلال دقائق.",
    escalationAck:
      "نقوم بتوصيلك بأحد الوكلاء البشريين. سيرد قريبًا. 🤝",
    shortCircuitFinancial:
      "هذا طلب مالي — سيتواصل معك الفريق فورًا. 🤝",
    shortCircuitUser:
      "نقوم بتوصيلك بأحد الوكلاء البشريين. سيرد قريبًا. 🤝",
    aiDisabledAck: "وصلت رسالتك إلى فريق الدعم. نرد عادة خلال 5-10 دقائق.",
    aiFailureAck: "لحظة — سيرد عضو من الفريق مباشرة.",
    autoResolved:
      "ظلت هذه المحادثة خاملة لمدة 48 ساعة وتم إغلاقها تلقائيًا. ابدأ محادثة جديدة في أي وقت تحتاج فيه إلى مساعدة. ✨",
  },
};

export function detectLocale(input: string | null | undefined): LocaleKey {
  if (!input) return "hi";
  const lower = input.toLowerCase();
  // navigator.language returns "en-US", "fr-FR", "ar-EG", "es-ES", "hi-IN"
  if (lower.startsWith("hi") || lower.includes("in")) return "hi";
  if (lower.startsWith("ar")) return "ar";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("en")) return "en";
  return "hi";
}

export function t(locale: LocaleKey | string | null | undefined): Messages {
  const key = typeof locale === "string" ? detectLocale(locale) : "hi";
  return STRINGS[key] || STRINGS.hi;
}
