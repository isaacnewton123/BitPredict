import { app } from "./app";

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST?.trim() || "0.0.0.0";

app.listen({ port, hostname });

console.log(
  `BitPredict Elysia API running at http://${app.server?.hostname ?? hostname}:${app.server?.port ?? port}`,
);
console.log(
  `Scalar API Reference available at http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${app.server?.port ?? port}/openapi`,
);
