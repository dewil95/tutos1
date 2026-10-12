import type { Lang } from "./questions";

/** Everything the WhatsApp bot says, in English and Spanish. *bold* is WhatsApp formatting. */
export const COPY = {
  welcome:
    "Hi! This is Ascend Fund 👋 Which language do you prefer?\n¡Hola! Somos Ascend Fund 👋 ¿Qué idioma prefiere?",
  askDocs: {
    en: "Thanks! Send the signed application you already have (PDF, or a clear photo of each page) and your last 4 months of business bank statements. I'll fill in Ascend's application for you.\n\nNo application at hand? Tap *Answer questions*.",
    es: "¡Gracias! Envíe la solicitud firmada que ya tiene (PDF, o una foto clara de cada página) y sus últimos 4 meses de estados de cuenta del negocio. Yo lleno la solicitud de Ascend por usted.\n\n¿No tiene una solicitud? Toque *Responder preguntas*.",
  },
  questionsButton: { en: "Answer questions", es: "Responder preguntas" },
  reading: {
    en: "Got it 👍 I'm reading your application now. This takes about a minute.",
    es: "Recibido 👍 Estoy leyendo su solicitud. Toma más o menos un minuto.",
  },
  statementNoted: {
    en: "Got your bank statement ✅",
    es: "Recibí su estado de cuenta ✅",
  },
  readNone: {
    en: "I couldn't find an application in what you sent. Please send it again (PDF, or clear photos of each page), or tap *Answer questions*.",
    es: "No encontré una solicitud en lo que envió. Envíela de nuevo (PDF, o fotos claras de cada página), o toque *Responder preguntas*.",
  },
  readDone: {
    en: "Done ✅ I filled in Ascend's application with the information from yours.",
    es: "Listo ✅ Llené la solicitud de Ascend con la información de la suya.",
  },
  fewMore: {
    en: (n: number) => `I just need ${n} more detail${n === 1 ? "" : "s"}.`,
    es: (n: number) => `Solo necesito ${n} dato${n === 1 ? "" : "s"} más.`,
  },
  startQuestions: {
    en: "Great, I'll ask a few short questions. Reply *back* to go to the previous one, or *agent* to talk to a person.",
    es: "Perfecto, le haré unas preguntas cortas. Responda *atrás* para volver a la anterior, o *agente* para hablar con una persona.",
  },
  confirm: {
    en: (label: string, value: string) => `${label}: *${value}*\nIs that right?`,
    es: (label: string, value: string) => `${label}: *${value}*\n¿Es correcto?`,
  },
  yes: { en: "Yes", es: "Sí" },
  change: { en: "Change", es: "Cambiar" },
  notUnderstood: {
    en: "Sorry, I didn't get that.",
    es: "Disculpe, no entendí.",
  },
  required: {
    en: "Lenders need this one, so I can't skip it.",
    es: "Los prestamistas necesitan este dato, no lo puedo saltar.",
  },
  secureLink: {
    en: (url: string) =>
      `Almost done! Please add the owner's Social Security number and date of birth on this private page. We never ask for them in the chat:\n${url}\n\nThe link works once, for 24 hours.`,
    es: (url: string) =>
      `¡Casi terminamos! Agregue el número de Seguro Social y la fecha de nacimiento del dueño en esta página privada. Nunca los pedimos por el chat:\n${url}\n\nEl enlace funciona una vez, por 24 horas.`,
  },
  secureRemind: {
    en: "Please use the private link I sent for the SSN and date of birth (don't type them here). Reply *link* for a new one.",
    es: "Use el enlace privado que le envié para el Seguro Social y la fecha de nacimiento (no los escriba aquí). Responda *enlace* para uno nuevo.",
  },
  askStatements: {
    en: "Please send your last 4 months of business bank statements (PDF). Tap *Done* when you've sent them all.",
    es: "Envíe sus últimos 4 meses de estados de cuenta del negocio (PDF). Toque *Listo* cuando los haya enviado todos.",
  },
  gotStatements: {
    en: (n: number) => `Got ${n} statement${n === 1 ? "" : "s"} ✅ Send more, or tap *Done*.`,
    es: (n: number) =>
      `Recibí ${n} estado${n === 1 ? "" : "s"} de cuenta ✅ Envíe más, o toque *Listo*.`,
  },
  done: { en: "Done", es: "Listo" },
  later: { en: "Send later", es: "Enviar después" },
  reviewCaption: {
    en: "Your Ascend application, ready to sign. SSN and date of birth are hidden on this copy.",
    es: "Su solicitud de Ascend, lista para firmar. El Seguro Social y la fecha de nacimiento están ocultos en esta copia.",
  },
  reviewAsk: {
    en: "Please check the application above. Is everything right?",
    es: "Revise la solicitud de arriba. ¿Está todo correcto?",
  },
  looksGood: { en: "Looks good", es: "Todo bien" },
  fixSomething: { en: "Fix something", es: "Corregir algo" },
  fixList: {
    en: "Which one? Reply with the number:",
    es: "¿Cuál? Responda con el número:",
  },
  consent: {
    en: (text: string, name: string) =>
      `To sign, please read this authorization:\n\n${text}\n\nThen type the owner's full legal name (*${name}*) to sign.`,
    es: (text: string, name: string) =>
      `Para firmar, lea esta autorización:\n\n${text}\n\nLuego escriba el nombre legal completo del dueño (*${name}*) para firmar.`,
  },
  nameMismatch: {
    en: (name: string) =>
      `That doesn't match the owner on the application (*${name}*). Please type the full name, or reply *agent*.`,
    es: (name: string) =>
      `No coincide con el dueño en la solicitud (*${name}*). Escriba el nombre completo, o responda *agente*.`,
  },
  confirmSign: {
    en: (typed: string) =>
      `You typed: *${typed}*\nTap *I agree, sign* to sign Ascend's application electronically with this name.`,
    es: (typed: string) =>
      `Escribió: *${typed}*\nToque *Acepto, firmar* para firmar electrónicamente la solicitud de Ascend con este nombre.`,
  },
  agreeSign: { en: "I agree, sign", es: "Acepto, firmar" },
  cancel: { en: "Cancel", es: "Cancelar" },
  signed: {
    en: (first: string) =>
      `Signed ✅ Thank you, ${first}! Your application is with our team and a funding specialist will contact you soon.`,
    es: (first: string) =>
      `Firmado ✅ ¡Gracias, ${first}! Su solicitud está con nuestro equipo y un especialista le contactará pronto.`,
  },
  signedCaption: {
    en: "Your signed Ascend application (SSN and date of birth hidden on this copy).",
    es: "Su solicitud firmada de Ascend (Seguro Social y fecha de nacimiento ocultos en esta copia).",
  },
  handoff: {
    en: "OK, a person from our team will answer you here shortly.",
    es: "De acuerdo, una persona de nuestro equipo le responderá aquí en breve.",
  },
  fileAdded: { en: "Added to your file ✅", es: "Agregado a su expediente ✅" },
  unsupported: {
    en: "I can read text, PDFs and photos. Please send it as one of those.",
    es: "Puedo leer texto, PDF y fotos. Envíelo en uno de esos formatos.",
  },
  failed: {
    en: "Sorry, something went wrong on our side. A person from our team will take it from here.",
    es: "Disculpe, algo falló de nuestro lado. Una persona de nuestro equipo continuará desde aquí.",
  },
  nudge: {
    en: "Hi! Your Ascend application is almost done. Reply here to continue where you left off.",
    es: "¡Hola! Su solicitud de Ascend está casi lista. Responda aquí para continuar donde quedó.",
  },
} as const;

/**
 * Default authorization for the signature step. Replace it in Settings with the exact wording
 * of Ascend's current application; the English text is the one printed on the signed PDF.
 */
export const DEFAULT_CONSENT: Record<Lang, string> = {
  en: 'By signing, I certify that I am an owner of the business named in this application and that the information in it and in the documents provided is true, correct and complete. I authorize Ascend Fund, its agents and the funding partners it shares this application with to obtain business and personal credit reports, bank and trade references and other information about the business and its owners, and to share this application and its documents with those funding partners. I agree that typing my name and tapping "I agree, sign" on WhatsApp is my electronic signature, with the same effect as a handwritten signature, and I agree to receive this application and related records electronically.',
  es: 'Al firmar, certifico que soy dueño del negocio indicado en esta solicitud y que la información en ella y en los documentos entregados es verdadera, correcta y completa. Autorizo a Ascend Fund, sus agentes y los socios de financiamiento con quienes comparta esta solicitud a obtener reportes de crédito comerciales y personales, referencias bancarias y comerciales y otra información sobre el negocio y sus dueños, y a compartir esta solicitud y sus documentos con esos socios. Acepto que escribir mi nombre y tocar "Acepto, firmar" en WhatsApp es mi firma electrónica, con el mismo efecto que una firma a mano, y acepto recibir esta solicitud y sus registros de forma electrónica.',
};

export function tr<T>(v: Record<Lang, T>, lang: Lang | null | undefined): T {
  return v[lang ?? "en"];
}
