import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const ZEN_MODE_STORAGE_KEY = "digestdesk-zen-mode";

interface ZenModeContextType {
  isZen: boolean;
  toggleZenMode: () => void;
  enterZenMode: () => void;
  exitZenMode: () => void;
}

const ZenModeContext = createContext<ZenModeContextType | null>(null);

export function ZenModeProvider({ children }: { children: ReactNode }) {
  const [isZen, setIsZen] = useState(() => {
    try {
      return localStorage.getItem(ZEN_MODE_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(ZEN_MODE_STORAGE_KEY, String(isZen));
      if (isZen) {
        document.body.classList.add("zen-mode-active");
      } else {
        document.body.classList.remove("zen-mode-active");
      }
    } catch {
      // ignore
    }
  }, [isZen]);

  const toggleZenMode = useCallback(() => {
    setIsZen((prev) => !prev);
  }, []);

  const enterZenMode = useCallback(() => {
    setIsZen(true);
  }, []);

  const exitZenMode = useCallback(() => {
    setIsZen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitZenMode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [exitZenMode]);

  return (
    <ZenModeContext.Provider value={{ isZen, toggleZenMode, enterZenMode, exitZenMode }}>
      {children}
    </ZenModeContext.Provider>
  );
}

export function useZenMode() {
  const context = useContext(ZenModeContext);
  if (!context) {
    throw new Error("useZenMode must be used within a ZenModeProvider");
  }
  return context;
}
