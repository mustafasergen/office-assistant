import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { type AppConfig } from './config/config';

export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix('api');
  app.use(json({ limit: '128kb' }));
  app.use(cookieParser(config.COOKIE_SECRET));
  app.enableShutdownHooks();
}
