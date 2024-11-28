import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { NATS_SERVICE, PRODUCT_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ) {
    super()
  }

  async onModuleInit() {
    await this.$connect()
    this.logger.log('Database connected');
  }
  async create(createOrderDto: CreateOrderDto) {

    try {

      const productsIds = createOrderDto.items.map(item => item.productId);

      const products: any[] = await firstValueFrom(this.client.send({ cmd: 'validate_product' }, productsIds));

      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.
          find(product => product.id === orderItem.productId).price;

        return (price * orderItem.quantity) + acc;

      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find((product) => product.id === orderItem.productId).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          },
        }
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          name: products.find((product) => product.id === orderItem.productId).name,
          ...orderItem,
        }))
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs',
      });
    }

  }

  async findAll(paginationDto: OrderPaginationDto) {

    const totalPages = await this.order.count({
      where: {
        status: paginationDto.status
      }
    });

    const currentPage = paginationDto.page;
    const perPage = paginationDto.limit;

    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: paginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage)
      }
    }
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          }
        }
      }
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`
      });
    };

    const productIds = order.OrderItem.map((item) => item.productId);

    const products: any[] =  await firstValueFrom(
      this.client.send({ cmd: 'validate_product' }, productIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map( orderItem => ({
        ...orderItem,
        name: products.find(product => product.id === orderItem.productId).name,
      })),
    };
  };

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto;

    try {
      const order = await this.findOne(id);

      if (order.status === status) {
        return order;
      }

      return this.order.update({
        data: { status: status },
        where: { id }
      });

    } catch (error) {
      throw new RpcException(error);
    }

  }
}
