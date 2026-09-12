/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * API origin override. Never put secrets here: `VITE_*` values are inlined into the
   * public bundle. The admin token is entered at runtime and kept in sessionStorage.
   */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
