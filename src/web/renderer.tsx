import { reactRenderer } from "@hono/react-renderer";

export const renderer = reactRenderer(({ children }) => {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* <script
          type="module"
          src={
            import.meta.env.PROD ? "/static/client.js" : "/src/client/index.tsx"
          }
        ></script> */}
        <link
          href={
            import.meta.env.PROD ? "/static/assets/style.css" : "/src/style.css"
          }
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
});
