import { createContext, useContext, useState } from "react";

const I18nContext = createContext({ locale: "en", setLocale: () => {} });

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(() => {
    return localStorage.getItem("locale") || "en";
  });

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
