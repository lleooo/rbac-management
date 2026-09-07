import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const prisma = {
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a product', async () => {
    const dto = { name: 'p', price: 10 };
    prisma.product.create.mockResolvedValue({ id: 1, ...dto });

    await expect(service.createProduct(dto)).resolves.toEqual({
      id: 1,
      ...dto,
    });
    expect(prisma.product.create).toHaveBeenCalledWith({ data: dto });
  });

  it('lists products with pagination and search', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.findAll({ page: 2, limit: 5, search: 'rope' });

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { name: { contains: 'rope', mode: 'insensitive' } },
      skip: 5,
      take: 5,
      orderBy: { created_at: 'desc' },
    });
    expect(result).toEqual({ data: [{ id: 1 }], total: 1, page: 2, limit: 5 });
  });

  it('returns a product by id', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 1 });
    await expect(service.findOne(1)).resolves.toEqual({ id: 1 });
  });

  it('throws NotFoundException when the product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
  });

  it('updates an existing product', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 1 });
    prisma.product.update.mockResolvedValue({ id: 1, name: 'new' });

    await expect(service.updateProduct(1, { name: 'new' })).resolves.toEqual({
      id: 1,
      name: 'new',
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: 'new' },
    });
  });

  it('throws NotFoundException when updating a missing product', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.updateProduct(999, { name: 'new' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deletes an existing product', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 1 });
    prisma.product.delete.mockResolvedValue({ id: 1 });

    await expect(service.deleteProduct(1)).resolves.toEqual({ id: 1 });
    expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('throws NotFoundException when deleting a missing product', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.deleteProduct(999)).rejects.toThrow(NotFoundException);
  });
});
