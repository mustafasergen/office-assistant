import 'reflect-metadata';
import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { type AppConfig, CONFIG } from './config/config';

dotenv({ path: resolve(process.cwd(), '../.env'), quiet: true });
async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(CONFIG);
  configureApp(app, config);
  await app.listen(config.PORT, '0.0.0.0');
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Başlatma hatası');
  process.exit(1);
});
