/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Allow importing CSS files as modules
declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.mdx?raw' {
  const content: string;
  export default content;
}
