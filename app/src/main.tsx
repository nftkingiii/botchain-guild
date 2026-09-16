import "@fontsource-variable/plus-jakarta-sans";
import React from "react";
import { createRoot } from "react-dom/client";
import Guild from "./workspace";
import "./style.css";
import "./extras.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><Guild /></React.StrictMode>);
