---
name: Codegen and live Vite previews
description: A transient browser failure during API client generation can masquerade as a broken feature.
---

The API code generator cleans its output directory before recreating client files. If a live Vite preview transforms modules during that interval, the browser can show missing-module errors and partially reset UI state even though the generated files and subsequent builds are valid.

**Why:** A real-browser validation flow appeared unable to load saved data immediately after code generation while server endpoints returned the correct records. Vite had logged that generated modules were missing during its hot reload.

**How to apply:** Finish contract generation before interactive verification. If a browser was open during generation, confirm the web workflow is serving and reload a fresh browser context before attributing missing UI data to the application.