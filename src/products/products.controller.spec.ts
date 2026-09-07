import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guards';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';

describe('ProductsController', () => {
  let controller: ProductsController;
  const productsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    createProduct: jest.fn(),
    updateProduct: jest.fn(),
    deleteProduct: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: productsService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll to the service', async () => {
    const query: ListProductsDto = { page: 1, limit: 20 };
    const result = { data: [], total: 0, page: 1, limit: 20 };
    productsService.findAll.mockResolvedValue(result);

    await expect(controller.findAll(query)).resolves.toEqual(result);
    expect(productsService.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates findOne to the service', async () => {
    productsService.findOne.mockResolvedValue({ id: 1 });

    await expect(controller.findOne(1)).resolves.toEqual({ id: 1 });
    expect(productsService.findOne).toHaveBeenCalledWith(1);
  });

  it('delegates createProduct to the service', async () => {
    const dto: CreateProductDto = { name: 'p', price: 10 };
    productsService.createProduct.mockResolvedValue({ id: 1, ...dto });

    await controller.createProduct(dto);

    expect(productsService.createProduct).toHaveBeenCalledWith(dto);
  });

  it('delegates updateProduct to the service', async () => {
    const dto: UpdateProductDto = { name: 'p2' };
    productsService.updateProduct.mockResolvedValue({ id: 1, name: 'p2' });

    await controller.updateProduct(1, dto);

    expect(productsService.updateProduct).toHaveBeenCalledWith(1, dto);
  });

  it('delegates deleteProduct to the service', async () => {
    productsService.deleteProduct.mockResolvedValue({ id: 1 });

    await controller.deleteProduct(1);

    expect(productsService.deleteProduct).toHaveBeenCalledWith(1);
  });
});
