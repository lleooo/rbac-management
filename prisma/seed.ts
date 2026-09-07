import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // 1. 建立 Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN' },
  });

  const viewerRole = await prisma.role.upsert({
    where: { name: 'VIEWER' },
    update: {},
    create: { name: 'VIEWER' },
  });

  // 2. 建立所有 Permissions
  const allPermissions = [
    { action: 'read', resource: 'products' },
    { action: 'create', resource: 'products' },
    { action: 'update', resource: 'products' },
    { action: 'delete', resource: 'products' },
    { action: 'read', resource: 'orders' },
    { action: 'read_own', resource: 'orders' },
    { action: 'create', resource: 'orders' },
    { action: 'update_status', resource: 'orders' },
    { action: 'read', resource: 'users' },
    { action: 'update', resource: 'users' },
    { action: 'delete', resource: 'users' },
  ];

  for (const p of allPermissions) {
    await prisma.permission.upsert({
      where: { action_resource: { action: p.action, resource: p.resource } },
      update: {},
      create: p,
    });
  }

  // 3. 建立 RolePermission（ADMIN 擁有全部）
  const adminPermissions = allPermissions;

  for (const p of adminPermissions) {
    const permission = await prisma.permission.findUnique({
      where: { action_resource: { action: p.action, resource: p.resource } },
    });
    if (!permission) continue;

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: permission.id },
    });
  }

  // 4. 建立 RolePermission（VIEWER 只有部分）
  const viewerPermissions = [
    { action: 'read', resource: 'products' },
    { action: 'read_own', resource: 'orders' },
    { action: 'create', resource: 'orders' },
  ];

  for (const p of viewerPermissions) {
    const permission = await prisma.permission.findUnique({
      where: { action_resource: { action: p.action, resource: p.resource } },
    });
    if (!permission) continue;

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: viewerRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { roleId: viewerRole.id, permissionId: permission.id },
    });
  }

  const defaultUsers = [
    {
      username: 'admin',
      email: 'admin@example.com',
      password: '12341234',
      roleName: 'ADMIN',
    },
    {
      username: 'viewer',
      email: 'viewer@example.com',
      password: '12341234',
      roleName: 'VIEWER',
    },
  ];

  for (const user of defaultUsers) {
    // 建立或取得 user
    const createdUser = await prisma.users.upsert({
      where: { email: user.email },
      update: {},
      create: {
        username: user.username,
        email: user.email,
        password: user.password,
      },
    });
    // 取得對應的 role
    const role = await prisma.role.findUnique({
      where: { name: user.roleName },
    });
    if (!role) continue;
    // 綁定 UserRole
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: createdUser.id,
          roleId: role.id,
        },
      },
      update: {},
      create: {
        userId: createdUser.id,
        roleId: role.id,
      },
    });
  }

  console.log('Seed 完成');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
