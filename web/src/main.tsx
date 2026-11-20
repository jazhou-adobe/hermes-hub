import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Feed } from "./feed/Feed.tsx";
import { connect } from "./store.ts";

connect();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Feed />
  </StrictMode>,
);
