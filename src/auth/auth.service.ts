import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TokenPayload = {
  sub: number;
  username: string;
  roles: string[];
};

type UserWithRoles = {
  id: number;
  username: string;
  userRoles: { role: { name: string } }[];
};

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const user = await this.usersService.findOne(registerDto.email);
    if (user) {
      throw new BadRequestException('User already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(registerDto.password, salt);

    return this.usersService.createUser({
      ...registerDto,
      password: hashedPassword,
    });
  }

  async signIn(
    email: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const user = await this.prisma.users.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException();
    }

    return this.issueTokenPair(user);
  }

  async refresh(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const record = await this.findValidRefreshToken(refreshToken);
    const user = record.user;

    await this.prisma.refreshToken.delete({ where: { id: record.id } });

    return this.issueTokenPair(user);
  }

  async signOut(
    accessToken: string,
    refreshToken: string,
  ): Promise<{ message: string }> {
    let payload: TokenPayload & { exp?: number };
    try {
      payload = await this.jwtService.verifyAsync(accessToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const record = await this.findValidRefreshToken(refreshToken);

    if (record.userId !== payload.sub) {
      throw new UnauthorizedException('Token mismatch');
    }

    const accessTokenHash = this.hashToken(accessToken);

    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: record.id } }),
      this.prisma.revokedAccessToken.upsert({
        where: { tokenHash: accessTokenHash },
        update: {},
        create: {
          tokenHash: accessTokenHash,
          expiresAt: new Date((payload.exp ?? 0) * 1000),
        },
      }),
      this.prisma.revokedAccessToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
    ]);

    return { message: 'Sign out successfully' };
  }

  private async issueTokenPair(
    user: UserWithRoles,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const payload: TokenPayload = {
      sub: user.id,
      username: user.username,
      roles: user.userRoles.map((userRole) => userRole.role.name),
    };

    const access_token = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

    const refresh_token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(refresh_token);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { access_token, refresh_token };
  }

  private async findValidRefreshToken(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
      },
    });

    if (!record || record.expiresAt < new Date()) {
      if (record) {
        await this.prisma.refreshToken.delete({ where: { id: record.id } });
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return record;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
