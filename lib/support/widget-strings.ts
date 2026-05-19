// Customer-side widget UI strings, localized.
//
// Server-side messages (welcome, escalation ack, fallback bot replies)
// already use lib/support/i18n.ts. THIS file covers the CLIENT widget
// labels that were hardcoded Hinglish — buttons, placeholders, status
// banners, time strings, subject picker copy.
//
// v150 — added to fix user feedback that "Naya chat shuru karein" and
// "Apna sawaal likhein" stayed Hinglish despite EN language pick.

export type LangKey = "hi" | "en" | "es" | "fr" | "ar";

export type WidgetStrings = {
  // Header
  brandName: string;
  brandSubtitle: string;       // "We're here to help 24/7"
  liveChat: string;            // chat view subtitle

  // List view
  newChatBtn: string;          // "💬 Start a new chat"
  anonNote: string;            // sign-in hint when not signed in
  pastChats: string;           // "Past chats"
  emptyTitle: string;          // when no past chats
  emptySub: string;            // sub-text

  // Subject picker
  subjectTitle: string;        // "What's your question about?"
  subjectSub: string;          // hint
  subjectBack: string;         // back button

  // Chat view banners
  statusAI: string;            // "StayBid Assistant is helping you"
  statusEscalated: string;     // "Forwarded to our team — reply soon"
  statusAgent: (name: string) => string; // "{name} is live"
  statusClosed: string;        // "This conversation is closed"
  talkToHuman: string;         // "Talk to human" button

  // Composer
  placeholderActive: string;   // "Type your message..."
  placeholderAgent: (name: string) => string;
  placeholderLocked: string;
  markResolved: string;        // "Mark as resolved"

  // Time strings (very short, used everywhere)
  justNow: string;
  minAgo: (m: number) => string;
  hourAgo: (h: number) => string;
  dayAgo: (d: number) => string;

  // Status pill labels
  statusPillAI: string;
  statusPillQueued: string;
  statusPillLive: string;
  statusPillResolved: string;
  statusPillClosed: string;
};

const EN: WidgetStrings = {
  brandName: "StayBid Support",
  brandSubtitle: "We're here to help 24/7",
  liveChat: "Live chat",

  newChatBtn: "💬 Start a new chat",
  anonNote:
    "Sign in to instantly pull your bookings + bids into the chat — faster resolution.",
  pastChats: "Past chats",
  emptyTitle: "No past conversations yet.",
  emptySub: "Bookings, bids, payments — ask anything.",

  subjectTitle: "What's your question about?",
  subjectSub: "Pick a category — helps us connect you to the right person faster.",
  subjectBack: "← Back",

  statusAI: "StayBid Assistant is helping you",
  statusEscalated: "Forwarded to our team — a human will reply shortly",
  statusAgent: (name: string) => `${name} is live`,
  statusClosed: "This conversation is closed",
  talkToHuman: "Talk to human",

  placeholderActive: "Type your message…",
  placeholderAgent: (name: string) => `Reply to ${name}…`,
  placeholderLocked: "This chat is closed",
  markResolved: "Mark as resolved",

  justNow: "just now",
  minAgo: (m: number) => `${m} min ago`,
  hourAgo: (h: number) => `${h}h ago`,
  dayAgo: (d: number) => `${d}d ago`,

  statusPillAI: "AI",
  statusPillQueued: "Queued",
  statusPillLive: "Live",
  statusPillResolved: "Resolved",
  statusPillClosed: "Closed",
};

const HI: WidgetStrings = {
  brandName: "StayBid Support",
  brandSubtitle: "Hum madad ke liye yahaan hain",
  liveChat: "Live chat",

  newChatBtn: "💬 Naya chat shuru karein",
  anonNote:
    "Sign-in karne se aapki bookings + bids automatically aa jaati hain — fast resolution milti hai.",
  pastChats: "Past chats",
  emptyTitle: "Koi past conversation nahi.",
  emptySub: "Booking, bid, payment — kuch bhi pucho.",

  subjectTitle: "Aapka sawaal kis baare mein hai?",
  subjectSub: "Category select kijiye — hum sahi person se connect kar denge.",
  subjectBack: "← Wapas",

  statusAI: "StayBid Assistant aapki madad kar raha hai",
  statusEscalated: "Team ko forward kar diya hai — soon reply aayega",
  statusAgent: (name: string) => `${name} live hai`,
  statusClosed: "Yeh conversation band ho gaya hai",
  talkToHuman: "Talk to human",

  placeholderActive: "Apna sawaal likhein…",
  placeholderAgent: (name: string) => `${name} ko likhein…`,
  placeholderLocked: "Yeh chat band ho gaya hai",
  markResolved: "Mark as resolved",

  justNow: "abhi",
  minAgo: (m: number) => `${m} min ago`,
  hourAgo: (h: number) => `${h} h ago`,
  dayAgo: (d: number) => `${d} d ago`,

  statusPillAI: "AI",
  statusPillQueued: "Queued",
  statusPillLive: "Live",
  statusPillResolved: "Resolved",
  statusPillClosed: "Closed",
};

const ES: WidgetStrings = {
  brandName: "StayBid Support",
  brandSubtitle: "Estamos aquí para ayudar 24/7",
  liveChat: "Chat en vivo",
  newChatBtn: "💬 Iniciar un nuevo chat",
  anonNote: "Inicia sesión para incluir tus reservas y ofertas — resolución más rápida.",
  pastChats: "Chats anteriores",
  emptyTitle: "Aún no hay conversaciones.",
  emptySub: "Reservas, ofertas, pagos — pregunta lo que sea.",
  subjectTitle: "¿Sobre qué es tu pregunta?",
  subjectSub: "Elige una categoría — te conectaremos con la persona adecuada.",
  subjectBack: "← Atrás",
  statusAI: "StayBid Assistant te está ayudando",
  statusEscalated: "Enviado al equipo — un humano responderá pronto",
  statusAgent: (name: string) => `${name} está en vivo`,
  statusClosed: "Esta conversación está cerrada",
  talkToHuman: "Hablar con humano",
  placeholderActive: "Escribe tu mensaje…",
  placeholderAgent: (name: string) => `Responder a ${name}…`,
  placeholderLocked: "Este chat está cerrado",
  markResolved: "Marcar como resuelto",
  justNow: "ahora",
  minAgo: (m: number) => `hace ${m} min`,
  hourAgo: (h: number) => `hace ${h}h`,
  dayAgo: (d: number) => `hace ${d}d`,
  statusPillAI: "IA",
  statusPillQueued: "En cola",
  statusPillLive: "Vivo",
  statusPillResolved: "Resuelto",
  statusPillClosed: "Cerrado",
};

const FR: WidgetStrings = {
  brandName: "StayBid Support",
  brandSubtitle: "Nous sommes là pour vous aider 24/7",
  liveChat: "Chat en direct",
  newChatBtn: "💬 Démarrer un nouveau chat",
  anonNote: "Connectez-vous pour inclure vos réservations + offres — résolution plus rapide.",
  pastChats: "Anciens chats",
  emptyTitle: "Aucune conversation précédente.",
  emptySub: "Réservations, offres, paiements — demandez tout.",
  subjectTitle: "À quel sujet votre question ?",
  subjectSub: "Choisissez une catégorie — nous vous connectons à la bonne personne.",
  subjectBack: "← Retour",
  statusAI: "StayBid Assistant vous aide",
  statusEscalated: "Transmis à l'équipe — un humain répondra bientôt",
  statusAgent: (name: string) => `${name} est en direct`,
  statusClosed: "Cette conversation est fermée",
  talkToHuman: "Parler à un humain",
  placeholderActive: "Tapez votre message…",
  placeholderAgent: (name: string) => `Répondre à ${name}…`,
  placeholderLocked: "Ce chat est fermé",
  markResolved: "Marquer comme résolu",
  justNow: "à l'instant",
  minAgo: (m: number) => `il y a ${m} min`,
  hourAgo: (h: number) => `il y a ${h}h`,
  dayAgo: (d: number) => `il y a ${d}j`,
  statusPillAI: "IA",
  statusPillQueued: "En file",
  statusPillLive: "En direct",
  statusPillResolved: "Résolu",
  statusPillClosed: "Fermé",
};

const AR: WidgetStrings = {
  brandName: "دعم StayBid",
  brandSubtitle: "نحن هنا للمساعدة على مدار الساعة",
  liveChat: "دردشة مباشرة",
  newChatBtn: "💬 ابدأ محادثة جديدة",
  anonNote: "سجّل الدخول لاستيراد حجوزاتك وعروضك — حلّ أسرع.",
  pastChats: "المحادثات السابقة",
  emptyTitle: "لا توجد محادثات سابقة.",
  emptySub: "حجوزات، عروض، مدفوعات — اسأل أي شيء.",
  subjectTitle: "عن ماذا سؤالك؟",
  subjectSub: "اختر فئة — سنوصلك بالشخص المناسب.",
  subjectBack: "← رجوع",
  statusAI: "مساعد StayBid يساعدك",
  statusEscalated: "تم إرسالها للفريق — سيرد إنسان قريبًا",
  statusAgent: (name: string) => `${name} متصل`,
  statusClosed: "هذه المحادثة مغلقة",
  talkToHuman: "التحدث إلى إنسان",
  placeholderActive: "اكتب رسالتك…",
  placeholderAgent: (name: string) => `الرد على ${name}…`,
  placeholderLocked: "هذه الدردشة مغلقة",
  markResolved: "تحديد كمحلول",
  justNow: "الآن",
  minAgo: (m: number) => `قبل ${m} د`,
  hourAgo: (h: number) => `قبل ${h} س`,
  dayAgo: (d: number) => `قبل ${d} ي`,
  statusPillAI: "ذكاء",
  statusPillQueued: "بالانتظار",
  statusPillLive: "مباشر",
  statusPillResolved: "محلول",
  statusPillClosed: "مغلق",
};

const TABLE: Record<LangKey, WidgetStrings> = {
  en: EN,
  hi: HI,
  es: ES,
  fr: FR,
  ar: AR,
};

export function w(lang: LangKey): WidgetStrings {
  return TABLE[lang] || TABLE.en;
}
