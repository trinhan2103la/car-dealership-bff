import { Module } from '@nestjs/common';
import { CoreApiClient } from './core-api.client.js';
import { ServiceTokenSigner } from './service-token.signer.js';

@Module({
  providers: [ServiceTokenSigner, CoreApiClient],
  exports: [CoreApiClient, ServiceTokenSigner],
})
export class CoreApiModule {}
