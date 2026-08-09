import "./load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import helmet from "helmet";
import cookieParser from "cookie-parser";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.setGlobalPrefix("v1");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN || "http://localhost:3000", credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] });
  await app.listen(Number(process.env.PORT || 4000), "0.0.0.0");
}

bootstrap();
