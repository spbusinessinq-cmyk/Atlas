import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

document.documentElement.classList.add("dark");

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

// Signal to index.html that React mounted successfully (clears 6s fallback timer)
if (typeof window !== "undefined" && typeof (window as any).__atlasMarkMounted === "function") {
  (window as any).__atlasMarkMounted();
}
