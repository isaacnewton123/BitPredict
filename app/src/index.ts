import { app } from "./app";

const port = Number(process.env.PORT ?? 3001);

app.listen(port);

console.log(
  `BitPredict Elysia API running at http://${app.server?.hostname ?? "localhost"}:${app.server?.port ?? port}`,
);
console.log(
  `Scalar API Reference available at http://localhost:${app.server?.port ?? port}/openapi`,
);
