import {
  CanActivate,
  Controller,
  ExecutionContext,
  Inject,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../../config/config';
import { User } from '../../database/entities';

export const COOKIE_NAME = 'uplico_user';
export type UserRequest = Request & { userId: string };

@Injectable()
export class IdentityService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async resolve(req: Request): Promise<User | null> {
    const id: unknown = req.signedCookies?.[COOKIE_NAME];
    if (!z.uuid().safeParse(id).success) return null;
    return this.db.getRepository(User).findOneBy({ id: id as string });
  }
  async create(): Promise<User> {
    return this.db.getRepository(User).save({});
  }
}

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<UserRequest>();
    const user = await this.identity.resolve(req);
    if (!user) throw new UnauthorizedException('Oturum bulunamadı. Sayfayı yenileyin.');
    req.userId = user.id;
    return true;
  }
}

@Controller('session')
class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  @Post()
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = (await this.identity.resolve(req)) ?? (await this.identity.create());
    res.cookie(COOKIE_NAME, user.id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return { id: user.id };
  }
}

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, IdentityGuard],
  exports: [IdentityService, IdentityGuard],
})
export class IdentityModule {}
