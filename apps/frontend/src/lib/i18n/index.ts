import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import { setLocale } from "../format";

export const resources = { en: { translation: en } } as const;

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  setLocale("en");
}

export default i18next;
