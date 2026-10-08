import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { DataBaseDirControl } from "../../src/settings/DataBaseDirControl.js";
import "../../src/styles.css";

function App() {
  const [saved, setSaved] = useState("");
  const [directory, setDirectory] = useState("");
  return (
    <ZCodeIntlProvider initialLocale="zh-CN">
      <DataBaseDirControl
        dataBaseDir={directory}
        defaultHomeDir="/profile/.zcode-local-home"
        onSelectDataBaseDir={async () =>
          directory ? "/profile/.zcode-local-home" : "/selected/data"
        }
        onDataBaseDirChange={async (value) => {
          setSaved(value);
          setDirectory(value);
        }}
      />
      <output data-testid="saved-directory">{saved}</output>
    </ZCodeIntlProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
