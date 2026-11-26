// Vite's "?url" imports: the URL the file is served at.
declare module "*?url" {
  const src: string;
  export default src;
}
