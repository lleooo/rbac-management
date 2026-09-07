import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { ProductsService } from './products.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { Role } from 'src/auth/enum/role.enum';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guards';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Post('create')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  async createProduct(@Body() createProductDto: Prisma.ProductCreateInput) {
    return this.productsService.createProduct(createProductDto);
  }
}
