import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { RenderPage } from "./RenderPage";
import "./fonts.css";
import "./styles.css";

// The headless export route (?render=1) mounts the bare composition, not the
// editor UI. StrictMode is off there so effects run once (the renderer relies on
// a single, deterministic mount to publish window.__render).
const isRender = new URLSearchParams(window.location.search).has("render");

ReactDOM.createRoot(document.getElementById("root")!).render(
  isRender ? (
    <RenderPage />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
);
