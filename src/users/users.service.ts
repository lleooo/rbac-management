import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, Users } from 'generated/prisma/client';

type UserWithRoles = Prisma.UsersGetPayload<{
  include: {
    userRoles: {
      include: {
        role: true;
      };
    };
  };
}>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createUser(data: Prisma.UsersCreateInput): Promise<UserWithRoles> {
    const dbUser = await this.prisma.users.create({
      data: {
        ...data,
        userRoles: {
          create: {
            role: {
              connect: { name: 'VIEWER' },
            },
          },
        },
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });
    return dbUser;
  }

  async deleteUser(email: string): Promise<void> {
    await this.prisma.users.delete({
      where: { email },
    });
  }

  async findOne(email: string): Promise<Users | null> {
    const dbUser = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!dbUser) return null;

    return dbUser;
  }
}
