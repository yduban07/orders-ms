import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { envs } from './config/envs';
import { Logger, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const logger = new Logger('Orders');
  
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.NATS,
    options: {
      servers: envs.natsServers,
    }
  });

  app.useGlobalPipes(

    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    })

  );

  app.listen();

  logger.log(`Orders microservice running on port ${envs.port}`);

  
}
bootstrap();
