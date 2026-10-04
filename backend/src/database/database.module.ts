import { ConversationContext1791120000000 } from './migrations/1791120000000-conversation-context';
import { LibraryEditing1791040000000 } from './migrations/1791040000000-library-editing';
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from './connection-options';
import { BackendOnly1791020000000 } from './migrations/1791020000000-backend-only';
import { type AppConfig, CONFIG } from '../config/config';
import { entities } from './entities';
import { Initial1730000000000 } from './migrations/1730000000000-initial';

export function createDataSource(config: Pick<AppConfig, 'DATABASE_URL'>): DataSource {
  return new DataSource({
    type: 'postgres',
    ...databaseConnectionOptions(config.DATABASE_URL),
    extra: { max: 5, connectionTimeoutMillis: 15000, options: '-c search_path=public,extensions' },
    entities,
    migrations: [
      Initial1730000000000,
      BackendOnly1791020000000,
      LibraryEditing1791040000000,
      ConversationContext1791120000000,
    ],
    synchronize: false,
    installExtensions: false,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [CONFIG],
      useFactory: async (config: AppConfig) => {
        const db = createDataSource(config);
        await db.initialize();
        try {
          await db.runMigrations();
          return db;
        } catch (error) {
          await db.destroy();
          throw error;
        }
      },
    },
  ],
  exports: [DataSource],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.db.isInitialized) await this.db.destroy();
  }
}
