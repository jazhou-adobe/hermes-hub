import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Feed } from "./feed/Feed.tsx";
import { Log } from "./log/Log.tsx";
import { Nav } from "./nav.tsx";
import { usePath } from "./router.ts";
import { connect } from "./store.ts";

connect();

function App() {
  const path = usePath();
  return (
    <>
      <Nav />
      {path === "/log" ? <Log /> : <Feed />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
