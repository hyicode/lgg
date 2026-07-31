import { createRoot } from "react-dom/client";
import App from "./App";
import "../assets/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount point");
}

createRoot(root).render(<App />);
