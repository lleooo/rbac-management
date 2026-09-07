import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';

export interface PaginatedProducts {
  data: Product[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async createProduct(data: CreateProductDto): Promise<Product> {
    return this.prisma.product.create({ data });
  }

  async findAll(query: ListProductsDto): Promise<PaginatedProducts> {
    const { page, limit, search } = query;
    const where: Prisma.ProductWhereInput = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async updateProduct(id: number, data: UpdateProductDto): Promise<Product> {
    await this.findOne(id);
    return this.prisma.product.update({ where: { id }, data });
  }

  async deleteProduct(id: number): Promise<Product> {
    await this.findOne(id);
    return this.prisma.product.delete({ where: { id } });
  }
}
