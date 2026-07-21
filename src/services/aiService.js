const OpenAI = require("openai");
const { config } = require("../config/env");

const romanUrduHints = [
  "mujhe", "chahiye", "kal", "aaj", "doctor", "available", "hain", "hai",
  "timing", "kya", "appointment", "reschedule", "cancel", "band", "kar dein"
];

let client;
function getClient() {
  if (!config.openaiApiKey) return null;
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

function detectLanguageFallback(text) {
  const value = String(text || "").toLowerCase();
  if (/[\u0600-\u06ff]/.test(value)) return "ur";
  if (/[\u0900-\u097f]/.test(value)) return "hi";
  if (romanUrduHints.some((hint) => value.includes(hint))) return "roman-ur";
  return "en";
}

function classifyIntentFallback(text) {
  const value = String(text || "").toLowerCase();
  if (/(stop|unsubscribe|band|بند|messages band)/.test(value)) return "opt_out";
  if (/(emergency|severe|bleeding|breathing|unconscious|chest pain|life.?threat|saans|سانس|خون|chakkar)/.test(value)) return "emergency";
  if (/(staff|human|reception|operator|insaan|بندہ|madad)/.test(value)) return "talk_to_staff";
  if (/(cancel|منسوخ|mansookh)/.test(value)) return "cancel";
  if (/(reschedule|change|move|tabdeel|تبدیل)/.test(value)) return "reschedule";
  if (/(check|status|lookup|meri appointment|appointment id)/.test(value)) return "lookup";
  if (/(timing|hours|open|closed|schedule|وقت|timings)/.test(value)) return "timing";
  if (/(location|address|where|clinic kahan|پتہ)/.test(value)) return "location";
  if (/(doctor|profile|qualification|specialty|experience)/.test(value)) return "doctor_profile";
  if (/(book|appointment|chahiye|milna|visit|slot)/.test(value)) return "book";
  return "menu";
}

async function understandMessage(text, previousLanguage = "en") {
  const language = detectLanguageFallback(text) || previousLanguage || "en";
  const fallback = { language, intent: classifyIntentFallback(text), entities: {} };
  const ai = getClient();
  if (!ai) return fallback;

  try {
    const completion = await ai.chat.completions.create({
      model: config.openaiModel,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "You classify messages for Dr. Khurram's clinic appointment assistant.",
            "Return strict JSON with keys: language, intent, entities.",
            "Supported intents: book, lookup, reschedule, cancel, timing, location, doctor_profile, emergency, talk_to_staff, opt_out, menu.",
            "Never provide medical diagnosis or prescriptions.",
            "Clinic schedule: Monday-Friday 09:00-16:00; Saturday-Sunday closed."
          ].join(" ")
        },
        { role: "user", content: text }
      ]
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return {
      language: parsed.language || fallback.language,
      intent: parsed.intent || fallback.intent,
      entities: parsed.entities || {}
    };
  } catch (error) {
    console.error("OpenAI classification failed:", error.message);
    return fallback;
  }
}

function t(language, key, params = {}) {
  const lang = language || "en";
  const strings = {
    en: {
      menu: "How can I help you today?\n1. Book Appointment\n2. Check Appointment\n3. Reschedule Appointment\n4. Cancel Appointment\n5. Clinic Timing\n6. Clinic Location\n7. Doctor Profile\n8. Emergency Guidance\n9. Talk to Staff",
      timing: "Dr. Khurram is available Monday to Friday from 9:00 AM to 4:00 PM. The clinic is closed on Saturday and Sunday.",
      consent: "Before booking, please confirm consent: your information will be used only for appointment management, reminders, rescheduling, and cancellation support. Reply YES to continue or STOP to opt out.",
      askName: "Please share the patient's full name.",
      askAge: "Please share the patient's age.",
      askReason: "Please share the reason for appointment. Do not send unnecessary medical history.",
      askDate: "Please share the preferred appointment date, for example 2026-07-14 or tomorrow.",
      askTime: "Please choose an available time: {slots}",
      invalid: "I could not understand that. Please try again or type Talk to Staff.",
      booked: "Appointment confirmed with Meta delivery pending. Appointment ID: {id}, Token: {token}, Date: {date}, Time: {time}. Clinic contact: +92 324 4754566.",
      lookupAsk: "Please send your Appointment ID.",
      lookupResult: "Appointment ID: {id}\nToken: {token}\nPatient: {name}\nDate: {date}\nTime: {time}\nStatus: {status}\nReminder status: {reminder}",
      cancelConfirm: "Please reply CONFIRM CANCEL to cancel appointment {id}.",
      cancelled: "Appointment {id} has been cancelled. Clinic contact: +92 324 4754566.",
      rescheduleDate: "Please send the new appointment date.",
      rescheduleTime: "Please choose a new available time: {slots}",
      rescheduled: "Appointment {id} has been rescheduled to {date} at {time}.",
      staff: "A staff member has been notified. Automated replies will pause when staff takes over.",
      location: "The clinic address has not been verified yet. Please contact the clinic at +92 324 4754566.",
      doctor: "Dr. Khurram's specialty, qualifications, experience, biography, and clinic address are editable staff settings and are not verified yet. Contact: +92 324 4754566.",
      emergency: "If you are experiencing severe pain, heavy bleeding, breathing difficulty, loss of consciousness, high fever, chest pain, or any life-threatening symptoms, please go to the nearest emergency department or contact emergency medical services immediately.",
      optedOut: "You have been opted out of non-essential messages. You can still contact the clinic at +92 324 4754566."
    },
    "roman-ur": {
      menu: "Aap kis cheez mein madad chahte hain?\n1. Appointment book\n2. Appointment check\n3. Reschedule\n4. Cancel\n5. Clinic timing\n6. Clinic location\n7. Doctor profile\n8. Emergency guidance\n9. Staff se baat",
      timing: "Dr. Khurram Monday se Friday 9:00 AM se 4:00 PM tak available hain. Saturday aur Sunday clinic band hota hai.",
      consent: "Booking se pehle consent confirm kar dein: aap ki information sirf appointment management, reminders, reschedule aur cancellation ke liye use hogi. Continue ke liye YES likhein ya STOP opt out ke liye.",
      askName: "Patient ka full name share kar dein.",
      askAge: "Patient ki age share kar dein.",
      askReason: "Appointment ki wajah batayein. Ghair zaroori medical history na bhejein.",
      askDate: "Preferred date bhejein, jaise 2026-07-14 ya kal.",
      askTime: "Available time choose karein: {slots}",
      invalid: "Main samajh nahi saka. Dobara try karein ya Talk to Staff likhein.",
      booked: "Appointment confirm ho gayi hai; Meta delivery pending hai. Appointment ID: {id}, Token: {token}, Date: {date}, Time: {time}. Clinic contact: +92 324 4754566.",
      lookupAsk: "Apna Appointment ID bhejein.",
      lookupResult: "Appointment ID: {id}\nToken: {token}\nPatient: {name}\nDate: {date}\nTime: {time}\nStatus: {status}\nReminder status: {reminder}",
      cancelConfirm: "Appointment {id} cancel karne ke liye CONFIRM CANCEL reply karein.",
      cancelled: "Appointment {id} cancel ho gayi hai. Clinic contact: +92 324 4754566.",
      rescheduleDate: "New appointment date bhejein.",
      rescheduleTime: "New available time choose karein: {slots}",
      rescheduled: "Appointment {id} {date} ko {time} par reschedule ho gayi hai.",
      staff: "Staff member ko notify kar diya gaya hai. Jab staff takeover karega to automated replies pause ho jayengi.",
      location: "Clinic address abhi verify nahi hua. Please clinic se contact karein: +92 324 4754566.",
      doctor: "Dr. Khurram ki specialty, qualifications, experience, biography aur clinic address staff settings mein editable hain aur abhi verified nahi. Contact: +92 324 4754566.",
      emergency: "Agar aap ko severe pain, heavy bleeding, breathing difficulty, behoshi, high fever, chest pain, ya life-threatening symptoms hain, foran nearest emergency department ya emergency medical services se contact karein.",
      optedOut: "Aap non-essential messages se opt out ho gaye hain. Clinic contact: +92 324 4754566."
    },
    ur: {
      timing: "ڈاکٹر خرم پیر سے جمعہ صبح 9:00 بجے سے شام 4:00 بجے تک دستیاب ہیں۔ کلینک ہفتہ اور اتوار کو بند ہوتا ہے۔",
      emergency: "اگر آپ کو شدید درد، زیادہ خون بہنا، سانس لینے میں دشواری، بے ہوشی، تیز بخار، سینے میں درد، یا جان لیوا علامات ہیں تو فوراً قریبی ایمرجنسی ڈیپارٹمنٹ جائیں یا ایمرجنسی میڈیکل سروسز سے رابطہ کریں۔"
    },
    hi: {
      timing: "Dr. Khurram सोमवार से शुक्रवार सुबह 9:00 बजे से शाम 4:00 बजे तक उपलब्ध हैं। क्लिनिक शनिवार और रविवार को बंद रहता है।",
      emergency: "यदि आपको गंभीर दर्द, भारी रक्तस्राव, सांस लेने में कठिनाई, बेहोशी, तेज बुखार, सीने में दर्द या कोई जानलेवा लक्षण हैं, तो तुरंत नजदीकी emergency department जाएं या emergency medical services से संपर्क करें।"
    }
  };

  const template = strings[lang]?.[key] || strings.en[key] || key;
  return Object.entries(params).reduce((message, [name, value]) => {
    return message.replaceAll(`{${name}}`, String(value));
  }, template);
}

module.exports = { understandMessage, detectLanguageFallback, classifyIntentFallback, t };
