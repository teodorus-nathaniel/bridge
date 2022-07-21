import { AnyApi, FixedPointNumber as FN } from '@acala-network/sdk-core';
import { combineLatest, firstValueFrom, from, Observable, of, timeout, TimeoutError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApiRx } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ISubmittableResult } from '@polkadot/types/types';

import { xcmFeeConfig } from './configs/xcm-fee';
import { ChainName, chains } from './configs';
import { TokenConfigNotFound } from './errors';
import { BalanceChangedStatus, BalanceData, BridgeTxParams, Chain, CrossChainInputConfigs, CrossChainRouter, CrossChainTransferParams, CrossChainBalanceChangedConfigs, NetworkProps, TokenBalance } from './types';

const DEFAULT_TX_CHECKING_TIMEOUT = 2 * 60 * 1000;

export abstract class BaseCrossChainAdapter {
  protected routers: Omit<CrossChainRouter, 'from'>[];
  protected api?: AnyApi;
  readonly chain: Chain;
  // @ts-ignore
  private findAdapter!: (chain: Chain | ChainName) => BaseCrossChainAdapter;

  constructor (chain: Chain, routers: Omit<CrossChainRouter, 'from'>[]) {
    this.chain = chain;
    this.routers = routers;
  }

  public async setApi (api: AnyApi) {
    this.api = api;

    if (this.api?.type === 'rxjs') {
      await firstValueFrom(api.isReady as Observable<ApiRx>);
    }

    await api.isReady;
  }

  public injectFindAdapter (func: (chain: ChainName | Chain) => BaseCrossChainAdapter): void {
    this.findAdapter = func;
  }

  public getRouters (): CrossChainRouter[] {
    return this.routers.map((i) => ({ ...i, from: this.chain }));
  }

  public getSS58Prefix (): number {
    return Number(this.api?.registry.chainSS58?.toString());
  }

  public subscribeInputConfigs (params: Omit<CrossChainTransferParams, 'amount'>): Observable<CrossChainInputConfigs> {
    const { address, to, token } = params;

    // subscribe destination min receive
    const minInput$ = this.subscribeMinInput(token, to);
    const maxInput$ = this.subscribeMaxInput(token, address, to);

    return combineLatest({
      minInput: minInput$,
      maxInput: maxInput$
    }).pipe(
      map(({ maxInput, minInput }) => {
        return {
          minInput,
          maxInput,
          ss58Prefix: chains[to].ss58Prefix,
          destFee: xcmFeeConfig[to][token].fee
        };
      })
    );
  }

  public subscribeMinInput (token: string, to: ChainName): Observable<FN> {
    return of(this.getDestED(token, to).balance.add(this.getCrossChainFee(token, to).balance || FN.ZERO));
  }

  public getDestED (token: string, destChain: ChainName): TokenBalance {
    if (!xcmFeeConfig[destChain][token]) {
      throw new TokenConfigNotFound(token, destChain);
    }

    return {
      token,
      balance: FN.fromInner(xcmFeeConfig[destChain][token]?.existentialDeposit ?? '0', xcmFeeConfig[destChain][token]?.decimals ?? 12)
    };
  }

  public getCrossChainFee (token: string, destChain: ChainName): TokenBalance {
    if (!xcmFeeConfig[destChain][token]) {
      throw new TokenConfigNotFound(token, destChain);
    }

    return {
      token,
      balance: FN.fromInner(xcmFeeConfig[destChain][token]?.fee ?? '0', xcmFeeConfig[destChain][token]?.decimals ?? 12)
    };
  }

  protected estimateTxFee (params: CrossChainTransferParams, signer: string) {
    let tx = this.createTx({ ...params });

    if (this.api?.type === 'rxjs') {
      tx = tx as SubmittableExtrinsic<'rxjs', ISubmittableResult>;

      return tx.paymentInfo(signer).pipe(
        map((feeData) => {
          return feeData.partialFee.toString();
        })
      );
    }

    // for promise api
    tx = tx as SubmittableExtrinsic<'promise', ISubmittableResult>;

    return from(
      (async () => {
        const feeData = await tx.paymentInfo(signer);

        return feeData.partialFee.toString();
      })()
    );
  }

  public async getNetworkProperties (): Promise<NetworkProps> {
    const props = await firstValueFrom((this.api as ApiRx).rpc.system.properties());

    return {
      ss58Format: parseInt(props.ss58Format.toString()),
      tokenDecimals: props.tokenDecimals.toJSON() as number[],
      tokenSymbol: props.tokenSymbol.toJSON() as string[]
    };
  }

  public subscribeBalanceChanged (configs: CrossChainBalanceChangedConfigs): Observable<BalanceChangedStatus> {
    const { address, amount, token, tolerance } = configs;
    // allow 1% tolerance as default
    const target = amount.mul(new FN(1 - (tolerance || 0.01)));

    let savedBalance: FN | undefined;

    return this.subscribeTokenBalance(token, address).pipe(
      timeout(configs.timeout || DEFAULT_TX_CHECKING_TIMEOUT),
      map((balance) => {
        if (!savedBalance) {
          savedBalance = balance.available;
        }

        const diff = balance.available.minus(savedBalance);

        if (savedBalance && diff.gte(target)) {
          return BalanceChangedStatus.SUCCESS;
        }

        return BalanceChangedStatus.CHECKING;
      }),
      catchError((e: Error) => {
        if (e instanceof TimeoutError) {
          return of(BalanceChangedStatus.TIMEOUT);
        }

        return of(BalanceChangedStatus.UNKNOWN_ERROR);
      })
    );
  }

  public createTx (
    params: CrossChainTransferParams
  ): SubmittableExtrinsic<'promise', ISubmittableResult> | SubmittableExtrinsic<'rxjs', ISubmittableResult> {
    const txParams = this.getBridgeTxParams({ ...params });

    return (this.api as any).tx[txParams.module][txParams.call](...txParams.params);
  }

  public abstract subscribeTokenBalance(token: string, address: string): Observable<BalanceData>;
  public abstract subscribeMaxInput(token: string, address: string, to: ChainName): Observable<FN>;
  public abstract getBridgeTxParams(params: CrossChainTransferParams): BridgeTxParams;
}
