// The bundler inlines `.pem` files as text (see `tools/bundler.mjs`).
declare module '*.pem' {
  const content: string;
  export default content;
}
