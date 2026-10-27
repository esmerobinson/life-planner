import { createContext } from "react";

/** Lets pages inside the shell tell it that items changed (so the Inbox count stays right). */
export const ShellContext = createContext<{ refresh: () => void | Promise<void> } | null>(null);
