export class RouterConfigNotFound extends Error {
  constructor(token: string, destChain: string, network: string) {
    super();

    this.message = `can't find ${token} to ${destChain} router in ${network} network`;
    this.name = "RouterConfigNotFound";
  }
}

export class AdapterNotFound extends Error {
  constructor(network: string) {
    super();

    this.message = `${network} adapter not find`;
    this.name = "AdapterNotFound";
  }
}

export class ApiNotFound extends Error {
  constructor(network: string) {
    super();

    this.message = `Api not set for ${network} adapter`;
    this.name = "ApiNotFound";
  }
}

export class TokenConfigNotFound extends Error {
  constructor(token: string, network: string) {
    super();

    this.message = `can't find ${token} config in ${network}`;
    this.name = "TokenConfigNotFound";
  }
}

export class CurrencyNotFound extends Error {
  constructor(name: string) {
    super();

    this.message = `can't find ${name} currency in current network`;
    this.name = "CurrencyNotFound";
  }
}

export class NoCrossChainAdapterFound extends Error {
  constructor(name: string) {
    super();

    this.message = `Can't find ${name} adapter, please registed it first before use.`;
    this.name = "NoCrossChainAdapterFound";
  }
}
