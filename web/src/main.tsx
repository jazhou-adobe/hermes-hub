import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Agents } from "./agents/Agents.tsx";
import { Feed } from "./feed/Feed.tsx";
import { Nav } from "./nav.tsx";
import { usePath } from "./router.ts";
import { connect } from "./store.ts";

function App() {
  const path = usePath();
  return (
    <>
      <Nav />
      {path === "/agents" ? <Agents /> : <Feed />}
    </>
  );
}

connect();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
