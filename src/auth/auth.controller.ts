import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { AuthService } from './auth.service';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: Prisma.UsersCreateInput) {
    return this.authService.register(registerDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() signInDto: Prisma.UsersCreateInput) {
    return this.authService.signIn(signInDto.email, signInDto.password);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto.refresh_token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  signOut(
    @Headers('authorization') authorization: string | undefined,
    @Body() refreshTokenDto: RefreshTokenDto,
  ) {
    const accessToken = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      throw new UnauthorizedException('Access token is required');
    }

    return this.authService.signOut(accessToken, refreshTokenDto.refresh_token);
  }
}
